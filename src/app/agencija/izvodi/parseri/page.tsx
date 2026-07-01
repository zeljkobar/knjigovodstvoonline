import { getIzvodiContext, MissingContext } from "../_shared";
import { prisma } from "@/lib/prisma";

function parserFromNotes(notes: string | null) {
  const match = notes?.match(/Parser:\s*([^|]+)/i);
  return match?.[1]?.trim() || "Nepoznato";
}

export default async function ParseriBanakaPage() {
  const { user, firma, godina } = await getIzvodiContext();

  if (!user.agencija_id || !firma || !godina) {
    return <MissingContext title="Parseri banaka" />;
  }

  const statements = await prisma.bankStatement.findMany({
    where: {
      agencija_id: user.agencija_id,
      firma_id: firma.id,
      poslovna_godina_id: godina.id,
      is_deleted: false
    },
    select: {
      id: true,
      parse_notes: true,
      file_type: true,
      _count: {
        select: {
          lines: true
        }
      }
    }
  });
  const parserStats = new Map<string, { files: number; lines: number }>();

  for (const statement of statements) {
    const parser = parserFromNotes(statement.parse_notes);
    const current = parserStats.get(parser) ?? { files: 0, lines: 0 };
    current.files += 1;
    current.lines += statement._count.lines;
    parserStats.set(parser, current);
  }

  const rows = [
    {
      name: "NLB_XML",
      status: "Aktivan",
      description: "XML parser za NLB izvode iz uzorka u zadaci/nlb izvodi xml.",
      stats: parserStats.get("NLB_XML")
    },
    {
      name: "TEXT_FALLBACK",
      status: "Aktivan",
      description: "Ručni tekst: datum; opis; žiro račun; odliv; priliv.",
      stats: parserStats.get("TEXT_FALLBACK")
    }
  ];

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Parseri banaka</h2>
          <p>Pregled podržanih parsera i koliko je izvoda prošlo kroz njih.</p>
        </div>
      </header>

      <section className="admin-panel">
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Parser</th>
                <th>Status</th>
                <th>Opis</th>
                <th>Izvoda</th>
                <th>Stavki</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td>{row.status}</td>
                  <td>{row.description}</td>
                  <td>{row.stats?.files ?? 0}</td>
                  <td>{row.stats?.lines ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
