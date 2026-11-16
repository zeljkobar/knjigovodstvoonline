import Link from "next/link";
import { driveChildren, driveItemPath, graph, oneDriveAccess, type DriveItem } from "@/lib/dokumentacija-onedrive";
import { saveStatementArchiveFolder } from "./archive-actions";
import { effectiveBankSetting } from "@/lib/posting-template";
import { PostingTemplateNotice } from "@/components/PostingTemplateNotice";
import { AccountSearchSelect } from "@/components/AccountSearchSelect";
import { saveBankStatementAccountSettings } from "../actions";
import { getIzvodiContext, MissingContext } from "../_shared";
import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import MailSettingsForm from "./MailSettingsForm";
import { agencyMailAccounts } from "@/lib/mail-accounts";
import { canAccessAgencyImap } from "@/lib/imap-access-policy";
import { parseMailRules } from "@/lib/company-mail-rules";
import styles from "./settings.module.css";

type PodesavanjaIzvodaPageProps = {
  searchParams?: Promise<{
    poruka?: string;
    banka?: string;
    folder?: string;
  }>;
};

const messages: Record<string, string> = {
  arhiva_sacuvana: "OneDrive podešavanje izvoda je sačuvano.",
  arhiva_greska: "Folder nije sačuvan. Provjerite OneDrive vezu i da li je folder već dodijeljen drugom računu ili godini.",
  mail_sacuvana: "Mail podešavanja su sačuvana. Otvorite Mailovi za pregled filtriranih poruka.",
  godina_zakljucena: "Poslovna godina je zaključena.",
  podesavanja_greska: "Podešavanja nije moguće sačuvati.",
  podesavanja_sacuvana: "Podešavanja izvoda su sačuvana."
};

export default async function PodesavanjaIzvodaPage({
  searchParams
}: PodesavanjaIzvodaPageProps) {
  await requireRole("admin_agencije");
  const { user, firma, godina } = await getIzvodiContext();
  const params = await searchParams;

  if (!user.agencija_id || !firma || !godina) {
    return <MissingContext title="Podešavanja izvoda" />;
  }

  const mailEnabled = canAccessAgencyImap(user, user.agencija_id ?? undefined);
  const mailAccounts = mailEnabled ? await agencyMailAccounts(user.agencija_id!, true) : [];
  const mailSettings = mailEnabled ? await prisma.firmaMailPodesavanje.findFirst({
    where: { firma_id: firma.id, agencija_id: user.agencija_id, is_deleted: false }
  }) : null;
  const [bankAccounts, settings, baseAccounts, companyOverrides, journalTypes] =
    await Promise.all([
      prisma.firmaBankovniRacun.findMany({
        where: {
          agencija_id: user.agencija_id,
          firma_id: firma.id,
          is_deleted: false,
          aktivan: true
        },
        orderBy: [
          {
            glavni: "desc"
          },
          {
            naziv_banke: "asc"
          }
        ],
        select: {
          id: true,
          naziv_banke: true,
          broj_racuna: true,
          glavni: true
        }
      }),
      prisma.bankStatementAccountSetting.findMany({
        where: {
          agencija_id: user.agencija_id,
          firma_id: firma.id
        },
        include: {
          bank_account_konto: {
            select: {
              sifra: true
            }
          },
          journal_type: {
            select: {
              id: true
            }
          }
        }
      }),
      prisma.konto.findMany({
        where: {
          aktivan: true,
          tip_konta: "analiticko"
        },
        orderBy: {
          sifra: "asc"
        },
        select: {
          id: true,
          sifra: true,
          naziv: true,
          klasa: true,
          tip_konta: true,
          analitika_obavezna: true,
          sinteticki_konto: true,
          normalni_saldo: true,
          koristi_radnu_jedinicu: true,
          aktivan: true
        }
      }),
      prisma.firmaKonto.findMany({
        where: {
          firma_id: firma.id
        },
        orderBy: {
          sifra: "asc"
        },
        select: {
          id: true,
          konto_id: true,
          sifra: true,
          naziv: true,
          tip_konta: true,
          analitika_obavezna: true,
          sinteticki_konto: true,
          normalni_saldo: true,
          koristi_radnu_jedinicu: true,
          override_type: true,
          napomena: true,
          aktivan: true
        }
      }),
      prisma.vrstaNaloga.findMany({
        where: {
          aktivan: true,
          OR: [
            {
              agencija_id: user.agencija_id
            },
            {
              agencija_id: null
            },
            {
              firma_id: firma.id
            }
          ]
        },
        orderBy: {
          naziv: "asc"
        },
        select: {
          id: true,
          sifra: true,
          naziv: true,
          prefiks: true
        }
      })
    ]);
  for (const bank of bankAccounts) {
    const effective = await effectiveBankSetting(prisma, firma.id, bank.id);
    if (effective) {
      const existingIndex = settings.findIndex(row => row.company_bank_account_id === bank.id);
      if (existingIndex >= 0) settings[existingIndex] = effective;
      else settings.push(effective);
    }
  }

  const accountOptions = mergeCompanyAccountPlan(baseAccounts, companyOverrides).filter(
    (account) => account.aktivan && account.tip_konta === "analiticko"
  );
  const settingByBankAccount = new Map(
    settings.map((setting) => [setting.company_bank_account_id, setting])
  );

  const archiveScope = { agencija_id: user.agencija_id, firma_id: firma.id, poslovna_godina_id: godina.id };
  const [connection, folders, archiveIssues] = await Promise.all([
    prisma.dokumentaOneDrive.findUnique({ where: { agencija_id: user.agencija_id }, select: { drive_id: true } }),
    prisma.bankStatementArchiveFolder.findMany({ where: archiveScope }),
    prisma.mailIzvodObrada.findMany({
      where: { ...archiveScope, arhiva_status: { in: ["REVIEW", "RETRY"] },
        izvod: { ...archiveScope, is_deleted: false, status: "POSTED" } },
      select: { id: true, naziv_priloga: true, arhiva_greska: true, arhiva_status: true,
        izvod: { select: { statement_number: true } } },
      orderBy: { arhiva_pokusaj_at: "desc" }, take: 30
    })
  ]);
  const selectedBank = bankAccounts.find(bank => bank.id === params?.banka);
  let currentFolder: DriveItem | undefined;
  let children: DriveItem[] = [];
  let folderError = false;
  if (connection && selectedBank && params?.folder) {
    try {
      const { token, driveId } = await oneDriveAccess(user.agencija_id);
      currentFolder = await graph<DriveItem>(token, params.folder === "root"
        ? `drives/${encodeURIComponent(driveId)}/root` : driveItemPath(driveId, params.folder));
      if (currentFolder.folder) children = (await driveChildren(token, driveId, currentFolder.id)).filter(child => child.folder);
    } catch {
      folderError = true;
    }
  }
  const browseLink = (bank: string, folder: string) => `?banka=${encodeURIComponent(bank)}&folder=${encodeURIComponent(folder)}#onedrive-izvodi`;

  return (
    <div className={`admin-stack ${styles.page}`}>
      <PostingTemplateNotice companyId={firma.id}/>
      <header className="admin-header">
        <div>
          <h2>Podešavanja izvoda</h2>
          <p>Uparivanje bankovnog računa firme sa kontom banke i vrstom naloga.</p>
        </div>
      </header>

      {params?.poruka ? <p className="admin-message">{messages[params.poruka] ?? params.poruka}</p> : null}

      <section className={`admin-panel ${styles.panel}`}>
        {bankAccounts.length === 0 ? (
          <p className="empty-state">Firma nema aktivnih bankovnih računa.</p>
        ) : (
          <form action={saveBankStatementAccountSettings}>
            <div>
              <table className={styles.table}>
                <colgroup><col className={styles.bankColumn} /><col className={styles.accountColumn} /><col className={styles.typeColumn} /></colgroup>
                <thead>
                  <tr>
                    <th>Bankovni račun</th>
                    <th>Konto banke</th>
                    <th>Vrsta naloga</th>
                  </tr>
                </thead>
                <tbody>
                  {bankAccounts.map((bankAccount) => {
                    const setting = settingByBankAccount.get(bankAccount.id);

                    return (
                      <tr key={bankAccount.id}>
                        <td data-label="Bankovni račun">
                          <strong>{bankAccount.naziv_banke}</strong>
                          <small>
                            {bankAccount.broj_racuna}
                            {bankAccount.glavni ? " · glavni" : ""}
                          </small>
                          <input name="company_bank_account_id" type="hidden" value={bankAccount.id} />
                        </td>
                        <td data-label="Konto banke">
                          <AccountSearchSelect
                            aria-label={`Konto banke za ${bankAccount.broj_racuna}`}
                            defaultValue={setting?.bank_account_konto?.sifra ?? ""}
                            name="bank_account_konto_code"
                          >
                            <option value="">Izaberite konto</option>
                            {accountOptions.map((account) => (
                              <option key={`${account.sifra}-${account.id}`} value={account.sifra}>
                                {account.sifra} - {account.naziv}
                              </option>
                            ))}
                          </AccountSearchSelect>
                        </td>
                        <td data-label="Vrsta naloga">
                          <select aria-label={`Vrsta naloga za ${bankAccount.broj_racuna}`} defaultValue={setting?.journal_type?.id ?? ""} name="journal_type_id">
                            <option value="">Podrazumijevano: Izvodi</option>
                            {journalTypes.map((journalType) => (
                              <option key={journalType.id} value={journalType.id}>
                                {journalType.naziv} {journalType.prefiks ? `(${journalType.prefiks})` : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button className="primary-button" type="submit">
              Sačuvaj podešavanja
            </button>
          </form>
        )}
      </section>
      <section id="onedrive-izvodi" className={`admin-panel ${styles.panel}`}>
        <h3>OneDrive arhiva izvoda · {godina.godina}</h3>
        <p>Originalni mail prilozi čuvaju se nakon knjiženja. Odaberite folder za svaki bankovni račun u ovoj godini.</p>
        {!connection && <Link href="/agencija/dokumentacija">Poveži OneDrive u Dokumentaciji</Link>}
        {connection && bankAccounts.length > 0 && <div className="table-wrap"><table className={styles.table}>
          <thead><tr><th>Bankovni račun</th><th>OneDrive folder</th><th>Podešavanje</th></tr></thead>
          <tbody>{bankAccounts.map(bank => {
            const folder = folders.find(item => item.bankovni_racun_id === bank.id);
            return <tr key={bank.id}>
              <td data-label="Bankovni račun"><strong>{bank.naziv_banke}</strong><small>{bank.broj_racuna}</small></td>
              <td data-label="OneDrive folder">{folder?.naziv ?? "Nije podešen"}</td>
              <td data-label="Podešavanje"><Link className="table-button" href={browseLink(bank.id, "root")} prefetch={false}>Odaberi folder</Link>
                {folder && <form action={saveStatementArchiveFolder}>
                  <input type="hidden" name="bankId" value={bank.id} />
                  <input type="hidden" name="firmaId" value={firma.id} />
                  <input type="hidden" name="yearId" value={godina.id} />
                  <button className="table-button" name="unlink" value="true" type="submit">Ukloni vezu</button>
                </form>}
              </td>
            </tr>;
          })}</tbody>
        </table></div>}
        {folderError && <p role="alert">OneDrive folder trenutno nije dostupan.</p>}
        {selectedBank && currentFolder?.folder && !folderError && <div className="admin-stack">
          <strong>{selectedBank.naziv_banke} · {selectedBank.broj_racuna} · {currentFolder.name}</strong>
          {currentFolder.parentReference?.id && <>
            <Link href={browseLink(selectedBank.id, currentFolder.parentReference.id)} prefetch={false}>Nazad</Link>
            <form action={saveStatementArchiveFolder}>
              <input type="hidden" name="bankId" value={selectedBank.id} />
              <input type="hidden" name="firmaId" value={firma.id} />
              <input type="hidden" name="yearId" value={godina.id} />
              <input type="hidden" name="folderId" value={currentFolder.id} />
              <button className="primary-button" type="submit">Poveži ovaj folder</button>
            </form>
          </>}
          <ul>{children.map(child => <li key={child.id}>
            <Link href={browseLink(selectedBank.id, child.id)} prefetch={false}>{child.name}</Link>
          </li>)}</ul>
        </div>}
        {archiveIssues.length > 0 && <>
          <h4>Izvodi koji čekaju arhiviranje</h4>
          <ul>{archiveIssues.map(issue => <li key={issue.id}>
            Izvod {issue.izvod?.statement_number} ({issue.naziv_priloga}) · {issue.arhiva_status === "RETRY" ? "Čeka ponovni pokušaj" : "Potrebna provjera"} · {issue.arhiva_greska}
          </li>)}</ul>
          {archiveIssues.some(issue => issue.arhiva_status === "REVIEW") && <p>Nakon što riješite problem, ponovo povežite folder da pokrenete novi pokušaj.</p>}
        </>}
      </section>
      {mailEnabled && <MailSettingsForm key={`${firma.id}-${mailSettings?.updated_at.toISOString() || "new"}`} firmaId={firma.id} godinaId={godina.id} accounts={mailAccounts.map(a => ({ id: a.id, naziv: a.naziv, username: a.korisnicko_ime }))}
        initial={{ mailAccountId: mailSettings?.mail_nalog_id ?? "", folder: mailSettings?.folder || "", subfolders: mailSettings?.ukljuci_podfoldere || false,
          inbox: mailSettings?.ukljuci_inbox ?? true, active: mailSettings?.aktivno ?? true,
          rules: parseMailRules(mailSettings?.pravila || []), version: mailSettings?.updated_at.toISOString() || "" }} />}
    </div>
  );
}
