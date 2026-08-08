import "server-only";

import { randomUUID } from "crypto";

type FiscalApiErrorBody = {
  code?: string;
  message?: string;
  details?: unknown[];
};

type FiscalApiEnvelope<T> = {
  success: boolean;
  data: T;
  error?: FiscalApiErrorBody | null;
  correlationId?: string;
};

export class FiscalAdminApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly correlationId?: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "FiscalAdminApiError";
  }
}

export type FiscalActor = {
  id: string;
  name: string;
};

export type FiscalCompany = {
  id: string;
  tin: string;
  legalName: string;
  shortName?: string | null;
  address?: string | null;
  town?: string | null;
  country: string;
  isVatPayer: boolean;
  isActive: boolean;
  environment: "Test" | "Production";
  endpoint?: string | null;
  softwareCode?: string | null;
  maintainerCode?: string | null;
};

export type FiscalReadiness = {
  companyId: string;
  isReady: boolean;
  issues: Array<{ code: string; message: string }>;
  activeCertificateId?: string | null;
};

export type FiscalBusinessUnit = { id: string; companyId: string; environment?: string; code: string; name: string; address?: string | null; town?: string | null; isActive: boolean };
export type FiscalDevice = { id: string; companyId: string; businessUnitId: string; tcrCode?: string | null; internalCode: string; registrationStatus?: string; registeredAt?: string | null; isActive: boolean };
export type FiscalOperator = { id: string; companyId: string; environment?: string; operatorCode: string; firstName?: string | null; lastName?: string | null; isActive: boolean };
export type FiscalCertificate = { id: string; companyId: string; fileName: string; thumbprint: string; serialNumber?: string; subject: string; issuer: string; validFrom: string; validTo: string; isActive: boolean; activatedAt?: string | null; deactivatedAt?: string | null };
export type FiscalActivation = { status?: string; environment?: string; testConfirmedAt?: string | null; testValidUntil?: string | null; testInvoiceId?: string | null; testJikr?: string | null; productionActivatedAt?: string | null; [key: string]: unknown };
export type FiscalProductionProfile = {
  producerCode?: string | null;
  softwareName?: string | null;
  softwareVersion?: string | null;
  softwareCode?: string | null;
  maintainerCode?: string | null;
  isSoftwareCertified?: boolean;
  paymentPolicy?: string | null;
  businessUnit?: FiscalBusinessUnit | null;
  operator?: FiscalOperator | null;
  device?: (FiscalDevice & { registrationStatus?: string | null; registeredAt?: string | null }) | null;
  [key: string]: unknown;
};
export type FiscalInvoice = {
  id: string;
  companyId: string;
  invoiceNumber: string;
  officialInvoiceNumber?: string | null;
  status: string;
  totalGrossAmount: number;
  iic?: string | null;
  jikr?: string | null;
  qrCodeData?: string | null;
  [key: string]: unknown;
};
export type FiscalInvoiceSubmission = {
  invoiceId: string;
  isSuccess: boolean;
  invoiceNumber: string;
  status: string;
  iic?: string | null;
  jikr?: string | null;
  qrCodeData?: string | null;
  faultCode?: string | null;
  faultMessage?: string | null;
};
export type FiscalAuditPage = { items: Array<{ id?: string; action: string; actor?: string | null; correlationId?: string | null; occurredAt?: string; dataJson?: string; [key: string]: unknown }>; page: number; pageSize: number; totalCount: number };
export type FiscalCertificateAlert = { id: string; thresholdDays?: number; daysRemaining?: number; isAcknowledged?: boolean; createdAt?: string; certificateId?: string; certificateValidTo?: string; companyName?: string; companyTin?: string; [key: string]: unknown };
export type FiscalCertificateExpiration = { certificateId: string; companyId: string; companyTin: string; companyName: string; fileName: string; thumbprint: string; validTo: string; daysRemaining: number; isExpired: boolean };
export type FiscalCertificateScan = { certificatesChecked: number; alertsCreated: number; scannedAt: string };
export type FiscalApiClient = { id: string; clientId: string; name: string; keyPrefix: string; permissions: string[]; companyIds: string[]; isActive: boolean; expiresAt?: string | null; lastUsedAt?: string | null; createdAt: string };
export type CreatedFiscalApiClient = { client: FiscalApiClient; apiKey: string };

function config() {
  const baseUrl = process.env.FISCAL_API_BASE_URL?.replace(/\/$/, "");
  const clientId = process.env.FISCAL_API_CLIENT_ID;
  const apiKey = process.env.FISCAL_API_KEY;

  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    (baseUrl === "http://localhost:5127" || baseUrl === "http://127.0.0.1:5127");

  if (!baseUrl || (!localDevelopment && (!clientId || !apiKey))) {
    throw new FiscalAdminApiError(
      "FISCAL_API_NOT_CONFIGURED",
      "Serverska veza sa Fiscal API-jem nije podešena."
    );
  }

  return { baseUrl, clientId, apiKey, localDevelopment };
}

async function fiscalRequest<T>(
  path: string,
  actor: FiscalActor,
  init: RequestInit = {},
  timeoutMs = 15_000
): Promise<{ data: T; correlationId?: string }> {
  const { baseUrl, clientId, apiKey } = config();
  const correlationId = randomUUID();
  const headers = new Headers(init.headers);
  if (clientId && apiKey) {
    headers.set("X-Fiscal-Client-Id", clientId);
    headers.set("X-Fiscal-Api-Key", apiKey);
  }
  headers.set("X-Fiscal-Actor-Id", actor.id);
  headers.set("X-Fiscal-Actor-Name", actor.name);
  headers.set("X-Correlation-Id", correlationId);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new FiscalAdminApiError(
      "FISCAL_API_UNAVAILABLE",
      "Fiscal API trenutno nije dostupan.",
      correlationId
    );
  }

  let envelope: FiscalApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as FiscalApiEnvelope<T>;
  } catch {
    // Strukturisana greška se formira ispod bez otkrivanja internog odgovora.
  }

  if (response.ok && response.status === 204) {
    return { data: undefined as T, correlationId };
  }

  const responseCorrelationId = envelope?.correlationId ?? correlationId;
  if (!response.ok || !envelope?.success) {
    throw new FiscalAdminApiError(
      envelope?.error?.code ?? `FISCAL_API_HTTP_${response.status}`,
      envelope?.error?.message ?? "Fiscal API je odbio zahtjev.",
      responseCorrelationId,
      response.status
    );
  }

  return { data: envelope.data, correlationId: responseCorrelationId };
}

export const fiscalAdminApi = {
  listCompanies(actor: FiscalActor) {
    return fiscalRequest<FiscalCompany[]>("/api/v1/admin/companies", actor);
  },
  getCompany(companyId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalCompany>(`/api/v1/admin/companies/${companyId}`, actor);
  },
  upsertCompany(payload: Record<string, unknown>, actor: FiscalActor) {
    return fiscalRequest<FiscalCompany>("/api/v1/admin/companies", actor, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateCompany(companyId: string, payload: Record<string, unknown>, actor: FiscalActor) {
    return fiscalRequest<FiscalCompany>(`/api/v1/admin/companies/${companyId}`, actor, { method: "PUT", body: JSON.stringify(payload) });
  },
  updateFiscalIdentity(companyId: string, payload: Record<string, unknown>, actor: FiscalActor) {
    return fiscalRequest<FiscalCompany>(`/api/v1/admin/companies/${companyId}/fiscal-identity`, actor, { method: "PUT", body: JSON.stringify(payload) });
  },
  getReadiness(companyId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalReadiness>(
      `/api/v1/admin/companies/${companyId}/readiness`,
      actor
    );
  },
  listBusinessUnits(companyId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalBusinessUnit[]>(`/api/v1/admin/companies/${companyId}/business-units`, actor);
  },
  createBusinessUnit(companyId: string, payload: Record<string, unknown>, actor: FiscalActor) {
    return fiscalRequest<FiscalBusinessUnit>(`/api/v1/admin/companies/${companyId}/business-units`, actor, { method: "POST", body: JSON.stringify(payload) });
  },
  updateBusinessUnit(companyId: string, id: string, payload: Record<string, unknown>, actor: FiscalActor) {
    return fiscalRequest<FiscalBusinessUnit>(`/api/v1/admin/companies/${companyId}/business-units/${id}`, actor, { method: "PUT", body: JSON.stringify(payload) });
  },
  setBusinessUnitActive(companyId: string, id: string, active: boolean, actor: FiscalActor) {
    return fiscalRequest<FiscalBusinessUnit>(`/api/v1/admin/companies/${companyId}/business-units/${id}/${active ? "activate" : "deactivate"}`, actor, { method: "POST" });
  },
  listDevices(companyId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalDevice[]>(`/api/v1/admin/companies/${companyId}/devices`, actor);
  },
  createDevice(companyId: string, payload: Record<string, unknown>, actor: FiscalActor) {
    return fiscalRequest<FiscalDevice>(`/api/v1/admin/companies/${companyId}/devices`, actor, { method: "POST", body: JSON.stringify(payload) });
  },
  updateDevice(companyId: string, id: string, payload: Record<string, unknown>, actor: FiscalActor) {
    return fiscalRequest<FiscalDevice>(`/api/v1/admin/companies/${companyId}/devices/${id}`, actor, { method: "PUT", body: JSON.stringify(payload) });
  },
  setDeviceActive(companyId: string, id: string, active: boolean, actor: FiscalActor) {
    return fiscalRequest<FiscalDevice>(`/api/v1/admin/companies/${companyId}/devices/${id}/${active ? "activate" : "deactivate"}`, actor, { method: "POST" });
  },
  listOperators(companyId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalOperator[]>(`/api/v1/admin/companies/${companyId}/operators`, actor);
  },
  createOperator(companyId: string, payload: Record<string, unknown>, actor: FiscalActor) {
    return fiscalRequest<FiscalOperator>(`/api/v1/admin/companies/${companyId}/operators`, actor, { method: "POST", body: JSON.stringify(payload) });
  },
  updateOperator(companyId: string, id: string, payload: Record<string, unknown>, actor: FiscalActor) {
    return fiscalRequest<FiscalOperator>(`/api/v1/admin/companies/${companyId}/operators/${id}`, actor, { method: "PUT", body: JSON.stringify(payload) });
  },
  setOperatorActive(companyId: string, id: string, active: boolean, actor: FiscalActor) {
    return fiscalRequest<FiscalOperator>(`/api/v1/admin/companies/${companyId}/operators/${id}/${active ? "activate" : "deactivate"}`, actor, { method: "POST" });
  },
  listCertificates(companyId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalCertificate[]>(`/api/v1/admin/companies/${companyId}/certificates`, actor);
  },
  uploadCertificate(companyId: string, formData: FormData, actor: FiscalActor) {
    return fiscalRequest<FiscalCertificate>(`/api/v1/admin/companies/${companyId}/certificates`, actor, { method: "POST", body: formData });
  },
  activateCertificate(companyId: string, certificateId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalCertificate>(`/api/v1/admin/companies/${companyId}/certificates/${certificateId}/activate`, actor, { method: "POST" });
  },
  deactivateCertificate(companyId: string, certificateId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalCertificate>(`/api/v1/admin/companies/${companyId}/certificates/${certificateId}/deactivate`, actor, { method: "POST" });
  },
  listCertificateExpirations(days: number, actor: FiscalActor) {
    return fiscalRequest<FiscalCertificateExpiration[]>(`/api/v1/admin/certificate-expirations?days=${days}`, actor);
  },
  scanCertificateExpirations(actor: FiscalActor) {
    return fiscalRequest<FiscalCertificateScan>("/api/v1/admin/certificate-expirations/scan", actor, { method: "POST" });
  },
  getActivation(companyId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalActivation>(`/api/v1/admin/companies/${companyId}/activation`, actor);
  },
  confirmTest(companyId: string, invoiceId: string, confirmation: string, actor: FiscalActor) {
    return fiscalRequest<FiscalActivation>(`/api/v1/admin/companies/${companyId}/activation/confirm-test`, actor, { method: "POST", body: JSON.stringify({ invoiceId, confirmation }) });
  },
  activateProduction(companyId: string, confirmation: string, actor: FiscalActor) {
    return fiscalRequest<FiscalActivation>(`/api/v1/admin/companies/${companyId}/activation/production`, actor, { method: "POST", body: JSON.stringify({ confirmation }) });
  },
  returnToTest(companyId: string, confirmation: string, actor: FiscalActor) {
    return fiscalRequest<FiscalActivation>(`/api/v1/admin/companies/${companyId}/activation/return-to-test`, actor, { method: "POST", body: JSON.stringify({ confirmation }) });
  },
  getProductionProfile(companyId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalProductionProfile>(`/api/v1/admin/companies/${companyId}/production-profile`, actor);
  },
  updateProductionProfile(companyId: string, payload: Record<string, unknown>, actor: FiscalActor) {
    return fiscalRequest<FiscalProductionProfile>(`/api/v1/admin/companies/${companyId}/production-profile`, actor, { method: "PUT", body: JSON.stringify(payload) });
  },
  registerProductionEnu(companyId: string, payload: Record<string, unknown>, actor: FiscalActor) {
    return fiscalRequest<FiscalProductionProfile>(`/api/v1/admin/companies/${companyId}/production-profile/register-enu`, actor, { method: "POST", body: JSON.stringify(payload) }, 60_000);
  },
  createInvoice(payload: Record<string, unknown>, idempotencyKey: string, actor: FiscalActor) {
    return fiscalRequest<FiscalInvoice>("/api/v1/fiscal/invoices", actor, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload)
    });
  },
  getInvoice(invoiceId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalInvoice>(`/api/v1/fiscal/invoices/${invoiceId}`, actor);
  },
  fiscalizeInvoice(invoiceId: string, confirmation: string, actor: FiscalActor) {
    return fiscalRequest<FiscalInvoiceSubmission>(`/api/v1/fiscal/invoices/${invoiceId}/fiscalize`, actor, {
      method: "POST",
      body: JSON.stringify({ confirmation })
    }, 60_000);
  },
  listAudit(companyId: string, actor: FiscalActor, filters: { page?: number; pageSize?: number; action?: string; actor?: string; from?: string; to?: string } = {}) {
    const params = new URLSearchParams({ page: String(filters.page ?? 1), pageSize: String(filters.pageSize ?? 25) });
    if (filters.action) params.set("action", filters.action);
    if (filters.actor) params.set("actor", filters.actor);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    return fiscalRequest<FiscalAuditPage>(`/api/v1/admin/companies/${companyId}/audit?${params}`, actor);
  },
  listCertificateAlerts(companyId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalCertificateAlert[]>(`/api/v1/admin/companies/${companyId}/certificate-alerts?includeAcknowledged=true`, actor);
  },
  acknowledgeCertificateAlert(companyId: string, alertId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalCertificateAlert>(`/api/v1/admin/companies/${companyId}/certificate-alerts/${alertId}/acknowledge`, actor, { method: "POST" });
  },
  activateCompany(companyId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalCompany>(
      `/api/v1/admin/companies/${companyId}/activate`,
      actor,
      { method: "POST" }
    );
  },
  deactivateCompany(companyId: string, actor: FiscalActor) {
    return fiscalRequest<FiscalCompany>(
      `/api/v1/admin/companies/${companyId}/deactivate`,
      actor,
      { method: "POST" }
    );
  },
  listApiClients(actor: FiscalActor) {
    return fiscalRequest<FiscalApiClient[]>("/api/v1/admin/api-clients", actor);
  },
  createApiClient(payload: Record<string, unknown>, actor: FiscalActor) {
    return fiscalRequest<CreatedFiscalApiClient>("/api/v1/admin/api-clients", actor, { method: "POST", body: JSON.stringify(payload) });
  },
  rotateApiClientKey(id: string, actor: FiscalActor) {
    return fiscalRequest<CreatedFiscalApiClient>(`/api/v1/admin/api-clients/${id}/rotate-key`, actor, { method: "POST" });
  },
  deactivateApiClient(id: string, actor: FiscalActor) {
    return fiscalRequest<void>(`/api/v1/admin/api-clients/${id}`, actor, { method: "DELETE" });
  }
};

export function isFiscalApiConfigured() {
  const baseUrl = process.env.FISCAL_API_BASE_URL?.replace(/\/$/, "");
  const localDevelopment = process.env.NODE_ENV !== "production" &&
    (baseUrl === "http://localhost:5127" || baseUrl === "http://127.0.0.1:5127");
  return Boolean(baseUrl && (localDevelopment || (process.env.FISCAL_API_CLIENT_ID && process.env.FISCAL_API_KEY)));
}
