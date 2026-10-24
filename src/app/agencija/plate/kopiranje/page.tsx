import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import { payrollCopyPreview, PayrollCopyError } from "@/lib/payroll-copy";
import { payrollCopyMonth } from "@/lib/payroll-copy-period";
import { PayrollCopyForm } from "./PayrollCopyForm";

export default async function PayrollCopyPage({ searchParams }: { searchParams: Promise<{ izvor?: string; cilj?: string }> }) {
  const [user, params] = await Promise.all([requireAnyRole(["admin_agencije", "korisnik_agencije"]), searchParams]);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const today = `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`;
  // Do not read or mutate the selected company/year: both periods belong to this screen.
  const current = payrollCopyMonth(today) ?? payrollCopyMonth(new Date().toISOString().slice(0, 7))!;
  const prior = new Date(Date.UTC(current.year, current.month - 2, 1)).toISOString().slice(0, 7);
  const source = params.izvor ?? prior, target = params.cilj ?? current.key;
  let rows: Awaited<ReturnType<typeof payrollCopyPreview>> = [], error: string | null = null;
  if (!user.agencija_id) error = "Nemate pristup agenciji.";
  else try { rows = await payrollCopyPreview({ userId: user.id, agencyId: user.agencija_id }, source, target); }
  catch (e) { if (e instanceof PayrollCopyError) error = e.message; else throw e; }
  return <div className="admin-stack">
    <header className="admin-header"><div><h2>Kopiranje obračuna plata</h2><p>Sve dostupne firme agencije, nezavisno od firme i godine izabrane u gornjoj traci.</p></div><Link className="secondary-button" href="/agencija/plate/obracun">Obračuni plata</Link></header>
    <form className="admin-form admin-panel" method="get"><label>Izvorni mjesec<input name="izvor" type="month" defaultValue={source} required min="2000-01" max="2199-12"/></label><label>Ciljni mjesec<input name="cilj" type="month" defaultValue={target} required min="2000-01" max="2199-12"/></label><div className="form-actions"><button type="submit">Prikaži firme</button></div></form>
    {error ? <p className="admin-message" role="alert">{error}</p> : <PayrollCopyForm key={`${source}:${target}`} rows={rows} source={source} target={target}/>}
  </div>;
}
