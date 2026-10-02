import Link from "next/link";
import { agencyProfileSelect, agencyContractSnapshot, clientContractSnapshot, readContractSnapshot, contractDirectorSelect } from "@/lib/agency-profile";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AccountingContractDocument } from "../_components/AccountingContractDocument";
import "../contract.css";

type StampaUgovoraPageProps = {
  params: Promise<{
    firmaId: string;
  }>;
};

export default async function StampaUgovoraPage({ params }: StampaUgovoraPageProps) {
  const user = await requireRole("admin_agencije");
  const { firmaId } = await params;

  if (!user.agencija_id) {
    return null;
  }

  const firma = await prisma.firma.findFirst({
    where: {
      id: firmaId,
      agencija_id: user.agencija_id,
      is_deleted: false,
      ...(user.rola === "admin_agencije"
        ? {}
        : {
            korisnici: {
              some: {
                korisnik_id: user.id,
                is_deleted: false
              }
            }
          })
    },
    select: {
      id: true,
      naziv: true,
      pib: true,
      pdv_broj: true,
      adresa: true,
      grad: true,
      opstina: true,
      email: true,
      telefon: true,
      odgovorna_lica: {...contractDirectorSelect, where: {...contractDirectorSelect.where, agencija_id: user.agencija_id}},
      agencija: { select: agencyProfileSelect },
      ugovor: {
        select: {
          datum_zakljucenja: true,
          dan_placanja: true,
          nadlezni_sud: true,
          agencija_snapshot: true,
          klijent_snapshot: true,
          datum_pocetka: true,
          datum_prestanka: true,
          mjesecna_cijena: true,
          valuta: true,
          rok_placanja_dana: true,
          dan_fakturisanja: true,
          paket: true,
          dodatne_usluge: true,
          dugovanje: true,
          automatsko_fakturisanje: true,
          faktura_kao_nacrt: true,
          napomena: true
        }
      }
    }
  });

  if (!firma) {
    notFound();
  }

  const ugovor = firma.ugovor;
  const agency = readContractSnapshot(ugovor?.agencija_snapshot ?? null, agencyContractSnapshot(firma.agencija));
  const client = readContractSnapshot(ugovor?.klijent_snapshot ?? null, clientContractSnapshot(firma));

  return (
    <main className="print-page accounting-contract-page">
      <div className="print-toolbar">
        <Link className="table-link" href={`/agencija/firme/ugovori?firma=${firma.id}`}>
          Nazad na ugovor
        </Link>
        <PrintButton label="Štampaj ugovor" />
      </div>

      <div className="contract-screen-note">
        {!ugovor ? <p>Ovo je pregled prije čuvanja ugovora. Unesite datume, cijenu i uslove kroz „Ugovor i cijena“.</p> : null}
        <p>Prazna mjesta označavaju podatke koje treba dopuniti. Podaci zastupnika klijenta preuzimaju se iz firme pri čuvanju novog ugovora ili izričitom osvježavanju podataka strana.</p>
      </div>
      <AccountingContractDocument agency={agency} client={client} contract={ugovor}/>

    </main>
  );
}
