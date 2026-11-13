import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";

export default async function AdminSitePage() {
  await requireRole("admin");
  redirect("/admin/sajt/backup");
}
