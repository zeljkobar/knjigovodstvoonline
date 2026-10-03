"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function ContractTabs({ canManageJobs }: { canManageJobs: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: "/agencija/plate/ugovori", label: "Ugovori o radu" },
    ...(canManageJobs
      ? [{ href: "/agencija/plate/ugovori/radna-mjesta", label: "Radna mjesta" }]
      : [])
  ];
  return (
    <nav className="tabs-row" aria-label="Ugovori o radu">
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href}
          className={pathname === tab.href ? "tab-link active" : "tab-link"}
          aria-current={pathname === tab.href ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
