import type { SessionUser } from "./session";
import { permissionKey } from "./permission-policy";

type Role = SessionUser["rola"];

export type NavigationItem = {
  href: string;
  icon: string;
  label: string;
  roles: Role[];
  section: string;
  permissions?: Array<{
    modul: string;
    akcija: string;
  }>;
  permissionMode?: "all" | "any";
};

export type SubNavigationItem = {
  href: string;
  label: string;
  children?: SubNavigationItem[];
  roles?: Role[];
  permissions?: Array<{
    modul: string;
    akcija: string;
  }>;
  permissionMode?: "all" | "any";
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
    roles: adminOnly,
    section: "firme"
  },
  {
    href: "/agencija/nalozi",
    icon: "▤",
    label: "Nalozi",
    roles: agencyRoles,
    section: "nalozi",
    permissions: [{ modul: "nalozi", akcija: "view" }]
  },
  {
    href: "/agencija/racuni",
    icon: "▥",
    label: "KIF/KUF",
    roles: agencyRoles,
    section: "racuni",
    permissions: [
      { modul: "izlazni_racuni", akcija: "view" },
      { modul: "ulazni_racuni", akcija: "view" }
    ],
    permissionMode: "any"
  },
  {
    href: "/agencija/pdv",
    icon: "◇",
    label: "PDV",
    roles: agencyRoles,
    section: "pdv",
    permissions: [{ modul: "pdv", akcija: "view" }]
  },
  {
    href: "/agencija/izvodi",
    icon: "≋",
    label: "Izvodi",
    roles: agencyRoles,
    section: "izvodi",
    permissions: [{ modul: "izvodi", akcija: "view" }]
  },
  {
    href: "/agencija/pos",
    icon: "▦",
    label: "POS / Kasa",
    roles: posRoles,
    section: "pos",
    permissions: [{ modul: "pos", akcija: "view" }]
  },
  {
    href: "/agencija/robno",
    icon: "▧",
    label: "Robno",
    roles: agencyRoles,
    section: "robno",
    permissions: [{ modul: "robno", akcija: "view" }]
  },
  {
    href: "/agencija/plate",
    icon: "◫",
    label: "Plate",
    roles: agencyRoles,
    section: "plate",
    permissions: [{ modul: "plate", akcija: "view" }]
  },
  {
    href: "/agencija/zavrsni-racun",
    icon: "▨",
    label: "Završni račun",
    roles: agencyRoles,
    section: "zavrsni-racun",
    permissions: [{ modul: "zavrsni_racun", akcija: "view" }]
  },
  {
    href: "/agencija/izvjestaji",
    icon: "◈",
    label: "Izvještaji",
    roles: agencyRoles,
    section: "izvjestaji",
    permissions: [{ modul: "izvjestaji", akcija: "view" }]
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
    { href: "/agencija/pos/podesavanja", label: "Podešavanja", roles: adminOnly }
  ],
  dashboard: [
    { href: "/agencija", label: "Pregled" },
    { href: "/agencija/rokovi", label: "Rokovi" },
    { href: "/agencija/dokumenta-za-obradu", label: "Dokumenta za obradu" },
    { href: "/agencija/aktivnosti", label: "Aktivnosti radnika", roles: adminOnly },
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
    { href: "/agencija/nalozi/vrste", label: "Vrste naloga", roles: adminOnly },
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
    { href: "/agencija/robno/podesavanja", label: "Podešavanja", roles: adminOnly }
  ],
  racuni: [
    { href: "/agencija/racuni/kif", label: "KIF", permissions: [{ modul: "izlazni_racuni", akcija: "view" }] },
    { href: "/agencija/racuni/kuf", label: "KUF", permissions: [{ modul: "ulazni_racuni", akcija: "view" }] },
    { href: "/agencija/racuni/pregled-kif", label: "Pregled KIF", permissions: [{ modul: "izlazni_racuni", akcija: "view" }] },
    { href: "/agencija/racuni/pregled-kuf", label: "Pregled KUF", permissions: [{ modul: "ulazni_racuni", akcija: "view" }] },
    {
      href: "/agencija/racuni/neproknjizeno",
      label: "Neproknjiženo",
      permissions: [
        { modul: "izlazni_racuni", akcija: "view" },
        { modul: "ulazni_racuni", akcija: "view" }
      ],
      permissionMode: "any"
    },
    {
      href: "/agencija/racuni/import",
      label: "Import",
      permissions: [
        { modul: "izlazni_racuni", akcija: "create" },
        { modul: "ulazni_racuni", akcija: "create" }
      ],
      permissionMode: "any"
    },
    { href: "/agencija/racuni/podesavanja", label: "Podešavanja", roles: adminOnly }
  ],
  pdv: [
    { href: "/agencija/pdv", label: "PDV pregled" },
    { href: "/agencija/pdv/ulazni", label: "Ulazni PDV" },
    { href: "/agencija/pdv/izlazni", label: "Izlazni PDV" },
    { href: "/agencija/pdv/prijava", label: "PDV prijava" },
    { href: "/agencija/pdv/kontrole", label: "Kontrole" },
    { href: "/agencija/pdv/arhiva", label: "Arhiva prijava" },
    { href: "/agencija/pdv/podesavanja", label: "Podešavanja PDV-a", roles: adminOnly }
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
    { href: "/agencija/plate/podesavanja", label: "Podešavanja plata", roles: adminOnly }
  ],
  izvodi: [
    { href: "/agencija/izvodi", label: "Pregled izvoda" },
    { href: "/agencija/izvodi/obrada", label: "Obrada stavki" },
    {
      href: "/agencija/izvodi/pravila",
      label: "Pravila knjiženja",
      permissions: [{ modul: "izvodi", akcija: "manage" }]
    },
    { href: "/agencija/izvodi/parseri", label: "Parseri banaka" },
    { href: "/agencija/izvodi/ziro-racuni", label: "Žiro računi komitenata" },
    { href: "/agencija/izvodi/kartica-banke", label: "Kartica banke" },
    { href: "/agencija/izvodi/kontrole", label: "Kontrole" },
    { href: "/agencija/izvodi/podesavanja", label: "Podešavanja", roles: adminOnly }
  ],
  "zavrsni-racun": [
    { href: "/agencija/zavrsni-racun", label: "Priprema" },
    { href: "/agencija/zavrsni-racun/kontrole", label: "Kontrole" },
    { href: "/agencija/zavrsni-racun/bruto-bilans", label: "Bruto bilans" },
    { href: "/agencija/zavrsni-racun/zakljucna-knjizenja", label: "Zaključna knjiženja" },
    { href: "/agencija/zavrsni-racun/obrasci", label: "Obrasci" },
    { href: "/agencija/zavrsni-racun/podesavanja", label: "Podešavanja", roles: adminOnly },
    { href: "/agencija/zavrsni-racun/xml", label: "XML / izvoz" },
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

export function canAccessAgencyNavigationItem(
  item: NavigationItem,
  permissionKeys: ReadonlySet<string>
) {
  if (!item.permissions?.length) {
    return true;
  }

  const checks = item.permissions.map((permission) =>
    permissionKeys.has(permissionKey(permission.modul, permission.akcija))
  );

  return item.permissionMode === "any"
    ? checks.some(Boolean)
    : checks.every(Boolean);
}

export function getAgencyNavigation(
  rola: Role,
  permissionKeys: ReadonlySet<string> = new Set()
) {
  return agencyNavigation.filter(
    (item) =>
      item.roles.includes(rola) &&
      (rola === "admin_agencije" ||
        canAccessAgencyNavigationItem(item, permissionKeys))
  );
}

export function getSectionFromPath(pathname: string) {
  const match = agencyNavigation
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return match?.section ?? "dashboard";
}

function filterSubNavigation(
  items: SubNavigationItem[],
  rola: Role,
  permissionKeys: ReadonlySet<string>
): SubNavigationItem[] {
  return items
    .filter((item) => {
      if (item.roles && !item.roles.includes(rola)) {
        return false;
      }

      if (rola === "admin_agencije" || !item.permissions?.length) {
        return true;
      }

      const checks = item.permissions.map((permission) =>
        permissionKeys.has(permissionKey(permission.modul, permission.akcija))
      );

      return item.permissionMode === "any"
        ? checks.some(Boolean)
        : checks.every(Boolean);
    })
    .map((item) => ({
      ...item,
      ...(item.children
        ? { children: filterSubNavigation(item.children, rola, permissionKeys) }
        : {})
    }));
}

export function getSubNavigation(
  section: string,
  rola: Role,
  permissionKeys: ReadonlySet<string> = new Set()
): SubNavigationItem[] {
  return filterSubNavigation(subNavigation[section] ?? [], rola, permissionKeys);
}
