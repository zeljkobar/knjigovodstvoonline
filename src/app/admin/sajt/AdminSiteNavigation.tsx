"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin/sajt/backup", label: "Backup baze" },
  { href: "/admin/sajt/deploy", label: "Deploy sajta" }
];

export function AdminSiteNavigation() {
  const pathname = usePathname();
  return (
    <nav className="section-tabs" aria-label="Admin sajta">
      {items.map(item => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return <Link key={item.href} href={item.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>{item.label}</Link>;
      })}
    </nav>
  );
}
