import Link from "next/link";
import { Prisma } from "@prisma/client";
import { parseMoneyToCents } from "@/lib/payroll";
import "./filters.css";
import { requireAnyRole } from "@/lib/auth";
import { normalizeFiscalInvoiceNumber } from "@/lib/invoice-number";
import { requirePermissionForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type PregledKufDetailPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  params: Promise<{
    id: string;
  }>;
};

const mjeseci = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Jun",
  "Jul",
  "Avgust",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar"
];

function decimalText(value: { toString(): string } | number) {
  const numeric = typeof value === "number" ? value : Number(value.toString());

  return numeric.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function displayDate(date: Date) {
  return date.toLocaleDateString("sr-Latn-ME");
}

function bookPostingLabel(entries: Array<{ posting_status: string }>) {
  if (entries.length === 0) {
    return "Otvorena";
  }

  const posted = entries.filter((entry) => entry.posting_status === "POSTED").length;

  if (posted === entries.length) {
    return "Knjiženo";
  }

  if (posted > 0) {
    return "Djelimično knjižena";
  }

  return "Otvorena";
}

function statusClass(label: string) {
  if (label === "Knjiženo") {
    return "status-pill status-pill--success";
  }

  if (label === "Djelimično knjižena") {
    return "status-pill status-pill--warning";
  }

  return "status-pill";
}

function entryPostingLabel(status: string) {
  return status === "POSTED" ? "Knjiženo" : "Otvorena";
}

export default async function PregledKufDetailPage({ params, searchParams }: PregledKufDetailPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;
  const query = await searchParams;
  const value = (key: string) => { const raw = query[key]; return (Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim().slice(0,120); };
  const filters = { supplier:value("dobavljac"), number:value("broj"), account:value("konto"), status:value("status"), dateType:value("datum_vrsta") === "prijem" ? "prijem" : "racun", from:value("od"), to:value("do"), min:value("iznos_od"), max:value("iznos_do") };
  const workContext = await readWorkContext();

  if (workContext.firmaId) {
    await requirePermissionForUser(user, {
      firmaId: workContext.firmaId,
      modul: "ulazni_racuni",
      akcija: "view"
    });
  }

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <p className="admin-message">Izaberite firmu i godinu u gornjoj traci.</p>
      </div>
    );
  }

  const activeCompany = await prisma.firma.findFirst({
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
      id: true
    }
  });

  const activeYear =
    activeCompany && workContext.poslovnaGodinaId
      ? await prisma.poslovnaGodina.findFirst({
          where: {
            id: workContext.poslovnaGodinaId,
            firma_id: activeCompany.id
          },
          select: {
            id: true,
            godina: true
          }
        })
      : null;

  if (!activeCompany || !activeYear) {
    return (
      <div className="admin-stack">
        <p className="admin-message">KUF knjiga nije dostupna za aktivni kontekst.</p>
      </div>
    );
  }

  const kufBook = await prisma.kufBook.findFirst({
    where: {
      id,
      agencija_id: user.agencija_id,
      firma_id: activeCompany.id,
      poslovna_godina_id: activeYear.id,
      is_deleted: false
    },
    select: {
      id: true,
      internal_kuf_number: true,
      racun_vrsta: {
        select: {
          naziv: true
        }
      },
      mjesec: true,
      kuf_date: true,
      status: true,
      entries: {
        where: {
          is_deleted: false
        },
        orderBy: {
          redni_broj: "desc"
        },
        select: {
          id: true,
          dobavljac_id: true,
          internal_kuf_number: true,
          supplier_invoice_number: true,
          invoice_date: true,
          receipt_date: true,
          total_base: true,
          total_input_vat: true,
          non_deductible_vat: true,
          total_gross: true,
          status: true,
          posting_status: true,
          note: true,
          expense_account: {
            select: {
              sifra: true,
              naziv: true
            }
          },
          dobavljac: {
            select: {
              naziv: true,
              pib: true
            }
          },
          tax_lines: {
            orderBy: {
              vat_rate_percent: "desc"
            },
            select: {
              id: true,
              vat_rate_percent: true,
              tax_base: true,
              input_vat_amount: true
            }
          }
        }
      }
    }
  });

  if (!kufBook) {
    return (
      <div className="admin-stack">
        <p className="admin-message">KUF knjiga nije pronađena.</p>
        <Link className="secondary-button" href="/agencija/racuni/pregled-kuf">
          Nazad na pregled
        </Link>
      </div>
    );
  }

  // All options come only from this authorised book, never from the global partner list.
  const suppliers = [...new Map(kufBook.entries.map(e => [e.dobavljac_id, e.dobavljac])).entries()].sort((a,b)=>a[1].naziv.localeCompare(b[1].naziv,"sr-Latn"));
  const accounts = [...new Map(kufBook.entries.filter(e=>e.expense_account).map(e=>[e.expense_account!.sifra,e.expense_account!])).values()].sort((a,b)=>a.sifra.localeCompare(b.sifra));
  const dateValid = (v:string) => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v);
  const amount = (v:string) => {
    if (!v) return undefined;
    if (!/^-?\d{1,12}([.,]\d{1,2})?$/.test(v)) return null;
    const parsed = parseMoneyToCents(v.replace(/^-/, ""));
    return parsed === null ? null : v.startsWith("-") ? -parsed : parsed;
  };
  const min=amount(filters.min), max=amount(filters.max);
  const invalid = !dateValid(filters.from)||!dateValid(filters.to)||(filters.from&&filters.to&&filters.from>filters.to)||min===null||max===null||(min!==undefined&&max!==undefined&&min!==null&&max!==null&&min>max);
  const cents = (v:{toString():string}) => Number(new Prisma.Decimal(v.toString()).mul(100).toFixed(0));
  const filtered = Object.entries(filters).some(([k,v])=>k!=="dateType"&&v!=="");
  const entries = invalid ? [] : kufBook.entries.filter(entry=>{
    const date=(filters.dateType==="prijem"?entry.receipt_date:entry.invoice_date).toISOString().slice(0,10);
    const gross=cents(entry.total_gross), number=filters.number.toLocaleLowerCase("sr-Latn");
    return (!filters.supplier||entry.dobavljac_id===filters.supplier)
      &&(!number||[entry.internal_kuf_number,entry.supplier_invoice_number,normalizeFiscalInvoiceNumber(entry.supplier_invoice_number)].some(n=>(n??"").toLocaleLowerCase("sr-Latn").includes(number)))
      &&(!filters.account||(filters.account==="BEZ_KONTA"?!entry.expense_account:entry.expense_account?.sifra===filters.account))
      &&(!filters.status||(filters.status==="POSTED"?entry.posting_status==="POSTED":filters.status==="DRAFT"?entry.posting_status!=="POSTED":false))
      &&(!filters.from||date>=filters.from)&&(!filters.to||date<=filters.to)
      &&(min==null||gross>=min)&&(max==null||gross<=max);
  });
  const totals=entries.reduce((sum,e)=>({base:sum.base+cents(e.total_base),vat:sum.vat+cents(e.total_input_vat),gross:sum.gross+cents(e.total_gross)}),{base:0,vat:0,gross:0});
  const bookStatusLabel = bookPostingLabel(kufBook.entries);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>{kufBook.internal_kuf_number}</h2>
          <p>
            Pregled KUF knjige · {mjeseci[kufBook.mjesec - 1] ?? kufBook.mjesec}{" "}
            {activeYear.godina} · {kufBook.racun_vrsta.naziv} · datum KUF-a{" "}
            {displayDate(kufBook.kuf_date)}
          </p>
        </div>
        <div className="table-actions">
          <Link className="secondary-button" href="/agencija/racuni/pregled-kuf">
            Nazad
          </Link>
          <Link className="secondary-button" href={`/agencija/racuni/kuf/${kufBook.id}`}>
            Dodaj račun/e
          </Link>
        </div>
      </header>

      <section className="admin-panel" aria-label="Filteri računa">
        <h3>Filteri računa</h3>
        <form method="get" className="admin-form kuf-book-filters">
          <label>Dobavljač<select name="dobavljac" defaultValue={filters.supplier}><option value="">Svi dobavljači</option>{suppliers.map(([id,p])=><option key={id} value={id}>{p.naziv}{p.pib?` (${p.pib})`:""}</option>)}</select></label>
          <label>Broj računa / KUF broj<input name="broj" defaultValue={filters.number} placeholder="Unesite dio broja" maxLength={120}/></label>
          <label>Konto troška<select name="konto" defaultValue={filters.account}><option value="">Sva konta</option><option value="BEZ_KONTA">Bez konta</option>{accounts.map(a=><option key={a.sifra} value={a.sifra}>{a.sifra} — {a.naziv}</option>)}</select></label>
          <label>Status knjiženja<select name="status" defaultValue={filters.status}><option value="">Svi statusi</option><option value="POSTED">Knjiženo</option><option value="DRAFT">Neproknjiženo</option></select></label>
          <label>Vrsta datuma<select name="datum_vrsta" defaultValue={filters.dateType}><option value="racun">Datum računa</option><option value="prijem">Datum prijema</option></select></label>
          <label>Datum od<input type="date" name="od" defaultValue={filters.from}/></label>
          <label>Datum do<input type="date" name="do" defaultValue={filters.to}/></label>
          <label>Ukupno od (EUR)<input name="iznos_od" inputMode="decimal" placeholder="0,00" defaultValue={filters.min} maxLength={15}/></label>
          <label>Ukupno do (EUR)<input name="iznos_do" inputMode="decimal" placeholder="0,00" defaultValue={filters.max} maxLength={15}/></label>
          <div className="table-actions"><button type="submit">Filtriraj</button><Link className="secondary-button" href={`/agencija/racuni/pregled-kuf/${kufBook.id}`}>Poništi filtere</Link></div>
        </form>
        {invalid?<p role="alert" className="admin-message">Provjerite datume i iznose filtera. Početak raspona ne može biti veći od kraja.</p>:null}
        {filtered?<p role="status">Prikazano {entries.length} od {kufBook.entries.length} računa. Zbirni iznosi odnose se na filtrirane račune.</p>:null}
      </section>

      <section className="metric-grid">
        <div className="metric">
          <span>Računa</span>
          <strong>{entries.length}</strong>
          <small>{bookStatusLabel}</small>
        </div>
        <div className="metric">
          <span>Osnovica</span>
          <strong>{decimalText(totals.base/100)}</strong>
          <small>zbir poreskih osnovica</small>
        </div>
        <div className="metric">
          <span>PDV / Ukupno</span>
          <strong>{decimalText(totals.vat/100)} / {decimalText(totals.gross/100)}</strong>
          <small>ulazni PDV i bruto iznos</small>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Računi u KUF knjizi</h3>
          <span>{entries.length} redova{filtered?` / ${kufBook.entries.length} ukupno`:""}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>KUF broj</th>
                <th>Dobavljač</th>
                <th>Račun</th>
                <th>Konto troška</th>
                <th>Datumi</th>
                <th>Osnovica</th>
                <th>PDV</th>
                <th>Ukupno</th>
                <th>Razrada</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={10}>{filtered?"Nema računa koji odgovaraju izabranim filterima.":"Nema unesenih računa u ovoj KUF knjizi."}</td>
                </tr>
              ) : (
                entries.map((entry) => {
                  const entryStatus = entryPostingLabel(entry.posting_status);

                  return (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.internal_kuf_number}</strong>
                      {entry.note ? <small>{entry.note}</small> : null}
                    </td>
                    <td>
                      {entry.dobavljac.naziv}
                      <small>{entry.dobavljac.pib ?? ""}</small>
                    </td>
                    <td>{normalizeFiscalInvoiceNumber(entry.supplier_invoice_number)}</td>
                    <td>
                      {entry.expense_account
                        ? `${entry.expense_account.sifra} - ${entry.expense_account.naziv}`
                        : "-"}
                    </td>
                    <td>
                      {displayDate(entry.invoice_date)}
                      <small>prijem {displayDate(entry.receipt_date)}</small>
                    </td>
                    <td>{decimalText(entry.total_base)}</td>
                    <td>
                      {decimalText(entry.total_input_vat)}
                      {Number(entry.non_deductible_vat.toString()) > 0 ? (
                        <small>neodbitni {decimalText(entry.non_deductible_vat)}</small>
                      ) : null}
                    </td>
                    <td>{decimalText(entry.total_gross)}</td>
                    <td>
                      {entry.tax_lines.map((line) => (
                        <small key={line.id}>
                          {decimalText(line.vat_rate_percent)}%: {decimalText(line.tax_base)} +{" "}
                          {decimalText(line.input_vat_amount)}
                        </small>
                      ))}
                    </td>
                    <td>
                      <span className={statusClass(entryStatus)}>{entryStatus}</span>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
