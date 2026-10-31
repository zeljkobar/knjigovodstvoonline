import { AccountReplacementError, replacementOptions } from "@/lib/journal-account-replacement";
import { ReplacementForm } from "./ReplacementForm";

export default async function AccountReplacementPage() {
  let options;
  try { options = await replacementOptions(); }
  catch (error) {
    if (error instanceof AccountReplacementError) return <div className="admin-stack"><h2>Zamjena konta</h2><p role="alert">{error.message}</p></div>;
    throw error;
  }
  return <div className="admin-stack">
    <header className="admin-header"><div><h2>Zamjena konta</h2><p>{options.company} · {options.year}</p></div></header>
    <p>Zamjena konta u postojećim proknjiženim nalozima izabrane vrste. Prazni datumi obuhvataju cijelu poslovnu godinu.</p>
    <ReplacementForm key={`${options.companyId}:${options.yearId}`} {...options} />
  </div>;
}
