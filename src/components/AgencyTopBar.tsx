"use client";

import Link from "next/link";
import { ThemePicker } from "./ThemePicker";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();
  const [pendingChange, setPendingChange] = useState<{
    type: "firm" | "year";
    id: string;
    label: string;
  } | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pendingChange && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!pendingChange && dialog.open) {
      dialog.close();
    }
  }, [pendingChange]);
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
          <div className="context-form">
            <select
              aria-label="Aktivna firma"
              value={activeFirmId}
              disabled={isSwitching}
              name="firma_id"
              onChange={(event) => {
                const id = event.currentTarget.value;
                if (id === activeFirmId) return;
                const firm = firms.find(item => item.id === id);
                if (id && !firm) return;
                setPendingChange({ type: "firm", id, label: firm ? `${firm.naziv}${firm.pib ? ` (${firm.pib})` : ""}` : "" });
              }}
            >
              <option value="">Izaberite firmu</option>
              {firms.map((firma) => (
                <option key={firma.id} value={firma.id}>
                  {firma.naziv}
                  {firma.pib ? ` (${firma.pib})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="context-pill">
          <span>Godina</span>
          <div className="context-form">
            <select
              aria-label="Aktivna poslovna godina"
              value={activeYearId}
              disabled={isSwitching || !activeFirmId || years.length === 0}
              name="poslovna_godina_id"
              onChange={(event) => {
                const id = event.currentTarget.value;
                if (id === activeYearId) return;
                const year = years.find(item => item.id === id);
                if (year) setPendingChange({ type: "year", id, label: String(year.godina) });
              }}
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
          </div>
        </div>
        <div className="context-pill user-context">
          <div className="theme-user-identity"><span>Korisnik</span><strong>{userName}</strong></div>
          <ThemePicker/>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        className="context-switch-dialog"
        aria-labelledby="context-switch-title"
        aria-describedby="context-switch-message"
        onCancel={(event) => {
          event.preventDefault();
          if (!isSwitching) setPendingChange(null);
        }}
      >
        {pendingChange ? <>
          <div className="context-switch-icon" aria-hidden="true">⇄</div>
          <h2 id="context-switch-title">{pendingChange.type === "firm" ? "Promjena firme" : "Promjena poslovne godine"}</h2>
          <p id="context-switch-message">
            {pendingChange.type === "firm"
              ? pendingChange.id ? <>Da li želite da pređete na firmu <strong>{pendingChange.label}</strong>?</> : "Da li želite da poništite izbor firme?"
              : <>Da li želite da pređete na <strong>{pendingChange.label}.</strong> godinu?</>}
          </p>
          <form action="/agencija/kontekst" method="get" onSubmit={() => setIsSwitching(true)}>
            <input name="returnTo" type="hidden" value={pathname}/>
            <input name="firma_id" type="hidden" value={pendingChange.type === "firm" ? pendingChange.id : activeFirmId}/>
            {pendingChange.type === "year" ? <input name="poslovna_godina_id" type="hidden" value={pendingChange.id}/> : null}
            <div className="context-switch-actions">
              <button ref={cancelRef} type="button" className="secondary-button" disabled={isSwitching} onClick={() => setPendingChange(null)}>Odustani</button>
              <button type="submit" className="primary-button" disabled={isSwitching}>{isSwitching ? "Prelazak…" : pendingChange.type === "firm" ? "Da, promijeni firmu" : "Da, promijeni godinu"}</button>
            </div>
          </form>
        </> : null}
      </dialog>

      {subItems.length > 0 ? (
        <nav className="section-tabs" aria-label={`${currentSection?.label ?? "Sekcija"} podmeni`}>
          {subItems.map((item) => {
            const isActive =
              (section === "korisnici"
                ? pathname === item.href.split("?")[0] && (item.href.includes("tip=klijenti") ? searchParams.get("tip") === "klijenti" : searchParams.get("tip") !== "klijenti")
                : pathname === item.href) ||
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
