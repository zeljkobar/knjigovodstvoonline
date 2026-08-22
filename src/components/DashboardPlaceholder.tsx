import { logout } from "@/app/actions";

type DashboardPlaceholderProps = {
  title: string;
  korisnickoIme: string;
  children?: React.ReactNode;
};

export function DashboardPlaceholder({
  title,
  korisnickoIme,
  children
}: DashboardPlaceholderProps) {
  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <p className="eyebrow">Summa Summarum</p>
        <h1>{title}</h1>
        <p className="lead">
          Prijavljeni ste kao <strong>{korisnickoIme}</strong>. Ova stranica je
          privremeni dashboard koji cemo kasnije zamijeniti pravim pregledima.
        </p>
        {children}
        <form action={logout}>
          <button className="secondary-button" type="submit">
            Odjava
          </button>
        </form>
      </section>
    </main>
  );
}
