import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location(
    "summa_backup", Path(__file__).resolve().parents[1] / "scripts/ops/summa-backup.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupSafetyTests(unittest.TestCase):
    def entry(self, name, **extra):
        return {"Name": name, "Path": name, "IsDir": False, **extra}

    def test_retention_only_own_expired_files_in_exact_folder(self):
        now = datetime(2026, 11, 13, tzinfo=timezone.utc)
        old = "summa-spedicija-20261001T000000Z-deadbeef.tar.age"
        current = "summa-spedicija-20261113T000000Z-aabbccdd.tar.age"
        boundary = "summa-spedicija-20261014T000000Z-aabbccdd.tar.age"
        entries = [self.entry(name) for name in [
            old, current, boundary, "other.txt", "database.dump",
            "summa-turizam_prod-20261001T000000Z-deadbeef.tar.age",
            "summa-spedicija-20261301T000000Z-deadbeef.tar.age",
            "../" + old, "summa-spedicija-20261001T000000Z-deadbeef.tar.age.bak"]]
        entries += [self.entry(old, Path="other/" + old), self.entry(old, IsDir=True)]
        self.assertEqual(backup.retention_candidates("spedicija", entries, current, now, 30), [old])
        self.assertEqual(backup.retention_candidates("spedicija", [self.entry(old)], old, now, 30), [])

    def operation(self):
        op = object.__new__(backup.Backups)
        op.config = {"remote_root": "summa_onedrive:Summa backup"}
        op.state = Path("/unused-state")
        op.create = Mock(return_value=(Path("/tmp/test.tar.age"),
                          {"encrypted_bytes": 42, "encrypted_sha256": "correct"}))
        op.rclone = Mock()
        op.verify_remote = Mock(return_value=(42, "correct"))
        op.prune = Mock()
        return op

    def test_failed_upload_never_prunes(self):
        op = self.operation()
        op.rclone.side_effect = RuntimeError("upload failed")
        with self.assertRaises(RuntimeError):
            op.one("spedicija")
        op.prune.assert_not_called()
        op.verify_remote.assert_not_called()

    def test_failed_dump_never_uploads_or_prunes(self):
        op = self.operation()
        op.create.side_effect = RuntimeError("dump failed")
        with self.assertRaises(RuntimeError):
            op.one("spedicija")
        op.rclone.assert_not_called()
        op.prune.assert_not_called()

    def test_one_database_failure_does_not_skip_other_databases(self):
        op = self.operation()
        with tempfile.TemporaryDirectory() as work:
            op.local = Path(work) / "backups"
            op.state = Path(work) / "state"
            op.share_encrypted = Mock()
            op.one = Mock(side_effect=[RuntimeError("failed"), {}, {}, {}])
            self.assertEqual(op.all(), 1)
            self.assertEqual([c.args[0] for c in op.one.call_args_list], list(backup.DATABASES))
            import json
            status = json.loads((op.state / "last-run.json").read_text())
            self.assertFalse(status["ok"])
            self.assertFalse(status["databases"]["knjigovodstvoonline"]["ok"])
            self.assertTrue(status["databases"]["turizam_prod"]["ok"])

    def test_corrupt_download_never_prunes(self):
        op = self.operation()
        op.verify_remote.return_value = (42, "different")
        with self.assertRaises(RuntimeError):
            op.one("spedicija")
        op.prune.assert_not_called()

    def test_verified_upload_allows_pruning_only_its_database(self):
        op = self.operation()
        with patch.object(backup, "atomic_json"):
            op.one("spedicija")
        op.prune.assert_called_once_with("spedicija", "test.tar.age")
        self.assertEqual(op.rclone.call_args.args[-1], "--immutable")

    def test_scope_and_retention_must_match_approved_configuration(self):
        import json
        config = {"databases": backup.DATABASES, "retention_days": 30,
                  "remote_root": "summa_onedrive:Summa backup"}
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / "config.json"
            path.write_text(json.dumps(config))
            self.assertEqual(backup.load_config(path)["retention_days"], 30)
            for key, value in [("remote_root", "summa_onedrive:"),
                               ("databases", {"postgres": "postgres"}),
                               ("retention_days", 1)]:
                path.write_text(json.dumps({**config, key: value}))
                with self.assertRaises(ValueError):
                    backup.load_config(path)


if __name__ == "__main__":
    unittest.main()
