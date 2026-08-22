import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import {
  getCurrentUser,
  isFiscalPortalUser,
  resolveAuthenticatedHome
} from "./auth";
import {
  classifyDirectCompanyCount,
  DIRECT_PORTAL_ACCESS_TYPES,
  directPortalPermissionKey,
  hasDirectPortalPermission,
  mapDirectPortalReadiness,
  podgoricaBusinessDate,
  selectDirectPortalYear,
  type DirectPortalPermission
} from "./direct-portal-policy";
import { prisma } from "./prisma";
import { readWorkContext } from "./work-context";

export const DIRECT_PORTAL_BASE_PERMISSION: DirectPortalPermission = {
  modul: "fiskalizacija",
  akcija: "view"
};

function portalStatePath(state: string) {
  return `/portal?stanje=${encodeURIComponent(state.toLowerCase())}`;
}

function safePortalReturnTo(value: string) {
  if (
    value === "/portal" ||
    value.startsWith("/portal/") ||
    value.startsWith("/portal?")
  ) {
    return value;
  }

  return "/portal";
}

export async function getDirectPortalContext() {
  const user = await getCurrentUser();

  if (!user) {
    return {
      state: "UNAUTHENTICATED" as const,
      user: null
    };
  }

  if (!user.agencija_id) {
    return {
      state: "NOT_DIRECT" as const,
      user
    };
  }

  const businessDate = podgoricaBusinessDate();
  const assignments = await prisma.korisnikFirma.findMany({
    where: {
      korisnik_id: user.id,
      is_deleted: false,
      moze_da_gleda: true,
      access_type: {
        in: [...DIRECT_PORTAL_ACCESS_TYPES]
      },
      AND: [
        {
          OR: [
            { valid_from: null },
            { valid_from: { lte: businessDate } }
          ]
        },
        {
          OR: [{ valid_to: null }, { valid_to: { gte: businessDate } }]
        }
      ],
      firma: {
        agencija_id: user.agencija_id,
        aktivan: true,
        is_deleted: false
      }
    },
    orderBy: {
      created_at: "asc"
    },
    take: 2,
    select: {
      access_type: true,
      firma: {
        select: {
          id: true,
          naziv: true,
          skraceni_naziv: true,
          pib: true,
          pdv_obveznik: true,
          grad: true,
          status_firme: true,
          poslovne_godine: {
            orderBy: [{ godina: "desc" }, { datum_od: "desc" }],
            select: {
              id: true,
              godina: true,
              datum_od: true,
              datum_do: true,
              zakljucena: true
            }
          },
          fiscalCompanyLink: {
            select: {
              fiscal_api_company_id: true,
              fiscal_environment: true,
              onboarding_status: true,
              is_suspended: true,
              last_correlation_id: true
            }
          },
          posPodesavanje: {
            select: {
              aktivan: true
            }
          }
        }
      }
    }
  });
  const companyState = classifyDirectCompanyCount(assignments.length);

  if (companyState === "NO_COMPANY") {
    if (!isFiscalPortalUser(user)) {
      return {
        state: "NOT_DIRECT" as const,
        user
      };
    }
    return {
      state: companyState,
      user
    };
  }

  if (companyState === "MULTIPLE_COMPANIES") {
    return {
      state: companyState,
      user,
      correlationId: randomUUID()
    };
  }

  const assignment = assignments[0];
  const firma = assignment.firma;
  const [permissionRows, workContext] = await Promise.all([
    prisma.korisnikPravo.findMany({
      where: {
        agencija_id: user.agencija_id,
        korisnik_id: user.id,
        firma_id: firma.id
      },
      select: {
        modul: true,
        akcija: true,
        dozvoljeno: true
      }
    }),
    readWorkContext()
  ]);
  const permissionKeys = new Set(
    permissionRows
      .filter((permission) => permission.dozvoljeno)
      .map(directPortalPermissionKey)
  );

  if (
    !hasDirectPortalPermission(
      permissionKeys,
      DIRECT_PORTAL_BASE_PERMISSION
    )
  ) {
    return {
      state: "NO_VIEW_PERMISSION" as const,
      user,
      firma
    };
  }

  const year = selectDirectPortalYear(firma.poslovne_godine, businessDate);

  if (!year) {
    return {
      state: "NO_YEAR" as const,
      user,
      firma,
      permissionKeys
    };
  }

  return {
    state: "READY" as const,
    user,
    firma,
    year,
    accessType: assignment.access_type,
    permissionKeys,
    readiness: mapDirectPortalReadiness(firma.fiscalCompanyLink),
    workContextMatches:
      workContext.firmaId === firma.id &&
      workContext.poslovnaGodinaId === year.id
  };
}

export type DirectPortalContext = Awaited<
  ReturnType<typeof getDirectPortalContext>
>;

export type ReadyDirectPortalContext = Extract<
  DirectPortalContext,
  { state: "READY" }
>;

export async function requireDirectPortalContext(
  permission?: DirectPortalPermission | DirectPortalPermission[],
  returnTo = "/portal",
  permissionMode: "any" | "all" = "any"
): Promise<ReadyDirectPortalContext> {
  const context = await getDirectPortalContext();

  if (context.state === "UNAUTHENTICATED") {
    redirect("/?greska=sesija");
  }

  if (context.state === "NOT_DIRECT") {
    redirect(await resolveAuthenticatedHome(context.user.id));
  }

  if (context.state !== "READY") {
    redirect(portalStatePath(context.state));
  }

  if (!context.workContextMatches) {
    const destination = safePortalReturnTo(returnTo);
    redirect(
      `/portal/kontekst?returnTo=${encodeURIComponent(destination)}`
    );
  }

  const required = permission
    ? Array.isArray(permission)
      ? permission
      : [permission]
    : [];

  const permissionGranted =
    permissionMode === "all"
      ? required.every((candidate) =>
          hasDirectPortalPermission(context.permissionKeys, candidate)
        )
      : required.some((candidate) =>
          hasDirectPortalPermission(context.permissionKeys, candidate)
        );

  if (required.length > 0 && !permissionGranted) {
    redirect(portalStatePath("PERMISSION_DENIED"));
  }

  return context;
}
