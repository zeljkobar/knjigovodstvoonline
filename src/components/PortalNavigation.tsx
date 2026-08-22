"use client";

import Link from "next/link";
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

      <nav className="portal-mobile-nav" aria-label="Mobilna navigacija portala">
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
          <details className="portal-mobile-more">
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
