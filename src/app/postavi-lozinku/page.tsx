import { setInitialPassword } from "./actions";

type PostaviLozinkuPageProps = {
  searchParams?: Promise<{
    token?: string;
    greska?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  token: "Link za postavljanje lozinke nije ispravan.",
  kratka: "Lozinka mora imati najmanje 8 karaktera.",
  nepoklapanje: "Lozinka i potvrda lozinke se ne poklapaju.",
  nevalidan: "Pozivnica je istekla ili je vec iskoriscena."
};

export default async function PostaviLozinkuPage({
  searchParams
}: PostaviLozinkuPageProps) {
  const params = await searchParams;
  const token = params?.token ?? "";
  const errorMessage = params?.greska ? errorMessages[params.greska] : null;

  return (
    <main className="status-page">
      <section className="status-card password-card">
        <p className="eyebrow">Prvo logovanje</p>
        <h1>Postavite lozinku</h1>
        <p className="lead">
          Unesite lozinku koju cete koristiti za pristup Summa Summarum portalu.
        </p>

        {errorMessage ? (
          <p className="form-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <form className="password-form" action={setInitialPassword}>
          <input name="token" type="hidden" value={token} />
          <label>
            <span>Nova lozinka</span>
            <input
              name="lozinka"
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
            />
          </label>
          <label>
            <span>Potvrdite lozinku</span>
            <input
              name="potvrda_lozinke"
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
            />
          </label>
          <button type="submit">Sacuvaj lozinku</button>
        </form>
      </section>
    </main>
  );
}
