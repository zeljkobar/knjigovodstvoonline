import { redirect } from "next/navigation";

export default async function LegacySepPage({ searchParams }: { searchParams: Promise<{ poruka?: string }> }) {
  const { poruka } = await searchParams;
  redirect(`/agencija/podesavanja/sep${poruka ? `?poruka=${encodeURIComponent(poruka)}` : ""}`);
}
