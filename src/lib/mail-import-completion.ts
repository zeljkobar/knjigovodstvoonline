import { prisma } from "@/lib/prisma";

type Scope = { agencija_id: string; firma_id: string; poslovna_godina_id: string };

// Keep failed/partial messages and deleted statements eligible for retry.
export async function completedMailKeys(scope: Scope, sourceKey?: string) {
  const rows = await prisma.mailIzvodObrada.findMany({
    where: { ...scope, ...(sourceKey ? { poruka_kljuc: sourceKey } : {}) },
    select: { poruka_kljuc: true, status: true, izvod: { select: { is_deleted: true } } }
  });
  const states = new Map<string, { success: boolean; pending: boolean }>();
  for (const row of rows) {
    const state = states.get(row.poruka_kljuc) ?? { success: false, pending: false };
    const success = ["IMPORTED", "DUPLICATE"].includes(row.status) && row.izvod !== null && !row.izvod.is_deleted;
    state.success ||= success;
    state.pending ||= !success && row.status !== "SKIPPED";
    states.set(row.poruka_kljuc, state);
  }
  return new Set([...states].filter(([, state]) => state.success && !state.pending).map(([key]) => key));
}
