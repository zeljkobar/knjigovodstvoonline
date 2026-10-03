import { requireAnyRole } from "@/lib/auth";
import ContractTabs from "./ContractTabs";

export default async function ContractsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  return (
    <>
      <ContractTabs canManageJobs={user.rola === "admin_agencije"} />
      {children}
    </>
  );
}
