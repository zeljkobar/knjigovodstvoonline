import "server-only";
import { notFound } from "next/navigation";
import { prisma } from "./prisma";
import { requireClientContext, clientScope } from "./client-portal";

export const clientInventoryTypes: Record<string, string> = {"kalkulacije": "Kalkulacije", "nivelacija": "Nivelacije", "prenos": "Prenos robe", "popis": "Popis robe", "otpis": "Otpis robe", "izlazne-fakture": "Izlazne fakture"};
export type ClientInventoryDocument = {
 id: string; number: string; date: Date; status: string; description: string;
 total: string; totalLabel: string; note: string | null; columns: string[];
 lines: { id: string; item: string; values: string[] }[];
};
function decimal(value: { toString(): string } | null) {
 return value === null ? "—" : Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
export async function loadClientInventory(tip: string, options: { id?: string; page?: number; status?: string } = {}) {
 if (!Object.hasOwn(clientInventoryTypes, tip)) notFound();
 if (options.id && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(options.id)) notFound();
 const context = await requireClientContext(["robno"]);
 const page = Math.max(1, Math.min(100000, Math.floor(options.page || 1)));
 const where = { ...clientScope(context), is_deleted: false,
  ...(options.id ? { id: options.id } : {}),
  ...(!options.id && ["DRAFT", "POSTED"].includes(options.status ?? "") ? { status: options.status } : {}) };
 let documents: ClientInventoryDocument[] = [];
 let count = 0;
 if (tip === "kalkulacije") {
 const [rows, totalCount] = await Promise.all([
  prisma.kalkulacija.findMany({ where, skip: options.id ? 0 : (page - 1) * 50, take: options.id ? 1 : 50,
   orderBy: [{ datum_kalkulacije: "desc" }, { id: "desc" }],
   include: { dobavljac: { select: { naziv: true } }, magacin: { select: { naziv: true } }, stavke: { take: options.id ? undefined : 0, orderBy: { redni_broj: "asc" }, include: { artikal: { select: { sifra: true, naziv: true } } } } } }),
  prisma.kalkulacija.count({ where })
 ]);
 count = totalCount;
 documents = rows.map((doc) => ({ id: doc.id, number: doc.interni_broj, date: doc.datum_kalkulacije, status: doc.status,
  description: `${doc.dobavljac.naziv} · ${doc.magacin.naziv} · Račun ${doc.broj_racuna_dobavljaca}`, total: decimal(doc.ukupno_racun_sa_pdv), totalLabel: "Ukupno sa PDV", note: doc.napomena,
  columns: ["Količina", "Fakturna cijena", "Rabat %", "Nabavna vrijednost", "Ulazni PDV", "Prodajna cijena sa PDV", "Prodajna vrijednost sa PDV"],
  lines: doc.stavke.map((line) => ({ id: line.id, item: `${line.artikal.sifra} · ${line.artikal.naziv}`,
    values: [decimal(line.kolicina), decimal(line.fakturna_cijena), decimal(line.rabat_procenat), decimal(line.nabavna_vrijednost), decimal(line.ulazni_pdv_iznos), decimal(line.prodajna_cijena_sa_pdv), decimal(line.prodajna_vrijednost_sa_pdv)] }))
 }));
 }
 if (tip === "nivelacija") {
 const [rows, totalCount] = await Promise.all([
  prisma.nivelacijaCijena.findMany({ where, skip: options.id ? 0 : (page - 1) * 50, take: options.id ? 1 : 50,
   orderBy: [{ datum: "desc" }, { id: "desc" }],
   include: { magacin: { select: { naziv: true } }, stavke: { take: options.id ? undefined : 0, orderBy: { redni_broj: "asc" }, include: { artikal: { select: { sifra: true, naziv: true } } } } } }),
  prisma.nivelacijaCijena.count({ where })
 ]);
 count = totalCount;
 documents = rows.map((doc) => ({ id: doc.id, number: doc.interni_broj, date: doc.datum, status: doc.status,
  description: doc.magacin.naziv, total: decimal(doc.ukupna_promjena_maloprodajne_vrijednosti), totalLabel: "Promjena MP vrijednosti", note: doc.napomena,
  columns: ["Količina", "Stara cijena", "Nova cijena", "Promjena vrijednosti"],
  lines: doc.stavke.map((line) => ({ id: line.id, item: `${line.artikal.sifra} · ${line.artikal.naziv}`,
    values: [decimal(line.knjigovodstvena_kolicina), decimal(line.stara_prodajna_cijena_sa_pdv), decimal(line.nova_prodajna_cijena_sa_pdv), decimal(line.promjena_maloprodajne_vrijednosti)] }))
 }));
 }
 if (tip === "prenos") {
 const [rows, totalCount] = await Promise.all([
  prisma.prenosRobe.findMany({ where, skip: options.id ? 0 : (page - 1) * 50, take: options.id ? 1 : 50,
   orderBy: [{ datum: "desc" }, { id: "desc" }],
   include: { izvorni_magacin: { select: { naziv: true } }, odredisni_magacin: { select: { naziv: true } }, stavke: { take: options.id ? undefined : 0, orderBy: { redni_broj: "asc" }, include: { artikal: { select: { sifra: true, naziv: true } } } } } }),
  prisma.prenosRobe.count({ where })
 ]);
 count = totalCount;
 documents = rows.map((doc) => ({ id: doc.id, number: doc.interni_broj, date: doc.datum, status: doc.status,
  description: `${doc.izvorni_magacin.naziv} → ${doc.odredisni_magacin.naziv}`, total: decimal(doc.ukupna_nabavna_vrijednost), totalLabel: "Nabavna vrijednost", note: doc.napomena,
  columns: ["Količina", "Nabavna cijena", "Nabavna vrijednost", "Prodajna vrijednost"],
  lines: doc.stavke.map((line) => ({ id: line.id, item: `${line.artikal.sifra} · ${line.artikal.naziv}`,
    values: [decimal(line.kolicina), decimal(line.jedinicna_nabavna_cijena), decimal(line.nabavna_vrijednost), decimal(line.prodajna_vrijednost)] }))
 }));
 }
 if (tip === "popis") {
 const [rows, totalCount] = await Promise.all([
  prisma.popisRobe.findMany({ where, skip: options.id ? 0 : (page - 1) * 50, take: options.id ? 1 : 50,
   orderBy: [{ datum: "desc" }, { id: "desc" }],
   include: { magacin: { select: { naziv: true } }, stavke: { take: options.id ? undefined : 0, orderBy: { redni_broj: "asc" }, include: { artikal: { select: { sifra: true, naziv: true } } } } } }),
  prisma.popisRobe.count({ where })
 ]);
 count = totalCount;
 documents = rows.map((doc) => ({ id: doc.id, number: doc.interni_broj, date: doc.datum, status: doc.status,
  description: doc.magacin.naziv, total: `${decimal(doc.ukupna_vrijednost_viska)} / ${decimal(doc.ukupna_vrijednost_manjka)}`, totalLabel: "Višak / manjak", note: doc.napomena,
  columns: ["Knjigovodstvena količina", "Popisana količina", "Razlika količine", "Vrijednost razlike"],
  lines: doc.stavke.map((line) => ({ id: line.id, item: `${line.artikal.sifra} · ${line.artikal.naziv}`,
    values: [decimal(line.knjigovodstvena_kolicina), decimal(line.stvarna_kolicina), decimal(line.razlika_kolicina), decimal(line.nabavna_vrijednost_razlike)] }))
 }));
 }
 if (tip === "otpis") {
 const [rows, totalCount] = await Promise.all([
  prisma.otpisRobe.findMany({ where, skip: options.id ? 0 : (page - 1) * 50, take: options.id ? 1 : 50,
   orderBy: [{ datum: "desc" }, { id: "desc" }],
   include: { magacin: { select: { naziv: true } }, stavke: { take: options.id ? undefined : 0, orderBy: { redni_broj: "asc" }, include: { artikal: { select: { sifra: true, naziv: true } } } } } }),
  prisma.otpisRobe.count({ where })
 ]);
 count = totalCount;
 documents = rows.map((doc) => ({ id: doc.id, number: doc.interni_broj, date: doc.datum, status: doc.status,
  description: `${doc.magacin.naziv} · ${doc.opis_razloga ?? doc.razlog}`, total: decimal(doc.ukupna_nabavna_vrijednost), totalLabel: "Nabavna vrijednost", note: doc.napomena,
  columns: ["Količina", "Nabavna cijena", "Nabavna vrijednost", "Maloprodajna vrijednost"],
  lines: doc.stavke.map((line) => ({ id: line.id, item: `${line.artikal.sifra} · ${line.artikal.naziv}`,
    values: [decimal(line.kolicina), decimal(line.jedinicna_nabavna_cijena), decimal(line.nabavna_vrijednost), decimal(line.maloprodajna_vrijednost)] }))
 }));
 }
 if (tip === "izlazne-fakture") {
 const [rows, totalCount] = await Promise.all([
  prisma.fiskalniIzlazniRacun.findMany({ where, skip: options.id ? 0 : (page - 1) * 50, take: options.id ? 1 : 50,
   orderBy: [{ datum_racuna: "desc" }, { id: "desc" }],
   include: { kupac: { select: { naziv: true } }, stavke: { take: options.id ? undefined : 0, orderBy: { redni_broj: "asc" }, include: { artikal: { select: { sifra: true, naziv: true } } } } } }),
  prisma.fiskalniIzlazniRacun.count({ where })
 ]);
 count = totalCount;
 documents = rows.map((doc) => ({ id: doc.id, number: doc.interni_broj, date: doc.datum_racuna, status: doc.status,
  description: doc.kupac.naziv, total: decimal(doc.ukupno_sa_pdv), totalLabel: "Ukupno sa PDV", note: doc.napomena,
  columns: ["Količina", "Cijena bez PDV", "Rabat %", "Osnovica", "PDV", "Ukupno sa PDV"],
  lines: doc.stavke.map((line) => ({ id: line.id, item: `${line.sifra_artikla} · ${line.naziv_artikla}`,
    values: [decimal(line.kolicina), decimal(line.jedinicna_cijena_bez_pdv), decimal(line.rabat_procenat), decimal(line.osnovica), decimal(line.pdv_iznos), decimal(line.ukupno_sa_pdv)] }))
 }));
 }
 if (options.id && !documents.length) notFound();
 return { context, title: clientInventoryTypes[tip], documents, count, page };
}

export function clientDocumentStatusLabel(tip: string, status: string) {
  if (tip === "kalkulacije" && status === "POSTED") return "Prenesena u KUF";
  return ({ DRAFT: "Nacrt", POSTED: "Proknjiženo", WAITING_KUF: "Čeka prenos u KUF", NEEDS_REVIEW: "Za kontrolu", CANCELLED: "Stornirano", ISSUED: "Izdato", FISCALIZED: "Fiskalizovano" } as Record<string, string>)[status] ?? status;
}
