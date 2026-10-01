import "server-only";
import { prisma } from "./prisma";
import { clientScope, requireClientContext } from "./client-portal";
import { clientPartnerTypes } from "./client-partner-policy";
import { invoicePostingDefaultScope, invoicePostingDocumentTypes } from "./account-plan";
import { decimalToScaled } from "./inventory-calculation";

export async function loadClientDashboard(foreign = false) {
  const context = await requireClientContext(["izvjestaji", "nalozi"]);
  const types = foreign ? ["ino-kupci", "ino-dobavljaci"] as const : ["kupci", "dobavljaci"] as const;
  return Promise.all(types.map(async (type) => {
    const config = clientPartnerTypes[type];
    const account = await prisma.firmaPodrazumijevanoKonto.findFirst({
      where: {
        firma_id: context.firma.id, namjena: config.purpose,
        dokument_tip: invoicePostingDocumentTypes.general,
        podvrsta: invoicePostingDefaultScope.subtype,
        pdv_stopa_sifra: invoicePostingDefaultScope.vatRate
      }, select: { sifra_konta: true }
    });
    const lines = account ? await prisma.stavkaNaloga.findMany({
      where: {
        komitent_id: { not: null },
        firma_konto: { firma_id: context.firma.id, sifra: account.sifra_konta },
        nalog: { ...clientScope(context), status: "POSTED", is_deleted: false }
      },
      select: { duguje: true, potrazuje: true, komitent: { select: { id: true, naziv: true } } }
    }) : [];
    const partners = new Map<string, { id: string; name: string; cents: bigint }>();
    for (const line of lines) {
      if (!line.komitent) continue;
      const partner = partners.get(line.komitent.id) ?? { id: line.komitent.id, name: line.komitent.naziv, cents: BigInt(0) };
      const balance = decimalToScaled(line.duguje, 2) - decimalToScaled(line.potrazuje, 2);
      partner.cents += config.kind === "customers" ? balance : -balance;
      partners.set(partner.id, partner);
    }
    // Positive receivables/payables only: advances must not rank as debts.
    const ranked = [...partners.values()].filter((row) => row.cents > BigInt(0)).sort((a, b) =>
      a.cents === b.cents ? a.name.localeCompare(b.name, "sr-Latn") : a.cents > b.cents ? -1 : 1
    );
    return {
      type, title: config.label, kind: config.kind, configured: Boolean(account),
      count: ranked.length, total: ranked.reduce((sum, row) => sum + row.cents, BigInt(0)),
      rows: ranked.slice(0, 10).map((row) => ({
        ...row, width: Number(row.cents * BigInt(10000) / ranked[0].cents) / 100
      }))
    };
  }));
}
