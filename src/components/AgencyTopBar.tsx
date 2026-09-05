"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getSectionFromPath,
  getSubNavigation,
  type NavigationItem
} from "@/lib/navigation";
import type { SessionUser } from "@/lib/session";

type AgencyTopBarProps = {
  activeFirmId: string;
  activeYearId: string;
  agencyName: string;
  currentYear: number;
  firms: Array<{
    id: string;
    naziv: string;
    pib: string | null;
  }>;
  navigation: NavigationItem[];
  permissionKeys: string[];
  userName: string;
  userRole: SessionUser["rola"];
  years: Array<{
    id: string;
    godina: number;
    zakljucena: boolean;
  }>;
};

export function AgencyTopBar({
  activeFirmId,
  activeYearId,
  agencyName,
  currentYear,
  firms,
  navigation,
  permissionKeys,
  userName,
  userRole,
  years
}: AgencyTopBarProps) {
  const pathname = usePathname();
  const section = getSectionFromPath(pathname);
  const currentSection = navigation.find((item) => item.section === section);
  const subItems = currentSection
    ? getSubNavigation(section, userRole, new Set(permissionKeys))
    : [];
  const activeSubItem = subItems.find(
    (item) =>
      pathname === item.href ||
      item.children?.some(
        (child) => pathname === child.href || pathname.startsWith(`${child.href}/`)
      )
  );
  const nestedItems = activeSubItem?.children ?? [];

  return (
    <header className="workspace-topbar">
      <div className="context-row">
        <div className="context-pill">
          <span>Agencija</span>
          <strong>{agencyName}</strong>
        </div>
        <div className="context-pill">
          <span>Firma</span>
          <form action="/agencija/kontekst" className="context-form">
            <input name="returnTo" type="hidden" value={pathname} />
            <select
              aria-label="Aktivna firma"
              defaultValue={activeFirmId}
              name="firma_id"
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              <option value="">Izaberite firmu</option>
              {firms.map((firma) => (
                <option key={firma.id} value={firma.id}>
                  {firma.naziv}
                  {firma.pib ? ` (${firma.pib})` : ""}
                </option>
              ))}
            </select>
          </form>
        </div>
        <div className="context-pill">
          <span>Godina</span>
          <form action="/agencija/kontekst" className="context-form">
            <input name="returnTo" type="hidden" value={pathname} />
            <input name="firma_id" type="hidden" value={activeFirmId} />
            <select
              aria-label="Aktivna poslovna godina"
              defaultValue={activeYearId}
              disabled={!activeFirmId || years.length === 0}
              name="poslovna_godina_id"
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              {years.length === 0 ? (
                <option value="">{currentYear}</option>
              ) : (
                years.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.godina}
                    {year.zakljucena ? " - zakljucena" : ""}
                  </option>
                ))
              )}
            </select>
          </form>
        </div>
        <div className="context-pill user-context">
          <span>Korisnik</span>
          <strong>{userName}</strong>
        </div>
      </div>

      {subItems.length > 0 ? (
        <nav className="section-tabs" aria-label={`${currentSection?.label ?? "Sekcija"} podmeni`}>
          {subItems.map((item) => {
            const isActive =
              pathname === item.href ||
              Boolean(
                item.children?.some(
                  (child) =>
                    pathname === child.href || pathname.startsWith(`${child.href}/`)
                )
              );

            return (
              <Link className={isActive ? "active" : ""} href={item.href} key={item.href}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {nestedItems.length > 0 ? (
        <nav className="section-subtabs" aria-label={`${activeSubItem?.label ?? "Sekcija"} podmeni`}>
          {nestedItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link className={isActive ? "active" : ""} href={item.href} key={item.href}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}
