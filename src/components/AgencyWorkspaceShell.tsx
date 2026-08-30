"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { NavigationItem } from "@/lib/navigation";

const sidebarStorageKey = "agency-sidebar-collapsed";

function AgencyNavigationIcon({ section }: { section: string }) {
  const paths: Record<string, ReactNode> = {
    dashboard: (
      <>
        <rect height="7" rx="1" width="7" x="3" y="3" />
        <rect height="7" rx="1" width="7" x="14" y="3" />
        <rect height="7" rx="1" width="7" x="3" y="14" />
        <rect height="7" rx="1" width="7" x="14" y="14" />
      </>
    ),
    firme: (
      <>
        <path d="M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16" />
        <path d="M17 9h2a2 2 0 0 1 2 2v10M8 7h2M13 7h1M8 11h2M13 11h1M8 15h2M13 15h1M3 21h19" />
      </>
    ),
    nalozi: (
      <>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M14 3v5h5M9 12h6M9 16h6" />
      </>
    ),
    racuni: (
      <>
        <path d="M5 4h14v16l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L5 20z" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
    pdv: (
      <>
        <circle cx="8" cy="8" r="2.25" />
        <circle cx="16" cy="16" r="2.25" />
        <path d="m17.5 6.5-11 11" />
      </>
    ),
    izvodi: (
      <>
        <path d="M3 7h18M5 7V5h14v2M5 7v12h14V7M8 11h8M8 15h5" />
      </>
    ),
    pos: (
      <>
        <path d="M5 8h14l1 13H4zM7 8l1-5h8l1 5" />
        <path d="M8 12h8M8 16h3M15 16h1" />
      </>
    ),
    robno: (
      <>
        <path d="m4 7 8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10" />
      </>
    ),
    plate: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 7h5M18.5 4.5v5" />
      </>
    ),
    "zavrsni-racun": (
      <>
        <path d="M5 3h14v18H5zM9 8h6M9 12h6" />
        <path d="m9 17 2 2 4-4" />
      </>
    ),
    izvjestaji: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
    korisnici: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="10" r="2.5" />
        <path d="M3 20a6 6 0 0 1 12 0M14 16a5 5 0 0 1 7 4" />
      </>
    ),
    podesavanja: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    )
  };

  return (
    <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      {paths[section] ?? paths.dashboard}
    </svg>
  );
}

type AgencyWorkspaceShellProps = {
  children: ReactNode;
  logoutAction: () => Promise<void>;
  navigation: NavigationItem[];
  userName: string;
};

export function AgencyWorkspaceShell({
  children,
  logoutAction,
  navigation,
  userName
}: AgencyWorkspaceShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(sidebarStorageKey) === "true");
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileOpen]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(sidebarStorageKey, String(next));
      return next;
    });
  }

  return (
    <main
      className={`admin-app agency-app${collapsed ? " sidebar-collapsed" : ""}${mobileOpen ? " sidebar-mobile-open" : ""}`}
    >
      <button
        aria-controls="agency-sidebar"
        aria-expanded={mobileOpen}
        aria-label={mobileOpen ? "Zatvori glavni meni" : "Otvori glavni meni"}
        className="sidebar-mobile-trigger"
        onClick={() => setMobileOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true">{mobileOpen ? "×" : "☰"}</span>
        <strong>Meni</strong>
      </button>

      <button
        aria-controls="agency-sidebar"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Proširi glavni meni" : "Sklopi glavni meni"}
        className="sidebar-collapse-button"
        onClick={toggleCollapsed}
        title={collapsed ? "Proširi meni" : "Sklopi meni"}
        type="button"
      >
        <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
      </button>

      <button
        aria-label="Zatvori glavni meni"
        className="sidebar-mobile-backdrop"
        onClick={() => setMobileOpen(false)}
        tabIndex={mobileOpen ? 0 : -1}
        type="button"
      />

      <aside className="admin-sidebar agency-sidebar" id="agency-sidebar">
        <div>
          <div className="sidebar-brand">
            <span className="sidebar-logo">SS</span>
            <div className="sidebar-brand-copy">
              <p className="admin-kicker">Računovodstveni</p>
              <h1>Program</h1>
            </div>
          </div>
          <p className="admin-user" title={collapsed ? userName : undefined}>
            <span aria-hidden="true" className="admin-user-initial">
              {userName.slice(0, 1).toUpperCase()}
            </span>
            <span className="admin-user-label">{userName}</span>
          </p>
        </div>

        <nav className="admin-nav" aria-label="Agencijska navigacija">
          {navigation.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/agencija" && pathname.startsWith(`${item.href}/`));

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={active ? "active" : undefined}
                href={item.href}
                key={item.href}
                title={collapsed ? item.label : undefined}
              >
                <span aria-hidden="true" className="admin-nav-icon">
                  <AgencyNavigationIcon section={item.section} />
                </span>
                <span className="admin-nav-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <form action={logoutAction}>
          <button className="sidebar-button" title={collapsed ? "Odjava" : undefined} type="submit">
            <span aria-hidden="true" className="sidebar-button-icon">
              ↪
            </span>
            <span className="sidebar-button-label">Odjava</span>
          </button>
        </form>
      </aside>

      <section className="admin-main">{children}</section>
    </main>
  );
}
