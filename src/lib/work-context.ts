import { cookies } from "next/headers";

export const ACTIVE_COMPANY_COOKIE = "sso_active_company";
export const ACTIVE_YEAR_COOKIE = "sso_active_year";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 60;

export type WorkContext = {
  firmaId: string | null;
  poslovnaGodinaId: string | null;
};

export async function readWorkContext(): Promise<WorkContext> {
  const cookieStore = await cookies();

  return {
    firmaId: cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value ?? null,
    poslovnaGodinaId: cookieStore.get(ACTIVE_YEAR_COOKIE)?.value ?? null
  };
}

export function workContextCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
    path: "/"
  };
}
