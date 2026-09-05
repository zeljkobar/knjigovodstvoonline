export const configurablePermissionActions = [
  "view",
  "create",
  "update",
  "delete",
  "post",
  "cancel",
  "export",
  "manage"
] as const;

export type ConfigurablePermissionAction =
  (typeof configurablePermissionActions)[number];

export type PermissionAction = ConfigurablePermissionAction | "approve";

export function permissionKey(modul: string, akcija: string) {
  return `${modul}:${akcija}`;
}
