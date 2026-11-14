/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { sourceLoader, transactionProxy } = require("../tests/helpers/source-loader.cjs");

require("@next/env").loadEnvConfig(process.cwd());
const db = new PrismaClient();
const rollback = new Error("ROLLBACK_DOKUMENTACIJA");
const date = value => new Date(value + "T00:00:00Z");

async function check(tx) {
  const agency = await tx.agencija.create({ data: { naziv: "OneDrive QA" } });
  const otherAgency = await tx.agencija.create({ data: { naziv: "OneDrive QA druga agencija" } });
  const firm = await tx.firma.create({ data: { agencija_id: agency.id, naziv: "Test dokumentacija" } });
  const other = await tx.firma.create({ data: { agencija_id: otherAgency.id, naziv: "Druga firma" } });
  const yearData = { godina: 2026, datum_od: date("2026-01-01"), datum_do: date("2026-12-31") };
  const year = await tx.poslovnaGodina.create({ data: { ...yearData, firma_id: firm.id } });
  const otherYear = await tx.poslovnaGodina.create({ data: { ...yearData, firma_id: other.id } });
  const scope = { agencija_id: agency.id, firma_id: firm.id, poslovna_godina_id: year.id };
  const foreignScope = { agencija_id: otherAgency.id, firma_id: other.id, poslovna_godina_id: otherYear.id };
  const admin = await tx.korisnik.create({ data: { agencija_id: agency.id, korisnicko_ime: "documentation-qa",
    lozinka_hash: "disabled", rola: "admin_agencije" } });
  const supplier = await tx.komitent.create({ data: { agencija_id: agency.id, firma_id: firm.id, naziv: "Dobavljač" } });
  const journalType = await tx.vrstaNaloga.create({ data: { agencija_id: agency.id, sifra: "DOC",
    naziv: "Dokumentacija", prefiks: "DOC" } });
  const driveId = "test-drive";
  const inbox = "folder/2026/primljeno";
  await tx.dokumentaFolder.create({ data: { agencija_id: agency.id, firma_id: firm.id, drive_id: driveId, folder_id: "folder" } });
  const files = new Map();
  const moves = [];
  let oneDriveFailure = false;
  const load = sourceLoader({
    "@/lib/prisma": { prisma: transactionProxy(tx) },
    "@/lib/dokumentacija-onedrive": {
      oneDriveAccess: async () => ({ token: "test", driveId }),
      ensureDriveFolder: async (_token, _drive, root, segments) => [root, ...segments].join("/"),
      driveItemPath: (_drive, id) => id,
      driveChildren: async (_token, _drive, parent) => [...files.values()].filter(item => item.parentReference.id === parent),
      graph: async (_token, path, options) => {
        if (path.endsWith("createUploadSession")) return { uploadUrl: "https://upload.example.test/session" };
        if (path === "folder:/2026/primljeno") return { id: inbox, folder: {} };
        const [itemId, filename] = path.split(":/");
        const item = filename
          ? [...files.values()].find(row => row.parentReference.id === itemId && row.name === decodeURIComponent(filename))
          : files.get(itemId);
        if (!item) throw new Error("File missing");
        if (options?.method === "PATCH") {
          if (oneDriveFailure) throw new Error("OneDrive unavailable");
          const data = JSON.parse(options.body);
          item.parentReference.id = data.parentReference.id;
          if (data.name) item.name = data.name;
          moves.push(data.parentReference.id);
        }
        return item;
      }
    }
  });
  const { completeDocument, linkKufDocument, lockDocumentKufTarget, prepareDocument, readFiscalLink, syncIncoming } = load("src/lib/dokumentacija.ts");
  const { findPostedDocuments, reconcileDocument } = load("src/lib/dokumentacija-arhiva.ts");
  const qr = "https://mapr.tax.gov.me/ic/#/verify?iic=TEST&tin=01234567&prc=121&crtd=2026-09-01";
  assert.equal(readFiscalLink(qr), qr);
  assert.throws(() => readFiscalLink(qr.replace("https:", "http:")), /MAPR/);
  assert.throws(() => readFiscalLink(qr.replace("mapr.tax.gov.me", "mapr.tax.gov.me.other.test")), /MAPR/);

  function file(id, name, size = 100) {
    const item = { id, name, size, file: { mimeType: "application/pdf" }, parentReference: { id: inbox, driveId } };
    files.set(id, item);
    return item;
  }

  const clientContext = { scope, year, client: true, user: { id: admin.id } };
  const upload = await prepareDocument(clientContext, { naziv: "Račun.pdf", velicina: 100, kategorija: "ULAZNI", qrLink: qr });
  const pending = await tx.primljeniDokument.findUniqueOrThrow({ where: { id: upload.id } });
  assert.equal(pending.status, "UPLOAD");
  const uploaded = file("portal-upload", pending.naziv_u_oblaku, 99);
  await assert.rejects(() => completeDocument(clientContext, upload.id), /očekivani fajl/);
  uploaded.size = 100;
  await completeDocument(clientContext, upload.id);
  await completeDocument(clientContext, upload.id);
  assert.equal(await tx.auditLog.count({ where: { entitet_id: upload.id, akcija: "prijem" } }), 1);
  await assert.rejects(() => completeDocument({ ...clientContext, scope: foreignScope }, upload.id), /nije dostupan/);

  file("scan-1", "scan.pdf");
  assert.equal(await syncIncoming(scope, 2026), 1);
  assert.equal(await syncIncoming(scope, 2026), 0);

  let number = 0;
  for (const [code, destination] of [["VIRMANI", "09"], ["KARTICA", "09/kartica"], ["GOTOVINA", "09/gotovina"]]) {
    number += 1;
    const kind = await tx.racunVrsta.create({ data: { agencija_id: agency.id, firma_id: firm.id,
      dokument_tip: "KUF", sifra: code, naziv: code, vrsta_naloga_id: journalType.id } });
    const book = await tx.kufBook.create({ data: { ...scope, racun_vrsta_id: kind.id, redni_broj: number,
      internal_kuf_number: code, mjesec: 9, kuf_date: date("2026-09-30") } });
    const journal = await tx.nalog.create({ data: { ...scope, vrsta_naloga_id: journalType.id, broj: number, datum: date("2026-09-30"), status: "DRAFT" } });
    const entry = await tx.kufEntry.create({ data: { ...scope, kuf_book_id: book.id, journal_id: journal.id, dobavljac_id: supplier.id,
      redni_broj: number, internal_kuf_number: code, supplier_invoice_number: code, invoice_date: date("2026-09-01"),
      receipt_date: date("2026-09-01"), posting_status: "POSTED", total_base: "100", total_input_vat: "0", total_gross: "100" } });
    const item = file("scan-" + (number + 1), "scan.pdf");
    assert.equal(await syncIncoming(scope, 2026), 1);
    const doc = await tx.primljeniDokument.findFirstOrThrow({ where: { item_id: item.id } });
    await assert.rejects(() => linkKufDocument(tx, foreignScope, doc.id, entry.id, admin.id), /nije dostupan/);
    await lockDocumentKufTarget(tx, scope, book.id, [entry.invoice_date]);
    await linkKufDocument(tx, scope, doc.id, entry.id, admin.id);
    assert.deepEqual(await findPostedDocuments(scope), []);
    await reconcileDocument(doc.id);
    assert.equal(item.parentReference.id, inbox);
    await tx.nalog.update({ where: { id: journal.id }, data: { status: "POSTED" } });
    assert.deepEqual(await findPostedDocuments(scope), [{ id: doc.id }]);
    assert.deepEqual(await findPostedDocuments(foreignScope), []);
    oneDriveFailure = true;
    await reconcileDocument(doc.id);
    assert.match((await tx.primljeniDokument.findUniqueOrThrow({ where: { id: doc.id } })).greska_arhive, /čeka premještanje/);
    assert.equal(item.parentReference.id, inbox);
    oneDriveFailure = false;
    const count = moves.length;
    await reconcileDocument(doc.id);
    await reconcileDocument(doc.id);
    assert.equal(moves.length, count + 1);
    assert.equal(item.parentReference.id, "folder/2026/ulazni/" + destination);
    assert.deepEqual(await findPostedDocuments(scope), []);
    await tx.nalog.update({ where: { id: journal.id }, data: { status: "DRAFT" } });
    await reconcileDocument(doc.id);
    assert.equal(item.parentReference.id, inbox);
    assert.equal(await tx.primljeniDokument.count({ where: { id: doc.id, status: "PRIMLJENO", item_id: item.id } }), 1);
  }
  await tx.poslovnaGodina.update({ where: { id: year.id }, data: { zakljucena: true } });
  const firstBook = await tx.kufBook.findFirstOrThrow({ where: scope });
  await assert.rejects(() => lockDocumentKufTarget(tx, scope, firstBook.id, []), /nije otvorena/);
  await load("src/lib/company-purge.ts").purgeCompanyData(tx, { agencijaId: agency.id, firmaId: firm.id,
    potvrdaNaziva: firm.naziv, korisnikId: admin.id });
  assert.equal(await tx.primljeniDokument.count({ where: { firma_id: firm.id } }), 0);
  assert.equal(await tx.dokumentaFolder.count({ where: { firma_id: firm.id } }), 0);
  assert.equal(await tx.firma.count({ where: { id: other.id } }), 1);
}

(async () => {
  try {
    await db.$transaction(async tx => { await check(tx); throw rollback; }, { timeout: 90000 });
  } catch (error) {
    if (error !== rollback) throw error;
    console.log("PASS dokumentacija: potvrda prijema, scope, duplikati, zaključana godina, tri KUF odredišta, greška/retry, vraćanje u nacrt i purge.");
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
