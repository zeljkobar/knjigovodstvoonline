import {
  getDirectPortalContext,
  type ReadyDirectPortalContext
} from "./direct-portal";
import {
  hasDirectPortalPermission,
  type DirectPortalPermission
} from "./direct-portal-policy";

export const DIRECT_PORTAL_PARTNER_SEARCH_PERMISSIONS: DirectPortalPermission[] = [
  { modul: "fiskalizacija", akcija: "view" },
  { modul: "pos", akcija: "view" },
  { modul: "robno", akcija: "view" }
];

export const DIRECT_PORTAL_PARTNER_CREATE_PERMISSIONS: DirectPortalPermission[] = [
  { modul: "fiskalizacija", akcija: "create" },
  { modul: "pos", akcija: "create" },
  { modul: "robno", akcija: "create" }
];

type PortalPartnerAccess =
  | {
      allowed: true;
      context: ReadyDirectPortalContext;
    }
  | {
      allowed: false;
      message: string;
      status: 401 | 403;
    };

export async function authorizeDirectPortalPartnerAccess(
  permissions: DirectPortalPermission[]
): Promise<PortalPartnerAccess> {
  const context = await getDirectPortalContext();

  if (context.state === "UNAUTHENTICATED") {
    return {
      allowed: false,
      message: "Niste prijavljeni.",
      status: 401
    };
  }

  if (context.state !== "READY") {
    return {
      allowed: false,
      message: "Direktni fiskalni portal nije dostupan za ovaj nalog.",
      status: 403
    };
  }

  if (
    !permissions.some((permission) =>
      hasDirectPortalPermission(context.permissionKeys, permission)
    )
  ) {
    return {
      allowed: false,
      message: "Nemate pravo za ovu akciju.",
      status: 403
    };
  }

  return {
    allowed: true,
    context
  };
}
