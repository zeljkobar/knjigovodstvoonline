export const clientPermissionGroups = [
  { id: "partneri", label: "Kupci i dobavljači", description: "Domaći i ino partneri, analitičke kartice i grafikoni dugovanja.", modules: ["izvjestaji", "nalozi"] },
  { id: "robno", label: "Robno", description: "Kalkulacije, nivelacije, ostali robni dokumenti, artikli i lager.", modules: ["robno"] },
  { id: "pdv", label: "PDV pregled", description: "Pregled sačuvanih PDV prijava po mjesecima.", modules: ["izvjestaji", "pdv"] }
] as const;

export function clientPermissionsForGroups(groups: string[]) {
  const modules = new Set<string>();
  for (const group of clientPermissionGroups) {
    if (groups.includes(group.id)) group.modules.forEach((module) => modules.add(module));
  }
  return [...modules].map((modul) => ({ modul, akcija: "view" }));
}
