"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getSectionFromPath,
  getSubNavigation,
  type NavigationItem
} from "@/lib/navigation";

type AgencyTopBarProps = {
  agencyName: string;
  currentYear: number;
  navigation: NavigationItem[];
  userName: string;
};

export function AgencyTopBar({
  agencyName,
  currentYear,
  navigation,
  userName
}: AgencyTopBarProps) {
  const pathname = usePathname();
  const section = getSectionFromPath(pathname);
  const subItems = getSubNavigation(section);
  const currentSection = navigation.find((item) => item.section === section);

  return (
    <header className="workspace-topbar">
      <div className="context-row">
        <div className="context-pill">
          <span>Agencija</span>
          <strong>{agencyName}</strong>
        </div>
        <div className="context-pill">
          <span>Firma</span>
          <strong>Sve firme</strong>
        </div>
        <div className="context-pill">
          <span>Godina</span>
          <strong>{currentYear}</strong>
        </div>
        <div className="context-pill user-context">
          <span>Korisnik</span>
          <strong>{userName}</strong>
        </div>
      </div>

      {subItems.length > 0 ? (
        <nav className="section-tabs" aria-label={`${currentSection?.label ?? "Sekcija"} podmeni`}>
          {subItems.map((item) => {
            const isActive = pathname === item.href;

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
