import { Prisma } from "@prisma/client";
import { decimalToScaled, scaledToDecimal } from "@/lib/inventory-calculation";

export class PosInventoryError extends Error {
  constructor(
    readonly itemName: string,
    readonly availableMilli: bigint,
    readonly requestedMilli: bigint
  ) {
    super("Nema dovoljno robe na lageru.");
    this.name = "PosInventoryError";
  }
}

export async function applyPosInventoryMovement(
  tx: Prisma.TransactionClient,
  input: {
    agencijaId: string;
    firmaId: string;
    poslovnaGodinaId: string;
    magacinId: string | null;
    invoiceId: string;
    datumPrometa: Date;
    allowNegative: boolean;
    userId: string;
  }
) {
  const existing = await tx.prometZaliha.count({
    where: { tip_dokumenta: "POS_SALE", dokument_id: input.invoiceId }
  });
  if (existing) return { movements: existing, alreadyApplied: true };

  const lines = await tx.stavkaIzlazneFakture.findMany({
    where: { izlazna_faktura_id: input.invoiceId },
    include: {
      artikal: {
        select: { usluga: true, prati_zalihe: true, posljednja_nabavna_cijena: true }
      }
    },
    orderBy: { redni_broj: "asc" }
  });
  const stockLines = lines.filter((line) => !line.artikal.usluga && line.artikal.prati_zalihe);
  if (!stockLines.length) return { movements: 0, alreadyApplied: false };
  if (!input.magacinId) throw new Error("POS kasa nema povezan magacin za robu koja prati zalihe.");

  for (const line of stockLines) {
    await tx.$queryRaw`SELECT "id" FROM "stanja_zaliha" WHERE "firma_id"=${input.firmaId}::uuid AND "poslovna_godina_id"=${input.poslovnaGodinaId}::uuid AND "magacin_id"=${input.magacinId}::uuid AND "artikal_id"=${line.artikal_id}::uuid FOR UPDATE`;
    const state = await tx.stanjeZaliha.findUnique({
      where: {
        firma_id_poslovna_godina_id_magacin_id_artikal_id: {
          firma_id: input.firmaId,
          poslovna_godina_id: input.poslovnaGodinaId,
          magacin_id: input.magacinId,
          artikal_id: line.artikal_id
        }
      }
    });
    const quantity = decimalToScaled(line.kolicina, 3);
    const available = decimalToScaled(state?.kolicina ?? 0, 3);
    if (!input.allowNegative && available < quantity) {
      throw new PosInventoryError(line.naziv_artikla, available, quantity);
    }

    let unitCost = decimalToScaled(state?.prosjecna_nabavna_cijena ?? 0, 4);
    if (unitCost <= BigInt(0)) unitCost = decimalToScaled(line.artikal.posljednja_nabavna_cijena ?? 0, 4);
    const lineCost = (quantity * unitCost + BigInt(50000)) / BigInt(100000);
    const newQuantity = available - quantity;
    const newValue = decimalToScaled(state?.nabavna_vrijednost ?? 0, 2) - lineCost;
    const lineBase = decimalToScaled(line.osnovica, 2);
    const priceDifference = lineBase > lineCost ? lineBase - lineCost : BigInt(0);
    const retailValue = decimalToScaled(line.ukupno_sa_pdv, 2);
    const includedVat = decimalToScaled(line.pdv_iznos, 2);

    if (state) {
      await tx.stanjeZaliha.update({
        where: { id: state.id },
        data: {
          kolicina: scaledToDecimal(newQuantity, 3),
          nabavna_vrijednost: scaledToDecimal(newValue, 2),
          maloprodajna_vrijednost: { decrement: scaledToDecimal(retailValue, 2) },
          razlika_u_cijeni: { decrement: scaledToDecimal(priceDifference, 2) },
          ukalkulisani_pdv: { decrement: scaledToDecimal(includedVat, 2) }
        }
      });
    } else {
      await tx.stanjeZaliha.create({
        data: {
          agencija_id: input.agencijaId,
          firma_id: input.firmaId,
          poslovna_godina_id: input.poslovnaGodinaId,
          magacin_id: input.magacinId,
          artikal_id: line.artikal_id,
          kolicina: scaledToDecimal(newQuantity, 3),
          prosjecna_nabavna_cijena: scaledToDecimal(unitCost, 4),
          nabavna_vrijednost: scaledToDecimal(newValue, 2),
          maloprodajna_vrijednost: scaledToDecimal(-retailValue, 2),
          razlika_u_cijeni: scaledToDecimal(-priceDifference, 2),
          ukalkulisani_pdv: scaledToDecimal(-includedVat, 2)
        }
      });
    }

    await tx.stavkaIzlazneFakture.update({
      where: { id: line.id },
      data: {
        jedinicna_nabavna_cijena: scaledToDecimal(unitCost, 4),
        nabavna_vrijednost: scaledToDecimal(lineCost, 2),
        updated_by: input.userId
      }
    });
    await tx.prometZaliha.create({
      data: {
        agencija_id: input.agencijaId,
        firma_id: input.firmaId,
        poslovna_godina_id: input.poslovnaGodinaId,
        magacin_id: input.magacinId,
        artikal_id: line.artikal_id,
        tip_dokumenta: "POS_SALE",
        dokument_id: input.invoiceId,
        stavka_dokumenta_id: line.id,
        datum_prometa: input.datumPrometa,
        smjer: "OUT",
        kolicina: line.kolicina,
        jedinicna_nabavna_cijena: scaledToDecimal(unitCost, 4),
        nabavna_vrijednost: scaledToDecimal(lineCost, 2),
        prodajna_cijena_sa_pdv: line.jedinicna_cijena_sa_pdv,
        prodajna_vrijednost: line.ukupno_sa_pdv,
        razlika_u_cijeni: scaledToDecimal(priceDifference, 2),
        ukalkulisani_pdv: line.pdv_iznos,
        prosjecna_cijena_nakon: scaledToDecimal(unitCost, 4),
        kolicina_nakon: scaledToDecimal(newQuantity, 3),
        created_by: input.userId
      }
    });
  }
  return { movements: stockLines.length, alreadyApplied: false };
}
