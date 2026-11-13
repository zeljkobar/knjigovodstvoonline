import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";

export default async function LegacyBackupPage() {
  await requireRole("admin");
  redirect("/admin/sajt/backup");
}
