import { requireRole } from "@/lib/auth";
import { AdminSiteNavigation } from "./AdminSiteNavigation";

export default async function AdminSiteLayout({ children }: { children: React.ReactNode }) {
  await requireRole("admin");
  return <div className="admin-stack"><AdminSiteNavigation />{children}</div>;
}
