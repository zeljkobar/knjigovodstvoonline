import Image from "next/image";
import { login } from "./actions";

type HomeProps = {
  searchParams?: Promise<{
    greska?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  prazno: "Unesite korisnicko ime i lozinku.",
  prijava: "Korisnicko ime ili lozinka nisu ispravni.",
  sesija: "Sesija je istekla. Prijavite se ponovo.",
  lozinka_postavljena: "Lozinka je postavljena. Mozete se prijaviti.",
  previse_pokusaja: "Previše neuspješnih pokušaja. Pokušajte ponovo za 15 minuta."
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const errorMessage = params?.greska ? errorMessages[params.greska] : null;

  return (
    <main className="home">
      <section className="login-screen">
        <div className="login-intro">
          <Image
            className="brand-logo"
            src="/summasummarum_logo.svg"
            alt="Summa Summarum"
            width={420}
            height={125}
            priority
          />
          <p className="eyebrow">Knjigovodstveni portal</p>
          <h1>Prijava u sistem</h1>
          <p className="lead">
            Jedan ulaz za administratore, knjigovodstvene agencije i klijente
            koji pristupaju svojim izvjestajima.
          </p>
        </div>

        <form className="login-form" action={login}>
          <div className="form-header">
            <h2>Dobro dosli</h2>
            <p>Unesite korisnicko ime i lozinku.</p>
          </div>

          {errorMessage ? (
            <p className="form-error" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <label className="field">
            <span>Korisnicko ime</span>
            <input
              type="text"
              name="korisnicko_ime"
              autoComplete="username"
              placeholder="npr. admin"
              required
            />
          </label>

          <label className="field">
            <span>Lozinka</span>
            <input
              type="password"
              name="lozinka"
              autoComplete="current-password"
              placeholder="Unesite lozinku"
              required
            />
          </label>

          <button type="submit">Prijava</button>

          <div className="role-note" aria-label="Tipovi korisnika">
            <span>admin</span>
            <span>admin agencije</span>
            <span>korisnik agencije</span>
            <span>klijent</span>
          </div>
        </form>
      </section>
    </main>
  );
}
