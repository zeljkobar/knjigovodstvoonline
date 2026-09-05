import PdvPage from "../../pdv/page";
import { requireAnyRole } from "@/lib/auth";
import { requirePermissionForUser } from "@/lib/permissions";
import { readWorkContext } from "@/lib/work-context";

type PageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

export default async function ReportsPdvPage({ searchParams }: PageProps) {
  const [user, workContext] = await Promise.all([
    requireAnyRole(["admin_agencije", "korisnik_agencije"]),
    readWorkContext()
  ]);

  if (workContext.firmaId) {
    await requirePermissionForUser(user, {
      firmaId: workContext.firmaId,
      modul: "izvjestaji",
      akcija: "view"
    });
  }

  return <PdvPage searchParams={searchParams} />;
}
