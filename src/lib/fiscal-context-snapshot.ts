import type { Prisma } from "@prisma/client";

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value : null;

/** Only first-send fiscal codes are historical evidence. Current labels/preparation are not. */
export function confirmedFiscalContext(remoteValue: unknown, expectedId: string, environment: string): Prisma.InputJsonObject | undefined {
  const remote = record(remoteValue);
  const firstSend = record(record(remote?.fiscalContext)?.firstSend);
  if (!remote || !firstSend || !uuid(expectedId) || remote.id !== expectedId || !uuid(remote.companyId) ||
      !["Fiscalized", "StornoCreated"].includes(String(remote.status)) || !text(remote.jikr) ||
      !["Production", "Test"].includes(environment) || remote.environment !== environment || firstSend.environment !== environment) return undefined;
  const businessUnitCode = text(firstSend.businessUnitCode), deviceCode = text(firstSend.tcrCode), operatorCode = text(firstSend.operatorCode);
  if (!businessUnitCode || !deviceCode || !operatorCode) return undefined;
  return { version: 1, source: "API_FIRST_SEND", apiInvoiceId: expectedId, apiCompanyId: remote.companyId as string,
    environment, jikr: remote.jikr as string, businessUnitCode, deviceCode, operatorCode,
    businessUnitId: uuid(remote.businessUnitId), deviceId: uuid(remote.deviceId), operatorId: uuid(remote.operatorId) };
}

/** A snapshot is displayed only for the exact local fiscal identity. */
export function readFiscalContext(value: unknown, invoice: { fiscal_api_invoice_id: string | null; fiscal_environment: string | null; jikr: string | null }) {
  const snapshot = record(value);
  if (!snapshot || snapshot.version !== 1 || snapshot.source !== "API_FIRST_SEND" || !uuid(snapshot.apiInvoiceId) || !uuid(snapshot.apiCompanyId) || !["Test", "Production"].includes(String(snapshot.environment)) ||
      snapshot.apiInvoiceId !== invoice.fiscal_api_invoice_id || snapshot.environment !== invoice.fiscal_environment || snapshot.jikr !== invoice.jikr || !invoice.jikr ||
      !text(snapshot.businessUnitCode) || !text(snapshot.deviceCode) || !text(snapshot.operatorCode)) return null;
  return { apiCompanyId: snapshot.apiCompanyId as string, environment: snapshot.environment as string, businessUnitCode: snapshot.businessUnitCode as string, deviceCode: snapshot.deviceCode as string, operatorCode: snapshot.operatorCode as string };
}
