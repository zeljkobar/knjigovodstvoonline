import {
  getDirectPortalContext,
  type DirectPortalContext
} from "@/lib/direct-portal";
import { resolveAuthenticatedHome } from "@/lib/auth";
import { internalRedirect } from "@/lib/internal-redirect";
import {
  ACTIVE_COMPANY_COOKIE,
  ACTIVE_YEAR_COOKIE,
  workContextCookieOptions
} from "@/lib/work-context";

function safeReturnTo(value: string | null) {
  if (
    value === "/portal" ||
    value?.startsWith("/portal/") ||
    value?.startsWith("/portal?")
  ) {
    return value;
  }

  return "/portal";
}

function stateDestination(context: DirectPortalContext) {
  const params = new URLSearchParams({
    stanje: context.state.toLowerCase()
  });

  if (context.state === "MULTIPLE_COMPANIES") {
    params.set("id", context.correlationId);
  }

  return `/portal?${params.toString()}`;
}

export async function GET(request: Request) {
  const context = await getDirectPortalContext();

  if (context.state === "UNAUTHENTICATED") {
    return internalRedirect("/?greska=sesija");
  }

  if (context.state === "NOT_DIRECT") {
    const home = await resolveAuthenticatedHome(context.user.id);
    return internalRedirect(home);
  }

  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));

  if (context.state !== "READY") {
    const response = internalRedirect(stateDestination(context));
    response.cookies.delete(ACTIVE_COMPANY_COOKIE);
    response.cookies.delete(ACTIVE_YEAR_COOKIE);
    return response;
  }

  const response = internalRedirect(returnTo);
  response.cookies.set(
    ACTIVE_COMPANY_COOKIE,
    context.firma.id,
    workContextCookieOptions()
  );
  response.cookies.set(
    ACTIVE_YEAR_COOKIE,
    context.year.id,
    workContextCookieOptions()
  );
  return response;
}
