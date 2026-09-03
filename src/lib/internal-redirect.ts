import { NextResponse } from "next/server";

export function internalRedirect(location: string) {
  if (!location.startsWith("/") || location.startsWith("//")) {
    throw new Error("Interni redirect mora koristiti relativnu putanju aplikacije.");
  }

  // Relativni Location browser razrjesava prema javnom domenu. Ovo je namjerno
  // nezavisno od request.url, koji iza reverse proxy-ja moze biti localhost.
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location }
  });
}
