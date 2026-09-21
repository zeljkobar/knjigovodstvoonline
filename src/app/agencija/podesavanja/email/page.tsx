import { requireRole } from "@/lib/auth";
import { SYSTEM_EMAIL_FROM_ADDRESS } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import {
  saveAgencyEmailSettings,
  sendAgencyEmailTestAction
} from "./actions";

type PageProps = {
  searchParams?: Promise<{ poruka?: string }>;
};

const messages: Record<string, string> = {
  sacuvano: "Email podešavanja su sačuvana.",
  test_poslat: "Probna poruka je poslata na Reply-To adresu.",
  test_greska: "Probna poruka nije poslata. Provjerite centralna SMTP podešavanja.",
  email_nevalidan: "Unesite ispravnu Reply-To email adresu.",
  email_nedostaje: "Prvo sačuvajte Reply-To email adresu.",
  agencija_nedostaje: "Agencija nije pronađena."
};

export default async function AgencyEmailSettingsPage({ searchParams }: PageProps) {
  const [user, params] = await Promise.all([
    requireRole("admin_agencije"),
    searchParams
  ]);

  if (!user.agencija_id) {
    return <p className="admin-message">Agencija nije pronađena.</p>;
  }

  const agency = await prisma.agencija.findFirst({
    where: { id: user.agencija_id, is_deleted: false, aktivan: true },
    select: { naziv: true, email_reply_to: true }
  });

  if (!agency) {
    return <p className="admin-message">Agencija nije pronađena.</p>;
  }

  const message = params?.poruka ? messages[params.poruka] : null;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Podešavanja</p>
          <h1>Email podešavanja</h1>
          <p className="muted-text">Agencija: {agency.naziv}</p>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Pošiljalac i odgovori</h3>
            <p className="muted-text">
              Poruke se šalju sa centralne adrese, a odgovor prima vaša agencija.
            </p>
          </div>
        </div>

        <dl className="detail-list">
          <div>
            <dt>Adresa pošiljaoca</dt>
            <dd>{SYSTEM_EMAIL_FROM_ADDRESS}</dd>
          </div>
        </dl>

        <form action={saveAgencyEmailSettings} className="admin-form">
          <label>
            <span>Reply-To adresa</span>
            <input
              defaultValue={agency.email_reply_to ?? ""}
              maxLength={320}
              name="email_reply_to"
              placeholder="npr. agencija@gmail.com"
              required
              type="email"
            />
          </label>
          <button type="submit">Sačuvaj podešavanja</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Provjera slanja</h3>
            <p className="muted-text">
              Probna poruka biće poslata na trenutno sačuvanu Reply-To adresu.
            </p>
          </div>
        </div>
        <form action={sendAgencyEmailTestAction}>
          <button disabled={!agency.email_reply_to} type="submit">
            Pošalji probni email
          </button>
        </form>
      </section>
    </div>
  );
}
