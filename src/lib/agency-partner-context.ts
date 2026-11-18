import { AsyncLocalStorage } from "node:async_hooks";

// Explicit server-side context for authorised background executions. run() keeps
// parallel jobs isolated and restores the outer context when the job completes.
const context = new AsyncLocalStorage<string>();
export function partnerAgencyContext() { return context.getStore() ?? null; }
export function withPartnerAgency<T>(agencijaId: string, work: () => T): T {
  return context.run(agencijaId, work);
}
