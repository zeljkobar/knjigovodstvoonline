import { requireAnyRole } from "./auth";
import { hasAllPermissions } from "./permissions";
import { getPayrollDocumentData } from "./payroll-documents";
import { readWorkContext } from "./work-context";

export async function loadPayrollDocumentForPrint(obracunId: string | undefined) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (
    !obracunId ||
    !user.agencija_id ||
    !workContext.firmaId ||
    !workContext.poslovnaGodinaId
  ) {
    return { data: null, error: "Izaberite firmu, poslovnu godinu i obračun." };
  }

  const allowed = await hasAllPermissions(user, [
    { firmaId: workContext.firmaId, modul: "plate", akcija: "view" },
    { firmaId: workContext.firmaId, modul: "plate", akcija: "export" }
  ]);

  if (!allowed) {
    return { data: null, error: "Nemate pravo za štampu dokumenata obračuna." };
  }

  const data = await getPayrollDocumentData({
    agencijaId: user.agencija_id,
    firmaId: workContext.firmaId,
    poslovnaGodinaId: workContext.poslovnaGodinaId,
    obracunId
  });

  if (!data) {
    return { data: null, error: "Obračun nije pronađen u aktivnom kontekstu." };
  }

  if (!data.isPrintable) {
    return { data: null, error: "Obračun prvo mora biti obrađen." };
  }

  return { data, error: null };
}
