import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { approveFiscalCompanyAgencyTransfer, createFiscalClient, rejectFiscalCompanyAgencyTransfer } from "../actions";
import { FiscalClientActivationForm } from "@/components/FiscalClientActivationForm";

type Props = { searchParams?: Promise<{ poruka?: string }> };

const messages: Record<string, string> = {
  KLIJENT_OBAVEZNA_POLJA: "Izaberite način saradnje i unesite naziv firme i PIB. Agencija je obavezna samo za klijenta agencije.",
  PRISTUP_OBAVEZNA_POLJA: "Za pristup klijenta unesite i korisničko ime i e-mail.",
  AGENCIJA_NIJE_PRONADJENA: "Izabrana agencija nije pronađena.",
  KLIJENT_GRESKA: "Fiskalni klijent nije kreiran. Provjerite PIB, korisničko ime i e-mail."
  ,TRANSFER_ODOBREN: "Firma je povezana sa knjigovodstvenom agencijom bez promjene fiskalizacije.",
  TRANSFER_ODBIJEN: "Zahtjev za povezivanje je odbijen.",
  TRANSFER_GRESKA: "Zahtjev nije obrađen. Provjerite njegov status i podatke."
};

export default async function FiscalClientsPage({ searchParams }: Props) {
  const query = await searchParams;
  const [agencies, companies, availableCompanies, transferRequests] = await Promise.all([
    prisma.agencija.findMany({
      where: { aktivan: true, is_deleted: false, is_fiscal_direct_container: false },
      orderBy: { naziv: "asc" },
      select: { id: true, naziv: true, pib: true }
    }),
    prisma.firma.findMany({
      where: { is_deleted: false, fiscalCompanyLink: { isNot: null } },
      orderBy: { created_at: "desc" },
      select: {
        id: true, naziv: true, pib: true,
        agencija: { select: { naziv: true, is_fiscal_direct_container: true } },
        fiscalCompanyLink: { select: { is_suspended: true, onboarding_status: true, fiscal_environment: true } },
        korisnici: {
          where: { access_type: "FISCAL_CLIENT", is_deleted: false },
          select: { korisnik: { select: { korisnicko_ime: true, email: true, aktivan: true } } },
          take: 1
        }
      }
    }),
    prisma.firma.findMany({
      where: { aktivan: true, is_deleted: false, fiscalCompanyLink: null, agencija: { is_fiscal_direct_container: false } },
      orderBy: [{ agencija: { naziv: "asc" } }, { naziv: "asc" }],
      select: { id: true, agencija_id: true, naziv: true, pib: true }
    }),
    prisma.firmaAgencyTransferRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { requested_at: "asc" },
      include: { firma: { select: { naziv: true, pib: true } } }
    })
  ]);
  const message = query?.poruka ? messages[query.poruka] ?? query.poruka : null;

  return <div className="admin-stack">
    <header className="admin-header">
      <div>
        <p className="eyebrow">Fiskalna platforma</p>
        <h2>Fiskalni klijenti</h2>
        <p>Dodaj firmu preko knjigovodstvene agencije ili kao direktnog klijenta bez agencije.</p>
      </div>
      <Link className="secondary-link" href="/admin/fiskalizacija">Pregled platforme</Link>
    </header>
    {message ? <p className="admin-message">{message}</p> : null}

    <section className="admin-form-section">
      <h3>Novi fiskalni klijent</h3>
      <p>Za klijenta agencije račune mogu praviti agencija i klijent. Kod direktnog klijenta račune pravi samo klijent i njegovi korisnici.</p>
      <FiscalClientActivationForm action={createFiscalClient} agencies={agencies} companies={availableCompanies.map((company) => ({ id: company.id, agencijaId: company.agencija_id, naziv: company.naziv, pib: company.pib }))} />
    </section>

    {transferRequests.length ? <section className="admin-panel">
      <div className="panel-header"><h3>Zahtjevi za povezivanje sa agencijom</h3><span>{transferRequests.length}</span></div>
      <div className="table-wrap"><table><thead><tr><th>Firma</th><th>Datum početka</th><th>Ciljna agencija</th><th>Akcija</th></tr></thead><tbody>{transferRequests.map((request) => {
        const agency = agencies.find((item) => item.id === request.target_agencija_id);
        return <tr key={request.id}><td><strong>{request.firma.naziv}</strong><small>PIB {request.firma.pib ?? "—"}</small></td><td>{request.accounting_start_date.toLocaleDateString("sr-Latn-ME")}</td><td>{agency?.naziv ?? "Nepoznata agencija"}</td><td><div className="table-actions"><form action={approveFiscalCompanyAgencyTransfer}><input type="hidden" name="request_id" value={request.id} /><button type="submit">Odobri</button></form><form action={rejectFiscalCompanyAgencyTransfer}><input type="hidden" name="request_id" value={request.id} /><input name="reason" placeholder="Razlog odbijanja" /><button className="danger-button" type="submit">Odbij</button></form></div></td></tr>;
      })}</tbody></table></div>
    </section> : null}

    <section className="admin-panel">
      <div className="panel-header"><h3>Postojeći fiskalni klijenti</h3><span>{companies.length} ukupno</span></div>
      <div className="table-wrap"><table><thead><tr><th>Firma</th><th>Agencija</th><th>Pristup klijenta</th><th>Okruženje</th><th>Status</th><th>Akcija</th></tr></thead><tbody>
        {companies.map((company) => {
          const client = company.korisnici[0]?.korisnik;
          return <tr key={company.id}>
            <td><strong>{company.naziv}</strong><small>PIB {company.pib || "-"}</small></td>
            <td>{company.agencija.is_fiscal_direct_container ? "Direktan klijent — bez agencije" : company.agencija.naziv}</td>
            <td>{client ? <><strong>{client.korisnicko_ime}</strong><small>{client.email} — {client.aktivan ? "aktivan" : "suspendovan"}</small></> : "Nije otvoren"}</td>
            <td>{company.fiscalCompanyLink?.fiscal_environment || "-"}</td>
            <td>{company.fiscalCompanyLink?.is_suspended ? "Suspendovana" : company.fiscalCompanyLink?.onboarding_status || "Nije podešeno"}</td>
            <td><Link className="table-link" href={`/admin/fiskalizacija/${company.id}`}>Otvori podešavanja</Link></td>
          </tr>;
        })}
      </tbody></table></div>
    </section>
  </div>;
}
