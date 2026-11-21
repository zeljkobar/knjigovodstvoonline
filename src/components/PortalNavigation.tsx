"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { PortalNavigationItem } from "@/lib/portal-navigation";

type PortalNavigationProps = {
  items: PortalNavigationItem[];
};

function isActive(pathname: string, href: string) {
  if (href === "/portal") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalNavigation({ items }: PortalNavigationProps) {
  const pathname = usePathname();
  const moreMenu = useRef<HTMLDetailsElement>(null);
  const closeMoreMenu = () => { if (moreMenu.current) moreMenu.current.open = false; };
  useEffect(() => { if (moreMenu.current) moreMenu.current.open = false; }, [pathname]);
  const primaryHrefs = new Set([
    "/portal",
    "/portal/pos",
    "/portal/fakture",
    "/portal/racuni"
  ]);
  const primaryItems = items.filter((item) => primaryHrefs.has(item.href));
  const moreItems = items.filter((item) => !primaryHrefs.has(item.href));

  return (
    <>
      <nav className="portal-sidebar-nav" aria-label="Navigacija portala">
        {items.map((item) => (
          <Link
            aria-current={isActive(pathname, item.href) ? "page" : undefined}
            className={isActive(pathname, item.href) ? "active" : ""}
            href={item.href}
            key={item.href}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <nav className="portal-mobile-nav" aria-label="Mobilna navigacija portala" onClick={(event) => { if ((event.target as HTMLElement).closest("a")) closeMoreMenu(); }} onKeyDown={(event) => { if (event.key === "Escape") { closeMoreMenu(); moreMenu.current?.querySelector("summary")?.focus(); } }}>
        {primaryItems.map((item) => (
          <Link
            aria-current={isActive(pathname, item.href) ? "page" : undefined}
            className={isActive(pathname, item.href) ? "active" : ""}
            href={item.href}
            key={item.href}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.shortLabel ?? item.label}
          </Link>
        ))}
        {moreItems.length > 0 ? (
          <details className="portal-mobile-more" ref={moreMenu}>
            <summary>
              <span aria-hidden="true">•••</span>
              Više
            </summary>
            <div>
              {moreItems.map((item) => (
                <Link href={item.href} key={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          </details>
        ) : null}
      </nav>
    </>
  );
}
