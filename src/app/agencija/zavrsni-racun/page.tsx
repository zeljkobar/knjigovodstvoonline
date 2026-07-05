export default function ZavrsniRacunPage() {
  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Završni račun</h2>
          <p>Priprema obrazaca, kontrole i zaključna knjiženja za aktivnu firmu i godinu.</p>
        </div>
      </header>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Status modula</h3>
            <span>Prva implementacija pokriva Bilans uspjeha i Bilans stanja.</span>
          </div>
        </div>
        <p className="muted">
          Obrasci se računaju za aktivnu firmu i poslovnu godinu. Konta, izuzeci i formule mogu se
          korigovati u podešavanjima za svaku firmu.
        </p>
      </section>
    </div>
  );
}
