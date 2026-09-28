// Pravilnik, čl. 4 i 11; Sl. list 28/2002, 130/2021, 118/2024 i 124/2024.
export const taxGroupsSource = "https://wapi.gov.me/download/806b0f82-416d-4f85-bc04-7ea8780c616a?version=1.0";
export const fixedAssetTaxGroups = [
  { id: "I", rate: "2,5", items: "Asfaltne površine;Avionske piste;Brane za akumulaciju voda;Cijevi za gasovod;Dokovi za vezivanje brodova;Parkovi;Elektrane;Električni dalekovodi;Eskalatori – pokretne stepenice;Hangari;Lukobrani;Marine;Mostovi;Nadvožnjaci i vijadukti;Naftovodi;Odvodni i dovodni kanali;Oprema za informatičku infrastrukturu (Yupak, Internet i sl.);Oprema za proizvodnju i distribuciju električne energije, gasa, toplote i vode;Parking površine;Prirodna nalazišta vode i banje;Putevi i auto-putevi;Ribnjaci;Skladišta i rezervoari;Solane;Sportski objekti (stadioni, bazeni, sportske hale);Silosi na poljoprivrednim dobrima;Tuneli;Vodovodi i cjevovodi;Željeznička infrastruktura;Zgrade;Sve ostale nepokretnosti koje nijesu naprijed pomenute" },
  { id: "II", rate: "10", items: "Avioni;Automobili;Brodovi i ostali plovni objekti;Elektrane manje od 15 megavata;Klima uređaji;Liftovi;Bojleri;Namještaj u brodovima;Medicinska oprema;Ograde;Oprema za kancelariju;Oprema za proizvodnju i distribuciju solarne energije;Tankovi za čuvanje nafte;Tankovi za čuvanje vode;Vagoni;Vinogradi, voćnjaci i ostali dugogodišnji zasadi" },
  { id: "III", rate: "15", items: "Alati i inventar;Autobusi;Oprema za termo-elektrane;Oprema za proizvodnju mlijeka i mliječnih proizvoda;Elektronski naplatni uređaji;Automati za igre na sreću;Hladnjače;Kamioni i prikolice (teretna i vučna vozila, auto cistjerne, auto mješalice i sl.);Laboratorijska oprema;Mašine za čišćenje žitarica;Oprema za fotokopiranje;Namještaj koji nije pomenut na drugim mjestima;Oprema za istraživanje;Postrojenja za pravljenje betona;Pokretna oprema za proizvodnju električne energije (agregati i sl.);Radari;Televizijske antene;Sva ostala oprema koja nije posebno naznačena u drugim grupama" },
  { id: "IV", rate: "20", items: "Namještaj u avionima;Oprema za kontrolu zagađenja vazduha i vode – nelicencirana;Oprema za emitovanje radio i tv programa;Oprema za naftne bušotine;Oprema za obradu rude;Rezervni djelovi za avione;Telegrafska i telefonska oprema (žice i razni kablovi)" },
  { id: "V", rate: "30", items: "Automobili za iznajmljivanje ili lizing i taksi vozila;Bilbordi;Branici za puteve i pruge;Električne reklame;Elektronska i IT oprema za procesuiranje podataka;Filmovi;Televizijske reklame i spotovi;Građevinska pokretna oprema;Kalupi za livenje;Knjige u biblioteci koje se iznajmljuju;Industrijski noževi;Oprema za sječu drveća;Platforme u moru;Platno (tepisi, zastori, zavjese, itisoni i sl.);Pokretna oprema koja koristi električnu energiju (bušilica, brusilica i sl.);Pokretni kampovi;Skeneri za bar kod;Traktori;Uniforme;Osnovno stado" }
] as const;

export function taxClassificationOptions(assetType: string) {
  if (assetType === "LAND") return [{ value: "EXEMPT", label: "Zemljište – bez poreske amortizacije" }];
  if (assetType === "INTANGIBLE" || assetType === "RIGHT_OF_USE") return [{ value: "ACCOUNTING_AMOUNT", label: assetType === "INTANGIBLE" ? "Nematerijalna imovina – računovodstveni iznos" : "Pravo korišćenja / lizing – računovodstveni iznos" }];
  if (!["MATERIAL", "OTHER"].includes(assetType)) return [];
  return [
    ...fixedAssetTaxGroups.map(group => ({ value: group.id, label: `Grupa ${group.id} – ${group.rate}%` })),
    { value: "EXEMPT", label: "Izuzeto od poreske amortizacije (npr. umjetničko djelo)" },
    { value: "UNSUPPORTED", label: "Poseban tretman – potrebna dodatna klasifikacija" }
  ];
}

export function parseTaxClassification(value: unknown, assetType: string) {
  if (typeof value !== "string" || !taxClassificationOptions(assetType).some(option => option.value === value)) return null;
  const group = fixedAssetTaxGroups.find(group => group.id === value);
  return group ? { poreski_tretman: group.id === "I" ? "GROUP_I" : "GROUP_POOL", poreska_grupa: group.id }
    : { poreski_tretman: value, poreska_grupa: null };
}

export function taxClassificationLabel(treatment: string, groupId: string | null) {
  const group = fixedAssetTaxGroups.find(group => group.id === groupId);
  if (group && treatment === (group.id === "I" ? "GROUP_I" : "GROUP_POOL")) return `Grupa ${group.id} – ${group.rate}%`;
  if (treatment === "EXEMPT") return "Bez poreske amortizacije";
  if (treatment === "ACCOUNTING_AMOUNT") return "U iznosu računovodstvene amortizacije";
  return "Nije klasifikovano / poseban tretman";
}
