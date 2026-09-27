export function canAccessAgencyImap(
  user: { rola: string; agencija_id: string | null },
  configuredAgencyId: string | undefined
) {
  const agencyId = configuredAgencyId?.trim();
  return Boolean(agencyId && user.rola === "admin_agencije" && user.agencija_id === agencyId);
}
