import { redirect } from "next/navigation";

export default async function JobsRedirect({ searchParams }: {
  searchParams?: Promise<{ poruka?: string }>;
}) {
  const message = (await searchParams)?.poruka;
  redirect(`/agencija/plate/ugovori/radna-mjesta${message ? `?poruka=${encodeURIComponent(message)}` : ""}`);
}
