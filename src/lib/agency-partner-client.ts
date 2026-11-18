import type { PrismaClient } from "@prisma/client";
import { agencyPartnerWhere, agencyPartnerSelection, projectAgencyPartners, selectsPartners, filtersPartners } from "./agency-partner-projection";

type Args = Record<string, unknown>;
const reads = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);

export function agencyPartnerClient(base: PrismaClient, agency: () => Promise<string | null>) {
  return base.$extends({ name: "agency-partner-presentation", query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!reads.has(operation) || (!selectsPartners(model, args as Args) && !filtersPartners(model, (args as Args).where))) return query(args);
        const agencyId = await agency();
        if (!agencyId) return query(args);
        const original = args as Args;
        const next = { ...original, ...(original.where ? { where: agencyPartnerWhere(model, original.where, agencyId) } : {}) };
        const returnsRecords = operation.startsWith("find");
        const result = await query((returnsRecords ? agencyPartnerSelection(model, next, agencyId) : next) as typeof args);
        return returnsRecords ? projectAgencyPartners(model, result, original) : result;
      }
    }
  } }) as unknown as PrismaClient;
}
