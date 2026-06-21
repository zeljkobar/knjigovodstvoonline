type ModulePlaceholderProps = {
  eyebrow?: string;
  title: string;
};

export function ModulePlaceholder({
  eyebrow,
  title
}: ModulePlaceholderProps) {
  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
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
