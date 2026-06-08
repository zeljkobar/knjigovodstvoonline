import Image from "next/image";

export default function Home() {
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

        <form className="login-form">
          <div className="form-header">
            <h2>Dobro dosli</h2>
            <p>Unesite korisnicko ime i lozinku.</p>
          </div>

          <label className="field">
            <span>Korisnicko ime</span>
            <input
              type="text"
              name="korisnicko_ime"
              autoComplete="username"
              placeholder="npr. admin"
            />
          </label>

          <label className="field">
            <span>Lozinka</span>
            <input
              type="password"
              name="lozinka"
              autoComplete="current-password"
              placeholder="Unesite lozinku"
            />
          </label>

          <button type="submit">Prijava</button>

          <div className="role-note" aria-label="Tipovi korisnika">
            <span>admin</span>
            <span>agencija</span>
            <span>klijent</span>
          </div>
        </form>
      </section>
    </main>
  );
}
