import {
  hasDirectPortalPermission,
  type DirectPortalPermission
} from "./direct-portal-policy";

export type PortalNavigationItem = {
  href: string;
  icon: string;
  label: string;
  shortLabel?: string;
  section: string;
  permissions?: DirectPortalPermission[];
  permissionMode?: "all" | "any";
  requiresActivePos?: boolean;
};

export const portalNavigation: PortalNavigationItem[] = [
  {
    href: "/portal",
    icon: "⌂",
    label: "Početna",
    section: "dashboard"
  },
  {
    href: "/portal/pos",
    icon: "▦",
    label: "POS / Kasa",
    shortLabel: "POS",
    section: "pos",
    permissions: [{ modul: "pos", akcija: "view" }],
    requiresActivePos: true
  },
  {
    href: "/portal/fakture",
    icon: "▧",
    label: "Fakture",
    section: "fakture",
    permissions: [
      { modul: "robno", akcija: "view" },
      { modul: "fiskalizacija", akcija: "view" }
    ],
    permissionMode: "all"
  },
  {
    href: "/portal/racuni",
    icon: "▤",
    label: "Fiskalni računi",
    shortLabel: "Računi",
    section: "racuni",
    permissions: [{ modul: "fiskalizacija", akcija: "view" }]
  },
  {
    href: "/portal/izvjestaji",
    icon: "◈",
    label: "Izvještaji",
    section: "izvjestaji",
    permissions: [{ modul: "izvjestaji", akcija: "view" }]
  },
  {
    href: "/portal/artikli",
    icon: "▥",
    label: "Artikli i usluge",
    shortLabel: "Artikli",
    section: "artikli",
    permissions: [{ modul: "robno", akcija: "view" }]
  },
  {
    href: "/portal/kupci",
    icon: "◎",
    label: "Kupci",
    section: "kupci",
    permissions: [{ modul: "robno", akcija: "view" }]
  },
  {
    href: "/portal/podesavanja",
    icon: "⚙",
    label: "Podešavanja",
    section: "podesavanja",
    permissions: [
      { modul: "pos", akcija: "manage" },
      { modul: "robno", akcija: "manage" }
    ],
    permissionMode: "any"
  },
  {
    href: "/portal/pomoc",
    icon: "?",
    label: "Pomoć",
    section: "pomoc"
  }
];

export function canAccessPortalItem(
  item: PortalNavigationItem,
  permissionKeys: ReadonlySet<string>
) {
  if (!item.permissions?.length) {
    return true;
  }

  if (item.permissionMode === "any") {
    return item.permissions.some((permission) =>
      hasDirectPortalPermission(permissionKeys, permission)
    );
  }

  return item.permissions.every((permission) =>
    hasDirectPortalPermission(permissionKeys, permission)
  );
}

export function getDirectPortalNavigation(
  permissionKeys: ReadonlySet<string>,
  posActive: boolean
) {
  return portalNavigation.filter(
    (item) =>
      canAccessPortalItem(item, permissionKeys) &&
      (!item.requiresActivePos || posActive)
  );
}

export function getPortalItemBySection(section: string) {
  return portalNavigation.find((item) => item.section === section) ?? null;
}
