import Link from "next/link";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { getDirectPortalNavigation } from "@/lib/portal-navigation";
import { SupportDetails } from "@/components/SupportDetails";
import styles from "./page.module.css";

const guides = [
  { section: "fakture", title: "Kako da napravim fakturu?", steps: ["Otvorite Fakture i izaberite novu fakturu, ako imate pravo kreiranja.", "Izaberite kupca, unesite datume, način plaćanja i stavke. Provjerite količine, cijene i poreski tretman.", "Sačuvajte nacrt. Prije potvrde provjerite pregled i iznose, pa izaberite fiskalizaciju u prikazanom okruženju.", "Kada račun bude fiskalizovan, otvorite fiskalni detalj i A4 štampu."] },
  { section: "racuni", title: "Gdje su izdati računi?", steps: ["Otvorite Fiskalni računi i suzite pregled dostupnim filterima.", "U detalju provjerite status, stavke, iznose, IKOF i JIKR. Ako postupak nije završen, pročitajte prikazanu poruku.", "Za štampu otvorite A4 prikaz. U prozoru štampe pregledača možete sačuvati dokument kao PDF."] },
  { section: "izvjestaji", title: "Kako da preuzmem izvještaj?", steps: ["Otvorite Izvještaji i izaberite promet, žurnal, kupce, artikle ili drugi potreban pregled.", "Provjerite poslovnu godinu, period, okruženje i kanal prodaje. Testni i produkcioni računi prikazuju se odvojeno.", "Prikažite podatke. Ako imate pravo izvoza, preuzmite Excel ili otvorite A4 štampu i sačuvajte je kao PDF. CSV je dostupan u podržanim pregledima."] },
  { section: "artikli", title: "Kako da pripremim artikle i usluge?", steps: ["U Artiklima i uslugama provjerite naziv, jedinicu mjere, poresku stopu i prodajnu cijenu.", "Za izmjene i dodavanje potrebna su odgovarajuća prava. Kupce održavate u odjeljku Kupci.", "Promjena šifarnika ne prepravlja podatke već izdatog fiskalnog računa."] },
  { section: "pos", title: "Kako da koristim POS kasu?", steps: ["POS / Kasa se prikazuje kada je kasa uključena i imate pravo pristupa.", "Provjerite kasu i smjenu, dodajte artikle i izaberite način plaćanja.", "Prije naplate provjerite iznos. Potvrda prodaje pokreće izdavanje i fiskalizaciju računa."] }
];

const questions = [
  ["Zašto ne mogu da pravim ili fiskalizujem račune?", "Pristup portalu i spremnost firme za izdavanje računa su odvojeni. Admin platforme odobrava fiskalna prava i podešava fiskalizaciju. Izdavanje može biti blokirano i zbog zaključane poslovne godine. Agencijska dozvola za robne preglede sama ne daje pravo izdavanja računa."],
  ["Šta znači da je račun u obradi ili da je prijavljena greška?", "Otvorite postojeći račun i provjerite posljednji status i poruku. Ako nema konačne potvrde, nemojte praviti novu fakturu za istu prodaju. Podršci dostavite broj računa i ID za podršku (Correlation ID), ako je prikazan."],
  ["Mogu li da izmijenim fiskalizovan račun?", "Fiskalizovan račun se ne prepravlja kao nacrt. Ispravka se radi odgovarajućim korektivnim postupkom uz potrebna prava. Ako nijeste sigurni koji postupak odgovara grešci, prije potvrde se obratite podršci ili knjigovođi."],
  ["Zašto računa nema u izvještaju?", "Provjerite godinu, datume, Test/Production okruženje i kanal prodaje. Fiskalni promet uključuje samo potvrđene račune obuhvaćene tim filterima; nacrt nije fiskalizovan promet. Avansi imaju poseban pregled. Računi izdati na SEP-u ili u drugom programu ne pojavljuju se automatski u ovom pregledu."],
  ["Zašto se promet razlikuje od uplata na bankovnom računu?", "Fiskalni promet prati izdate račune i korekcije. Pregled po načinu plaćanja pokazuje način plaćanja evidentiran na računu; nije potvrda da je kupac izvršio bankovnu uplatu."],
  ["Ko upravlja mojim pristupom?", "Admin platforme odobrava i ukida fiskalni pristup i prava izdavanja. Ako firma sarađuje sa agencijom, njen administrator istom nalogu zasebno dodjeljuje knjigovodstvene preglede i slanje dokumentacije. Koristite postojeći nalog za oba dijela."],
  ["Zašto ne vidim isto što vidi drugi korisnik?", "Meni i dostupne radnje zavise od vaših prava i uključenih funkcija firme. Za dodatna fiskalna prava obratite se adminu platforme. Podešavanja sertifikata i aktivacije produkcije nijesu dio klijentskih podešavanja."]
];

export default async function PortalHelpPage() {
  const context = await requireDirectPortalContext(undefined, "/portal/pomoc");
  const navigation = getDirectPortalNavigation(context.permissionKeys, Boolean(context.firma.posPodesavanje?.aktivan));
  const visibleGuides = guides.filter(guide => navigation.some(item => item.section === guide.section));
  const statusText: Record<string, string> = {
    READY: "Firma je podešena za produkcioni rad. Dostupne radnje zavise i od vaših prava i statusa poslovne godine.",
    TEST: "Radite u testnom okruženju. Za izdavanje stvarnih računa admin platforme treba da završi aktivaciju produkcije.",
    SUSPENDED: "Fiskalni rad je privremeno onemogućen. Obratite se adminu platforme za provjeru pristupa i statusa firme.",
    NEEDS_SUPPORT: "Možete pristupiti portalu, ali fiskalna konfiguracija firme nije spremna za izdavanje računa. Admin platforme treba da provjeri i završi podešavanje firme.",
    SERVICE_UNAVAILABLE: "Fiskalni servis trenutno nije dostupan. Provjerite status postojećeg računa prije ponavljanja postupka."
  };
  const supportText = [
    `Firma: ${context.firma.naziv}`, `PIB: ${context.firma.pib || "Nije unesen"}`,
    `Korisnik: ${context.user.korisnicko_ime}`, `Poslovna godina: ${context.year.godina}`,
    `Status: ${context.readiness.label}`,
    ...(context.firma.fiscalCompanyLink?.last_correlation_id ? [`ID posljednje provjere podešavanja: ${context.firma.fiscalCompanyLink.last_correlation_id}`] : []),
    "Broj računa / ID za podršku sa greške: ", "Vrijeme i opis problema: "
  ].join("\n");
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Fiskalni portal</p><h2>Pomoć i uputstva</h2><p className="muted-text">Od prve fakture do izvještaja — pronađite korake i odgovore na najčešća pitanja.</p></div></header>
    <nav className={styles.topics} aria-label="Teme pomoći"><a href="#uputstva">Uputstva za rad</a><a href="#pitanja">Česta pitanja</a><a href="#podrska">Podrška</a></nav>
    <section className={`admin-panel ${styles.status}`} aria-labelledby="help-status"><p className="eyebrow">Status vaše firme</p><h3 id="help-status">{context.readiness.label}</h3><p>{statusText[context.readiness.code]}</p>{context.year.zakljucena ? <p><strong>Poslovna godina {context.year.godina} je zaključana.</strong> Izmjene dokumenata su blokirane.</p> : null}</section>
    <section id="uputstva" className={styles.anchor}><h3>Uputstva za rad</h3><p className="muted-text">Prikazane su teme za odjeljke kojima vaš nalog ima pristup.</p><div className={styles.grid}>{visibleGuides.map(guide => <article className="admin-panel" key={guide.section}><h4>{guide.title}</h4><ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol><Link className="secondary-button" href={navigation.find(item => item.section === guide.section)!.href}>Otvori {navigation.find(item => item.section === guide.section)!.label}</Link></article>)}</div></section>
    <section id="pitanja" className={`admin-panel ${styles.anchor}`}><h3>Česta pitanja</h3><div className={styles.faq}>{questions.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></section>
    <section id="podrska" className={`admin-panel ${styles.anchor}`}><h3>Potrebna vam je podrška?</h3><p>Kopirajte podatke ispod i pošaljite ih dogovorenim kanalom podrške. Dodajte broj računa, tačno vrijeme, poruku greške i kratak opis koraka. Kopiranje ne šalje zahtjev.</p><SupportDetails text={supportText}/><p className="muted-text">ID posljednje provjere podešavanja nije nužno ID greške na računu. Za problem sa računom dodajte ID prikazan uz taj račun. Lozinku naloga, sertifikat i lozinku sertifikata nemojte uključivati u poruku.</p></section>
  </div>;
}
