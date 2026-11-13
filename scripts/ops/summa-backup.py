#!/usr/bin/env python3
"""Encrypted, verified PostgreSQL backups with narrowly scoped 30-day retention."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timedelta, timezone
import uuid


DATABASES = {
    "knjigovodstvoonline": "knjigovodstvoonline",
    "summa_fiscal": "fiskal-api",
    "spedicija": "spedicija",
    "turizam_prod": "turizam_prod",
}
FORMAT = "%Y%m%dT%H%M%SZ"


def log(message):
    print(f"{datetime.now(timezone.utc).isoformat()} {message}", flush=True)


def run(args, *, stdout=subprocess.PIPE, timeout=1800):
    # Do not log stderr: database errors may contain business values or secrets.
    result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=stdout,
                            stderr=subprocess.PIPE, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f"{Path(args[0]).name} failed (exit {result.returncode})")
    return result.stdout


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def backup_time(database, name):
    pattern = rf"summa-{re.escape(database)}-(\d{{8}}T\d{{6}}Z)-[a-f0-9]{{8}}\.tar\.age"
    match = re.fullmatch(pattern, name)
    if not match:
        return None
    try:
        return datetime.strptime(match[1], FORMAT).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def retention_candidates(database, entries, current, now, days):
    """Only our exact immediate-child filenames; never paths or unrelated files."""
    cutoff = now - timedelta(days=days)
    result = []
    for entry in entries:
        name = entry.get("Name", "")
        if entry.get("IsDir") or entry.get("Path") != name or name == current:
            continue
        created = backup_time(database, name)
        if created is not None and created < cutoff:
            result.append(name)
    return sorted(set(result))


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as target:
        json.dump(value, target, indent=2, ensure_ascii=False)
        target.write("\n")
    os.replace(temporary, path)


def load_config(path):
    config = json.loads(Path(path).read_text())
    if config["databases"] != DATABASES or config["retention_days"] != 30:
        raise ValueError("Unexpected database scope or retention")
    if config["remote_root"] != "summa_onedrive:Summa backup":
        raise ValueError("Unexpected OneDrive backup root")
    return config


class Backups:
    def __init__(self, config):
        self.config = config
        self.local = Path(config["local_root"])
        self.state = Path(config["state_root"])
        self.deploy_gid = __import__("grp").getgrnam("deploy").gr_gid

    def progress(self, database, phase):
        if not hasattr(self, "current"):
            return
        self.current["databases"][database] = {"phase": phase}
        self.current["updated_utc"] = datetime.now(timezone.utc).isoformat()
        atomic_json(self.state / "current-run.json", self.current)

    def share_encrypted(self, path, mode):
        os.chown(path, 0, self.deploy_gid)
        os.chmod(path, mode)

    def rclone(self, *args, stdout=subprocess.PIPE):
        return run(["/usr/sbin/runuser", "-u", "deploy", "--",
                    "/usr/local/bin/rclone", "--config", self.config["rclone_config"],
                    "--contimeout", "15s", "--timeout", "2m", "--retries", "3",
                    "--low-level-retries", "5", "--retries-sleep", "15s", *args],
                   stdout=stdout, timeout=1200)

    def destination(self, database):
        return self.config["remote_root"] + "/" + DATABASES[database]

    def create(self, database):
        now = datetime.now(timezone.utc)
        name = f"summa-{database}-{now.strftime(FORMAT)}-{uuid.uuid4().hex[:8]}.tar.age"
        folder = self.local / database
        folder.mkdir(mode=0o750, parents=True, exist_ok=True)
        self.share_encrypted(folder, 0o750)
        # Plaintext is private to root and removed even if dump/encryption fails.
        with tempfile.TemporaryDirectory(prefix=".work-", dir=self.local) as work:
            work = Path(work)
            dump = work / "database.dump"
            with dump.open("wb") as target:
                run(["/usr/sbin/runuser", "-u", "postgres", "--",
                     "/usr/bin/pg_dump", "--host=/var/run/postgresql", "--port=5432",
                     "--format=custom", "--compress=6", "--no-owner", "--no-privileges",
                     "--lock-wait-timeout=15s", "--dbname=" + database], stdout=target)
            if dump.stat().st_size < 100:
                raise RuntimeError("Database dump is empty or truncated")
            run(["/usr/bin/pg_restore", "--list", str(dump)], stdout=subprocess.DEVNULL)
            metadata = {
                "version": 1, "database": database, "created_utc": now.isoformat(),
                "dump_format": "PostgreSQL custom", "dump_sha256": sha256(dump),
                "dump_bytes": dump.stat().st_size,
                "postgres_version": run(["/usr/bin/pg_dump", "--version"]).decode().strip(),
            }
            # Preserve the application's encryption material inside the encrypted archive.
            # It is never printed, put in repository files, or uploaded in plaintext.
            recovery_files = self.config.get("recovery_files", {}).get(database, {})
            for label, source in recovery_files.items():
                if Path(label).name != label or not Path(source).is_file():
                    raise RuntimeError("Missing or invalid recovery file")
                recovery = work / "recovery"
                recovery.mkdir(mode=0o700, exist_ok=True)
                shutil.copyfile(source, recovery / label)
                os.chmod(recovery / label, 0o600)
            metadata["recovery_files"] = sorted(recovery_files)
            atomic_json(work / "backup.json", metadata)
            # These are required alongside the fiscal database to retain its files.
            if database == "summa_fiscal":
                for label, source in self.config["fiscal_attachments"].items():
                    if not Path(source).is_dir():
                        raise RuntimeError(f"Missing fiscal attachment directory: {label}")
                    shutil.copytree(source, work / label, symlinks=True)
            archive = work / "backup.tar"
            with tarfile.open(archive, "w") as tar:
                for item in sorted(work.iterdir()):
                    if item != archive:
                        tar.add(item, arcname=item.name)
            encrypted = work / name
            self.progress(database, "encrypting")
            run(["/usr/bin/age", "--recipients-file", self.config["recipients_file"],
                 "--output", str(encrypted), str(archive)])
            # Publish a completed local file atomically; incomplete files stay private.
            os.replace(encrypted, folder / name)
        path = folder / name
        self.share_encrypted(path, 0o640)
        metadata.update({"filename": name, "encrypted_bytes": path.stat().st_size,
                         "encrypted_sha256": sha256(path)})
        return path, metadata

    def verify_remote(self, path):
        # Download encrypted bytes and compare SHA256, independent of provider hashes.
        with tempfile.TemporaryFile() as downloaded:
            self.rclone("cat", path, stdout=downloaded)
            downloaded.seek(0)
            digest = hashlib.sha256()
            size = 0
            for chunk in iter(lambda: downloaded.read(1024 * 1024), b""):
                digest.update(chunk)
                size += len(chunk)
            return size, digest.hexdigest()

    def prune(self, database, current):
        now = datetime.now(timezone.utc)
        destination = self.destination(database)
        entries = json.loads(self.rclone("lsjson", destination, "--files-only"))
        candidates = retention_candidates(database, entries, current, now,
                                           self.config["retention_days"])
        for name in candidates:
            # deletefile addresses one validated file; never purge/sync or entire folders.
            self.rclone("deletefile", destination + "/" + name)
            log(f"{database}: expired OneDrive backup removed: {name}")
        folder = self.local / database
        entries = [{"Name": p.name, "Path": p.name, "IsDir": not p.is_file()}
                   for p in folder.iterdir() if not p.is_symlink()]
        for name in retention_candidates(database, entries, current, now,
                                         self.config["retention_days"]):
            (folder / name).unlink()
            log(f"{database}: expired local backup removed: {name}")

    def one(self, database):
        log(f"{database}: starting backup")
        self.progress(database, "dumping")
        path, metadata = self.create(database)
        destination = self.destination(database) + "/" + path.name
        self.progress(database, "uploading")
        self.rclone("copyto", str(path), destination, "--immutable")
        self.progress(database, "verifying")
        size, digest = self.verify_remote(destination)
        if size != metadata["encrypted_bytes"] or digest != metadata["encrypted_sha256"]:
            raise RuntimeError("OneDrive verification failed; retention was not run")
        metadata["verified_utc"] = datetime.now(timezone.utc).isoformat()
        atomic_json(self.state / (database + ".json"), metadata)
        log(f"{database}: OneDrive verified ({size} encrypted bytes)")
        # This is unreachable on failed dump, upload, or remote verification.
        self.progress(database, "pruning")
        self.prune(database, path.name)
        self.progress(database, "done")
        return metadata

    def all(self):
        self.local.mkdir(mode=0o750, parents=True, exist_ok=True)
        self.share_encrypted(self.local, 0o750)
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        # A killed run may leave private plaintext; only remove our own temp dirs.
        for entry in self.local.glob(".work-*"):
            if entry.is_dir() and not entry.is_symlink():
                shutil.rmtree(entry)
        result = {"started_utc": datetime.now(timezone.utc).isoformat(), "databases": {}}
        self.current = {"started_utc": result["started_utc"], "finished_utc": None,
                        "databases": {database: {"phase": "queued"} for database in DATABASES}}
        atomic_json(self.state / "current-run.json", self.current)
        failed = []
        for database in DATABASES:
            try:
                metadata = self.one(database)
                result["databases"][database] = {"ok": True, **metadata}
            except Exception as error:
                # Report a stage/error class, not potentially sensitive command output.
                failed.append(database)
                self.progress(database, "failed")
                result["databases"][database] = {"ok": False, "error_type": type(error).__name__}
                detail = str(error) if type(error) is RuntimeError else type(error).__name__
                log(f"{database}: FAILED ({detail}); other databases will continue")
        result["finished_utc"] = datetime.now(timezone.utc).isoformat()
        result["ok"] = not failed
        atomic_json(self.state / "last-run.json", result)
        self.current["finished_utc"] = result["finished_utc"]
        atomic_json(self.state / "current-run.json", self.current)
        if failed:
            log("Failed databases: " + ", ".join(failed))
            return 1
        log("SUCCESS: all four database backups verified on OneDrive")
        return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/etc/summa-backup/config.json")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("Run as root via the dedicated systemd service")
    os.umask(0o077)
    with open("/run/lock/summa-backup.lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("Another backup run is already active; skipped")
            return 0
        return Backups(load_config(args.config)).all()


if __name__ == "__main__":
    sys.exit(main())
