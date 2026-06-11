type ModulePlaceholderProps = {
  eyebrow?: string;
  title: string;
};

export function ModulePlaceholder({
  eyebrow = "Modul",
  title
}: ModulePlaceholderProps) {
  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
      </header>

      <section className="admin-panel">
        <p className="empty-state">
          Ovaj modul je spreman u navigaciji. Implementacija ekrana i poslovne
          logike ide u narednom koraku.
        </p>
      </section>
    </div>
  );
}
