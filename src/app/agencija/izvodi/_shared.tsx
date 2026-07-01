import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

export const bankStatementStatuses = {
  imported: "IMPORTED",
  needsReview: "NEEDS_REVIEW",
  ready: "READY",
  posted: "POSTED"
} as const;

export const lineStatusLabels: Record<string, string> = {
  UNMATCHED: "Neprepoznato",
  MATCHED_PARTNER: "Partner",
  READY: "Spremno",
  NEEDS_REVIEW: "Provjera",
  IGNORED: "Ignorisano"
};

export const statementStatusLabels: Record<string, string> = {
  IMPORTED: "Uvezen",
  NEEDS_REVIEW: "Za provjeru",
  READY: "Spreman",
  POSTED: "Proknjižen"
};

export function money(value: number) {
  return value.toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function displayDate(value: Date | string) {
  return new Intl.DateTimeFormat("sr-Latn-ME").format(new Date(value));
}

export function dateInputValue(value?: string) {
  return value ?? "";
}

export function parseDateFilter(value?: string) {
  if (!value) {
    return null;
  }

  return new Date(`${value}T00:00:00.000Z`);
}

export function statementBalanceOk(statement: {
  opening_balance: unknown;
  total_inflow: unknown;
  total_outflow: unknown;
  closing_balance: unknown;
}) {
  const opening = Math.round(Number(statement.opening_balance) * 100);
  const inflow = Math.round(Number(statement.total_inflow) * 100);
  const outflow = Math.round(Number(statement.total_outflow) * 100);
  const closing = Math.round(Number(statement.closing_balance) * 100);

  return opening + inflow - outflow === closing;
}

export async function getIzvodiContext() {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return {
      user,
      firma: null,
      godina: null
    };
  }

  const [firma, godina] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: workContext.firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false,
        aktivan: true,
        ...(user.rola === "admin_agencije"
          ? {}
          : {
              korisnici: {
                some: {
                  korisnik_id: user.id,
                  is_deleted: false
                }
              }
            })
      },
      select: {
        id: true,
        naziv: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        id: true,
        godina: true,
        zakljucena: true
      }
    })
  ]);

  return {
    user,
    firma,
    godina
  };
}

export function MissingContext({ title }: { title: string }) {
  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>{title}</h2>
        </div>
      </header>
      <section className="admin-panel">
        <p className="empty-state">Izaberite firmu i poslovnu godinu u gornjoj traci.</p>
      </section>
    </div>
  );
}
