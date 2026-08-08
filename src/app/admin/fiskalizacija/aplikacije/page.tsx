import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { fiscalAdminApi } from "@/lib/fiscal-admin-api";
import { deactivateFiscalApiClient } from "../actions";
import { CreateApiClientForm, RotateKeyForm } from "./ApiClientForms";

type Props = { searchParams?: Promise<{ poruka?: string }> };

export default async function FiscalApiApplicationsPage({ searchParams }: Props) {
  const admin = await requireRole("admin");
  const query = await searchParams;
  const actor = { id: admin.id, name: admin.korisnicko_ime };
  const [clientsResult, companiesResult] = await Promise.allSettled([
    fiscalAdminApi.listApiClients(actor),
    fiscalAdminApi.listCompanies(actor)
  ]);
  const clients = clientsResult.status === "fulfilled" ? clientsResult.value.data : [];
  const companies = companiesResult.status === "fulfilled" ? companiesResult.value.data : [];
  const currentClientId = process.env.FISCAL_API_CLIENT_ID;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Fiskalna platforma</p>
          <h2>API aplikacije</h2>
          <p>Pristupi za ovaj web program, buduću mobilnu ili desktop aplikaciju i partnerske sisteme.</p>
        </div>
        <Link className="table-link" href="/admin/fiskalizacija">Pregled platforme</Link>
      </header>

      {query?.poruka ? (
        <p className="admin-message">
          {query.poruka === "TRENUTNI_API_KLIJENT_ZASTICEN"
            ? "Ovaj sajt ne može deaktivirati sopstveni API pristup."
            : query.poruka === "API_KLIJENT_DEAKTIVIRAN"
              ? "API aplikacija je deaktivirana."
              : "API operacija nije uspjela."}
        </p>
      ) : null}

      <section className="admin-form-section api-client-create-section">
        <div className="panel-header">
          <div>
            <h3>Nova API aplikacija</h3>
            <p>Ovdje ne praviš korisnika koji se prijavljuje lozinkom, već tehnički pristup jednog programa Fiscal API-ju.</p>
          </div>
        </div>
        <CreateApiClientForm
          companies={companies.map((company) => ({
            id: company.id,
            name: company.legalName,
            tin: company.tin
          }))}
        />
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Postojeće API aplikacije</h3>
            <p>Svaka kartica predstavlja jedan program, ne fizičku osobu.</p>
          </div>
          <span>{clients.length} ukupno</span>
        </div>
        <div className="api-client-list">
          {clients.map((client) => {
            const isCurrent = client.clientId === currentClientId;
            return (
              <article className={`api-client-card${isCurrent ? " current" : ""}`} key={client.id}>
                <div className="api-client-card-head">
                  <div>
                    <h4>{client.name}</h4>
                    <code>{client.clientId}</code>
                  </div>
                  <span>{client.isActive ? isCurrent ? "Ovaj sajt" : "Aktivna" : "Deaktivirana"}</span>
                </div>
                <dl className="api-client-meta">
                  <div><dt>Pristup firmama</dt><dd>{client.permissions.includes("platform:admin") ? "Sve sadašnje i buduće firme" : `${client.companyIds.length} dodijeljenih firmi`}</dd></div>
                  <div><dt>Ključ</dt><dd><code>{client.keyPrefix}…</code></dd></div>
                  <div><dt>Posljednje korišćenje</dt><dd>{client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString("sr-Latn-ME") : "Nikad"}</dd></div>
                  <div><dt>Važi do</dt><dd>{client.expiresAt ? new Date(client.expiresAt).toLocaleString("sr-Latn-ME") : "Bez roka"}</dd></div>
                </dl>
                <div className="api-permission-badges">{client.permissions.map((permission) => <code key={permission}>{permission}</code>)}</div>
                <div className="api-client-actions">
                  {client.isActive && !isCurrent ? <>
                    <RotateKeyForm id={client.id} />
                    <form action={deactivateFiscalApiClient}>
                      <input type="hidden" name="client_id" value={client.id} />
                      <button>Deaktiviraj aplikaciju</button>
                    </form>
                  </> : isCurrent ? <p>Zaštićena je jer je ovaj sajt trenutno koristi.</p> : <p>Pristup je ugašen.</p>}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
