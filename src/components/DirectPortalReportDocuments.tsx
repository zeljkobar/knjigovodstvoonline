import Link from "next/link";
import { formatPortalMoney } from "@/lib/direct-portal-dashboard";
import {
  directPortalReportChannelLabels,
  directPortalReportDocumentLabels,
  directPortalReportPaymentLabels,
  type DirectPortalReport
} from "@/lib/direct-portal-reports";

const MAX_VISIBLE_DOCUMENTS = 200;

export function DirectPortalReportDocuments({
  documents,
  showReportAmount = false
}: {
  documents: DirectPortalReport["documents"];
  showReportAmount?: boolean;
}) {
  const visible = documents.slice(0, MAX_VISIBLE_DOCUMENTS);

  return (
    <section className="admin-panel" id="dokumenti">
      <div className="panel-header">
        <div>
          <h3>Dokumenti iza rezultata</h3>
          <p className="muted-text">
            Svaki zbir iznad može se provjeriti kroz ove fiskalizovane
            dokumente. Storno je prikazano sa negativnim iznosom.
          </p>
        </div>
        <span>{documents.length} dokumenata</span>
      </div>

      {documents.length > MAX_VISIBLE_DOCUMENTS ? (
        <p className="status-banner">
          Prikazano je prvih {MAX_VISIBLE_DOCUMENTS} dokumenata. CSV izvoz
          sadrži kompletan filtrirani rezultat.
        </p>
      ) : null}

      {visible.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Datum i vrijeme</th>
                <th>Dokument</th>
                <th>Kanal / kasa</th>
                <th>Kupac</th>
                <th>Plaćanje</th>
                {showReportAmount ? <th>Iznos filtera</th> : null}
                <th>Ukupno</th>
                <th>Akcije</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((document) => (
                <tr key={document.id}>
                  <td>
                    {document.date.toLocaleString("sr-Latn-ME", {
                      timeZone: "Europe/Podgorica"
                    })}
                  </td>
                  <td>
                    <strong>
                      {directPortalReportDocumentLabels[document.documentType] ??
                        document.documentType}
                    </strong>
                    <small>
                      {document.officialNumber || document.localNumber}
                    </small>
                    {document.correction ? <small>Korektivni dokument</small> : null}
                  </td>
                  <td>
                    {directPortalReportChannelLabels[document.channel] ??
                      document.channel}
                    <small>{document.register}</small>
                  </td>
                  <td>
                    {document.buyer}
                    {document.buyerTaxNumber ? (
                      <small>{document.buyerTaxNumber}</small>
                    ) : null}
                  </td>
                  <td>
                    {document.paymentMethods
                      .map(
                        (method) =>
                          directPortalReportPaymentLabels[method] ?? method
                      )
                      .join(", ")}
                  </td>
                  {showReportAmount ? (
                    <td>{formatPortalMoney(document.reportAmount)} €</td>
                  ) : null}
                  <td>{formatPortalMoney(document.gross)} €</td>
                  <td>
                    <div className="table-actions">
                      <Link
                        className="table-button"
                        href={`/portal/racuni/${document.id}`}
                      >
                        Detalj
                      </Link>
                      <Link
                        className="table-button"
                        href={`/stampa/portal/racuni/${document.id}`}
                        target="_blank"
                        prefetch={false}
                      >
                        A4
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted-text">
          Nema fiskalizovanih dokumenata za izabrane filtere.
        </p>
      )}
    </section>
  );
}
