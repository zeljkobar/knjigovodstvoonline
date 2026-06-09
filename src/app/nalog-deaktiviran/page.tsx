import Link from "next/link";

type NalogDeaktiviranPageProps = {
  searchParams?: Promise<{
    razlog?: string;
  }>;
};

const messages = {
  korisnik: {
    title: "Vas nalog je deaktiviran",
    text: "Pristup sistemu je trenutno onemogucen za ovaj korisnicki nalog. Obratite se administratoru kako bi provjerio status naloga."
  },
  agencija: {
    title: "Pristup agenciji je deaktiviran",
    text: "Agencija kojoj pripada ovaj nalog trenutno nije aktivna u sistemu. Obratite se administratoru platforme za vise informacija."
  }
};

export default async function NalogDeaktiviranPage({
  searchParams
}: NalogDeaktiviranPageProps) {
  const params = await searchParams;
  const content =
    params?.razlog === "agencija" ? messages.agencija : messages.korisnik;

  return (
    <main className="status-page">
      <section className="status-card">
        <p className="eyebrow">Pristup onemogucen</p>
        <h1>{content.title}</h1>
        <p className="lead">{content.text}</p>
        <Link className="primary-link" href="/">
          Nazad na prijavu
        </Link>
      </section>
    </main>
  );
}
