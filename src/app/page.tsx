import Image from "next/image";

export default function Home() {
  return (
    <main className="home">
      <section className="welcome">
        <Image
          className="brand-logo"
          src="/summasummarum_logo.svg"
          alt="Summa Summarum"
          width={420}
          height={125}
          priority
        />
        <p className="eyebrow">Dobrodosli</p>
        <h1>Dobro dosli u Summa Summarum</h1>
        <p className="lead">
          Poslovni sistem za knjigovodstvo, dokumentaciju i pregled klijentskih
          podataka na jednom mjestu.
        </p>
        <div className="status-row" aria-label="Status sistema">
          <span>Baza povezana</span>
          <span>Prisma spremna</span>
          <span>Lokalni razvoj</span>
        </div>
      </section>
    </main>
  );
}
