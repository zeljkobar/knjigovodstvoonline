import type { SessionUser } from "./session";

type Role = SessionUser["rola"];

export type NavigationItem = {
  href: string;
  icon: string;
  label: string;
  roles: Role[];
  section: string;
};

export type SubNavigationItem = {
  href: string;
  label: string;
  children?: SubNavigationItem[];
};

const agencyRoles: Role[] = ["admin_agencije", "korisnik_agencije"];
const posRoles: Role[] = ["admin_agencije", "korisnik_agencije", "klijent"];
const adminOnly: Role[] = ["admin_agencije"];

export const agencyNavigation: NavigationItem[] = [
  {
    href: "/agencija",
    icon: "▦",
    label: "Dashboard",
    roles: agencyRoles,
    section: "dashboard"
  },
  {
    href: "/agencija/firme",
    icon: "▣",
    label: "Firme",
    roles: agencyRoles,
    section: "firme"
  },
  {
    href: "/agencija/nalozi",
    icon: "▤",
    label: "Nalozi",
    roles: agencyRoles,
    section: "nalozi"
  },
  {
    href: "/agencija/racuni",
    icon: "▥",
    label: "KIF/KUF",
    roles: agencyRoles,
    section: "racuni"
  },
  {
    href: "/agencija/pdv",
    icon: "◇",
    label: "PDV",
    roles: agencyRoles,
    section: "pdv"
  },
  {
    href: "/agencija/izvodi",
    icon: "≋",
    label: "Izvodi",
    roles: agencyRoles,
    section: "izvodi"
  },
  {
    href: "/agencija/pos",
    icon: "▦",
    label: "POS / Kasa",
    roles: posRoles,
    section: "pos"
  },
  {
    href: "/agencija/robno",
    icon: "▧",
    label: "Robno",
    roles: agencyRoles,
    section: "robno"
  },
  {
    href: "/agencija/plate",
    icon: "◫",
    label: "Plate",
    roles: agencyRoles,
    section: "plate"
  },
  {
    href: "/agencija/zavrsni-racun",
    icon: "▨",
    label: "Završni račun",
    roles: agencyRoles,
    section: "zavrsni-racun"
  },
  {
    href: "/agencija/izvjestaji",
    icon: "◈",
    label: "Izvještaji",
    roles: agencyRoles,
    section: "izvjestaji"
  },
  {
    href: "/agencija/korisnici",
    icon: "◉",
    label: "Korisnici i prava",
    roles: adminOnly,
    section: "korisnici"
  },
  {
    href: "/agencija/podesavanja",
    icon: "⚙",
    label: "Podešavanja",
    roles: adminOnly,
    section: "podesavanja"
  }
];

export const subNavigation: Record<string, SubNavigationItem[]> = {
  pos: [
    { href: "/agencija/pos", label: "Prodaja" },
    { href: "/agencija/pos/racuni", label: "Fiskalni računi" },
    { href: "/agencija/pos/izvjestaji", label: "Izvještaji" },
    { href: "/agencija/pos/podesavanja", label: "Podešavanja" }
  ],
  dashboard: [
    { href: "/agencija", label: "Pregled" },
    { href: "/agencija/rokovi", label: "Rokovi" },
    { href: "/agencija/dokumenta-za-obradu", label: "Dokumenta za obradu" },
    { href: "/agencija/aktivnosti", label: "Aktivnosti radnika" },
    { href: "/agencija/upozorenja", label: "Upozorenja" },
    { href: "/agencija/statistika", label: "Statistika" }
  ],
  firme: [
    { href: "/agencija/firme", label: "Lista firmi" },
    { href: "/agencija/firme/nova", label: "Dodaj firmu" },
    { href: "/agencija/firme/poslovne-godine", label: "Poslovne godine" },
    { href: "/agencija/firme/radnici", label: "Radnici na firmama" },
    { href: "/agencija/firme/klijenti", label: "Klijentski korisnici" },
    { href: "/agencija/firme/bankovni-racuni", label: "Bankovni računi" },
    { href: "/agencija/firme/ugovori", label: "Ugovor i cijena" },
    { href: "/agencija/firme/kontni-plan", label: "Kontni plan" },
    { href: "/agencija/firme/podesavanja", label: "Podešavanja firme" }
  ],
  nalozi: [
    { href: "/agencija/nalozi", label: "Pregled naloga" },
    { href: "/agencija/nalozi/novi", label: "Novi nalog" },
    { href: "/agencija/nalozi/nacrti", label: "Nacrti" },
    { href: "/agencija/nalozi/vrste", label: "Vrste naloga" },
    { href: "/agencija/nalozi/pocetno-stanje", label: "Početno stanje" },
    { href: "/agencija/nalozi/partneri", label: "Partneri" },
    { href: "/agencija/nalozi/bruto-bilans", label: "Bruto bilans" },
    { href: "/agencija/nalozi/analiticke-kartice", label: "Kartice konta" },
    { href: "/agencija/nalozi/kupci-dobavljaci", label: "Kupci / dobavljači" }
  ],
  robno: [
    { href: "/agencija/robno", label: "Pregled" },
    {
      href: "/agencija/robno/sifarnici",
      label: "Šifarnici",
      children: [
        { href: "/agencija/robno/artikli", label: "Artikli" },
        { href: "/agencija/robno/grupe", label: "Grupe artikala" },
        { href: "/agencija/robno/cijene", label: "Cijene" },
        { href: "/agencija/robno/magacini", label: "Magacini" }
      ]
    },
    {
      href: "/agencija/robno/nabavka",
      label: "Nabavka",
      children: [
        { href: "/agencija/robno/kalkulacije", label: "Kalkulacije" },
        { href: "/agencija/robno/uvozne-kalkulacije", label: "Uvozne kalkulacije" },
        { href: "/agencija/robno/povrat-dobavljacu", label: "Povrat dobavljaču" }
      ]
    },
    {
      href: "/agencija/robno/prodaja",
      label: "Prodaja",
      children: [
        { href: "/agencija/robno/izlazne-fakture", label: "Izlazne fakture" },
        { href: "/agencija/robno/nova-izlazna-faktura", label: "Nova izlazna faktura" },
        { href: "/agencija/robno/razduzenja-lagera", label: "Razduženja lagera" },
        { href: "/agencija/robno/povrat-kupca", label: "Povrat kupca" }
      ]
    },
    {
      href: "/agencija/robno/promet",
      label: "Promet robe",
      children: [
        { href: "/agencija/robno/prenos", label: "Prenos robe" },
        { href: "/agencija/robno/popis", label: "Popis" },
        { href: "/agencija/robno/otpis", label: "Otpis" },
        { href: "/agencija/robno/nivelacija", label: "Nivelacija" }
      ]
    },
    {
      href: "/agencija/robno/zalihe",
      label: "Zalihe",
      children: [
        { href: "/agencija/robno/lager", label: "Lager lista" },
        { href: "/agencija/robno/kartica-artikla", label: "Kartica artikla" },
        { href: "/agencija/robno/vrijednost-zaliha", label: "Vrijednost zaliha" },
        { href: "/agencija/robno/kontrole", label: "Kontrole" }
      ]
    },
    { href: "/agencija/robno/podesavanja", label: "Podešavanja" }
  ],
  racuni: [
    { href: "/agencija/racuni/kif", label: "KIF" },
    { href: "/agencija/racuni/kuf", label: "KUF" },
    { href: "/agencija/racuni/pregled-kif", label: "Pregled KIF" },
    { href: "/agencija/racuni/pregled-kuf", label: "Pregled KUF" },
    { href: "/agencija/racuni/neproknjizeno", label: "Neproknjiženo" },
    { href: "/agencija/racuni/import", label: "Import" },
    { href: "/agencija/racuni/podesavanja", label: "Podešavanja" }
  ],
  pdv: [
    { href: "/agencija/pdv", label: "PDV pregled" },
    { href: "/agencija/pdv/ulazni", label: "Ulazni PDV" },
    { href: "/agencija/pdv/izlazni", label: "Izlazni PDV" },
    { href: "/agencija/pdv/prijava", label: "PDV prijava" },
    { href: "/agencija/pdv/kontrole", label: "Kontrole" },
    { href: "/agencija/pdv/arhiva", label: "Arhiva prijava" },
    { href: "/agencija/pdv/podesavanja", label: "Podešavanja PDV-a" }
  ],
  plate: [
    { href: "/agencija/plate", label: "Zaposleni" },
    { href: "/agencija/plate/ugovori", label: "Ugovori" },
    { href: "/agencija/plate/obracun", label: "Obračun plata" },
    {
      href: "/agencija/plate/obrasci",
      label: "Obrasci",
      children: [
        { href: "/agencija/plate/obrasci/m4", label: "M-4" },
        { href: "/agencija/plate/obrasci/opp-nd", label: "OPP-ND" },
        { href: "/agencija/plate/obrasci/ioppd", label: "IOPPD" }
      ]
    },
    { href: "/agencija/plate/obustave", label: "Obustave" },
    { href: "/agencija/plate/arhiva", label: "Arhiva obračuna" },
    { href: "/agencija/plate/podesavanja", label: "Podešavanja plata" }
  ],
  izvodi: [
    { href: "/agencija/izvodi", label: "Pregled izvoda" },
    { href: "/agencija/izvodi/obrada", label: "Obrada stavki" },
    { href: "/agencija/izvodi/pravila", label: "Pravila knjiženja" },
    { href: "/agencija/izvodi/parseri", label: "Parseri banaka" },
    { href: "/agencija/izvodi/ziro-racuni", label: "Žiro računi komitenata" },
    { href: "/agencija/izvodi/kartica-banke", label: "Kartica banke" },
    { href: "/agencija/izvodi/kontrole", label: "Kontrole" },
    { href: "/agencija/izvodi/podesavanja", label: "Podešavanja" }
  ],
  "zavrsni-racun": [
    { href: "/agencija/zavrsni-racun", label: "Priprema" },
    { href: "/agencija/zavrsni-racun/kontrole", label: "Kontrole" },
    { href: "/agencija/zavrsni-racun/bruto-bilans", label: "Bruto bilans" },
    { href: "/agencija/zavrsni-racun/zakljucna-knjizenja", label: "Zaključna knjiženja" },
    { href: "/agencija/zavrsni-racun/obrasci", label: "Obrasci" },
    { href: "/agencija/zavrsni-racun/podesavanja", label: "Podešavanja" },
    { href: "/agencija/zavrsni-racun/izvoz", label: "XML / izvoz" },
    { href: "/agencija/zavrsni-racun/arhiva", label: "Arhiva završnih računa" }
  ],
  izvjestaji: [
    { href: "/agencija/izvjestaji", label: "Bruto bilans" },
    { href: "/agencija/izvjestaji/kartice-konta", label: "Kartice konta" },
    { href: "/agencija/izvjestaji/kartice-partnera", label: "Kartice partnera" },
    { href: "/agencija/izvjestaji/rezultat-po-jedinicama", label: "Rezultat po jedinicama" },
    { href: "/agencija/izvjestaji/kupci", label: "Kupci" },
    { href: "/agencija/izvjestaji/dobavljaci", label: "Dobavljači" },
    { href: "/agencija/izvjestaji/lager", label: "Lager lista" },
    { href: "/agencija/izvjestaji/kartica-artikla", label: "Kartica artikla" },
    { href: "/agencija/izvjestaji/pdv", label: "PDV izvještaji" },
    { href: "/agencija/izvjestaji/plate", label: "Plate izvještaji" },
    { href: "/agencija/izvjestaji/finansijski", label: "Finansijski izvještaji" }
  ],
  korisnici: [
    { href: "/agencija/korisnici", label: "Radnici" },
    { href: "/agencija/korisnici?tip=klijenti", label: "Klijenti" },
    { href: "/agencija/korisnici/uloge", label: "Uloge" },
    { href: "/agencija/korisnici/prava", label: "Prava pristupa" },
    { href: "/agencija/korisnici/aktivnosti", label: "Aktivnosti radnika" },
    { href: "/agencija/korisnici/audit-log", label: "Audit log" }
  ],
  podesavanja: [
    { href: "/agencija/podesavanja/kontni-plan", label: "Kontni plan" },
    { href: "/agencija/podesavanja/podrazumijevana-konta", label: "Podrazumijevana konta" },
    { href: "/agencija/podesavanja/pdv-stope", label: "PDV stope" },
    { href: "/agencija/podesavanja/vrste-naloga", label: "Vrste naloga" },
    { href: "/agencija/podesavanja/numeracije", label: "Numeracije" },
    { href: "/agencija/podesavanja/sifarnici", label: "Šifarnici" },
    { href: "/agencija/podesavanja/poslovne-jedinice", label: "Poslovne jedinice" },
    { href: "/agencija/podesavanja/magacini", label: "Magacini" },
    { href: "/agencija/podesavanja/fiskalizacija", label: "Fiskalizacija" },
    { href: "/agencija/podesavanja/email", label: "Email podešavanja" },
    { href: "/agencija/podesavanja/sistem", label: "Sistem" }
  ]
};

export function getAgencyNavigation(rola: Role) {
  return agencyNavigation.filter((item) => item.roles.includes(rola));
}

export function getSectionFromPath(pathname: string) {
  const match = agencyNavigation
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return match?.section ?? "dashboard";
}

export function getSubNavigation(section: string) {
  return subNavigation[section] ?? [];
}
