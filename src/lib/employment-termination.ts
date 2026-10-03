export const terminationTypes = {
  SPORAZUMNI: "Sporazumni raskid",
  ISTEK: "Istek ugovora",
  RADNIK: "Jednostrani raskid od strane radnika"
} as const;
export type TerminationType = keyof typeof terminationTypes;
export function isTerminationType(value: string): value is TerminationType {
  return Object.hasOwn(terminationTypes, value);
}
export type TerminationSnapshot = {
  version: string; type: TerminationType; broj: string; datum: string; prestanak: string;
  firma: string; pib: string; adresaFirme: string; grad: string; direktor: string;
  radnik: string; jmbg: string; adresa: string; pozicija: string; pocetak: string;
  kontakt: string; kraciRok: boolean;
};
const escape = (v: string) => v.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
// Adapted from moj-sajt/public/shared/{sporazumni-raskid,istek-ugovora,jednostrani-raskid-od-strane-radnika}.html.
// Legal references checked against https://amrrs.gov.me/wp-content/uploads/2026/03/Zakon-o-radu-1.pdf
export function renderTermination(s: TerminationSnapshot) {
  const v = Object.fromEntries(Object.entries(s).map(([k,val]) => [k, escape(String(val))])) as Record<keyof TerminationSnapshot,string>;
  const header = `<p><strong>${v.firma}</strong><br>${v.adresaFirme}, ${v.grad}<br>PIB: ${v.pib}</p><p>Broj: ${v.broj}<br>Datum: ${v.datum}</p>`;
  const parties = `<p><strong>POSLODAVAC:</strong> ${v.firma}, PIB ${v.pib}, ${v.adresaFirme}, koga zastupa ${v.direktor}.</p><p><strong>ZAPOSLENI:</strong> ${v.radnik}, JMBG ${v.jmbg}, adresa ${v.adresa}, radno mjesto ${v.pozicija}. Datum zasnivanja radnog odnosa: ${v.pocetak}.</p>`;
  const signatures = `<div class="signature-section"><div class="signature"><p>____________________</p><p>${s.type === "RADNIK" ? "PRIJEM POSLODAVCA" : "POSLODAVAC"}<br>${v.direktor}</p></div><div class="signature"><p>____________________</p><p>${s.type === "ISTEK" ? "PRIMIO ZAPOSLENI" : "ZAPOSLENI"}<br>${v.radnik}</p></div></div>`;
  if(s.type === "SPORAZUMNI") return header + `<h1>SPORAZUM O RASKIDU RADNOG ODNOSA</h1>` + parties +
    `<p>Poslodavac i zaposleni, na osnovu člana 165 Zakona o radu, saglasno uređuju prestanak radnog odnosa.</p><p class="article-title">Član 1.</p><p>Radni odnos zaposlenog prestaje sporazumno dana <strong>${v.prestanak}</strong>.</p><p class="article-title">Član 2.</p><p>Razlog prestanka je zajednički dogovor poslodavca i zaposlenog.</p><p class="article-title">Član 3.</p><p>Zaposleni predaje poslodavcu povjerenu dokumentaciju, opremu, ključeve i ostala sredstva rada.</p><p class="article-title">Član 4.</p><p>Poslodavac će obračunati i izmiriti pripadajuća potraživanja zaposlenog u skladu sa zakonom.</p><p class="article-title">Član 5.</p><p>Sporazum proizvodi pravno dejstvo od ovjere kod notara, suda ili organa lokalne uprave.</p><p class="article-title">Član 6.</p><p>Sačinjen je u dva istovjetna primjerka, po jedan za svaku stranu.</p><p>U ${v.grad}, ${v.datum}.</p>` + signatures;
  if(s.type === "ISTEK") return header + `<h1>RJEŠENJE<br>o prestanku radnog odnosa zbog isteka ugovora</h1>` + parties +
    `<p>Na osnovu člana 164 stav 1 tačka 7 Zakona o radu, zaposlenom prestaje radni odnos dana <strong>${v.prestanak}</strong>, istekom ugovorenog vremena.</p><h2>Obrazloženje</h2><p>Radni odnos zasnovan je na određeno vrijeme. Ugovoreni datum isteka je ${v.prestanak}, što predstavlja osnov ovog rješenja.</p><p>Poslodavac će obračunati i izmiriti pripadajuća potraživanja zaposlenog u skladu sa zakonom.</p><h2>Pouka o pravnom lijeku</h2><p>Zaposleni može tražiti zaštitu prava u skladu sa članom 140 Zakona o radu, podnošenjem predloga za mirno rješavanje spora Agenciji za mirno rješavanje radnih sporova ili Centru za alternativno rješavanje sporova, prije pokretanja postupka pred nadležnim sudom.</p>` + signatures + `<p>Primljeno dana: ____________________</p>`;
  return header + `<h1>IZJAVA O JEDNOSTRANOM RASKIDU UGOVORA O RADU</h1>` + parties +
    `<p>Ja, ${v.radnik}, na osnovu člana 166 Zakona o radu, otkazujem ugovor o radu kod poslodavca ${v.firma}. Kao dan prestanka radnog odnosa navodim <strong>${v.prestanak}</strong>.</p><p>${s.kraciRok ? "Dan prestanka dogovoren je sa poslodavcem uz kraći otkazni rok." : "Ova izjava se dostavlja poslodavcu najmanje 30 dana prije navedenog dana prestanka radnog odnosa."}</p><p>Molim da mi se izda potvrda o zaposlenju i obračunaju pripadajuća potraživanja.</p><p>U ${v.grad}, ${v.datum}.</p><p>Kontakt zaposlenog: ${v.kontakt || "____________________"}</p>` + signatures + `<p>Datum prijema kod poslodavca: ____________________</p><p>Izjava se prije dostavljanja ovjerava kod notara, suda ili organa lokalne uprave. Poslodavac donosi rješenje o prestanku radnog odnosa.</p>`;
}
