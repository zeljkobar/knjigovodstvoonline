import type { FiscalAdminInvoiceRow } from "./fiscal-admin-api";

export interface FiscalReviewError { category: string; code: string; message: string; occurredAt: string }
export interface FiscalReviewCoverage { availableSince?: string | null; partial: boolean }
export interface FiscalReviewPage<T> { items: T[]; page: number; pageSize: number; totalCount: number; coverage?: FiscalReviewCoverage }
export interface FiscalReviewLabel { id: string; code?: string | null; label?: string | null; source: string }

export interface FiscalInvoiceDetail {
  id: string; companyId: string; invoiceNumber: string; officialInvoiceNumber?: string | null;
  status: string; environment: string; environmentSource: string; currency: string;
  invoiceType: string; category?: string | null; isInformational: boolean;
  issueDateTime: string; fiscalizedAt?: string | null; supplyPeriodStart?: string | null;
  supplyPeriodEnd?: string | null; paymentDeadline?: string | null;
  totalNetAmount: number; totalVatAmount: number; totalGrossAmount: number;
  iic?: string | null; jikr?: string | null; qrCodeData?: string | null;
  buyer?: { name: string; identificationType: string; identificationNumber: string; address?: string | null; town?: string | null; country?: string | null } | null;
  items: Array<{ id: string; name: string; itemCode?: string | null; unitOfMeasure?: string | null; quantity: number; unitPrice: number; vatRate: number;
    discountAmount: number; netAmount: number; vatAmount: number; grossAmount: number }>;
  payments: Array<{ paymentType: string; amount: number; reference?: string | null; advanceInvoiceId?: string | null }>;
  originalInvoiceId?: string | null; advanceSettlementFinalInvoiceId?: string | null;
  advanceRestorationStornoInvoiceId?: string | null; correctionReason?: string | null;
  businessUnit?: FiscalReviewLabel | null; device?: FiscalReviewLabel | null; operator?: FiscalReviewLabel | null;
  diagnosticsAvailability: string;
  lastAttempt?: { startedAt: string; completedAt?: string | null; outcome: string; exchangeId?: string | null; correlationId?: string | null } | null;
  lastError?: FiscalReviewError | null; lastPuError?: FiscalReviewError | null;
}

export interface FiscalTurnoverAmounts { net: string; vat: string; gross: string }
export interface FiscalTurnoverTotals {
  documentCount: number; saleInvoiceCount: number; salesPositive: FiscalTurnoverAmounts;
  salesCorrections: FiscalTurnoverAmounts; salesNet: FiscalTurnoverAmounts;
  vatByRate: Array<FiscalTurnoverAmounts & { rate: string }>;
  categories: Array<{ category: string; count: number; amounts: FiscalTurnoverAmounts }>;
  payments: Array<{ category: string; paymentType: string; count: number; amount: string }>;
  bucketStartDate?: string | null;
}

export interface FiscalTurnoverReport {
  filters: { fromUtc: string; toUtc: string };
  timeZone: string; rulesVersion: string; currency: string; authoritative: boolean; evaluatedAt: string;
  totals: FiscalTurnoverTotals; groups: FiscalTurnoverTotals[];
  controls: { statusCounts: Record<string, number>; openWorkflows: Array<{ kind: string; count: number; amount: string }> };
  coverage: FiscalReviewCoverage;
}

export type FiscalTurnoverDocument = FiscalAdminInvoiceRow & {
  contribution: { net?: string | null; vat?: string | null; gross?: string | null; amount?: string | null };
};

export interface FiscalExchangeReview {
  exchangeId: string; invoiceId?: string | null; companyId?: string | null; environment: string;
  environmentSource: string; operation: string; startedAt: string; completedAt?: string | null;
  durationMs?: number | null; correlationId: string; requestUuid?: string | null; puHttpStatus?: number | null;
  outcome: string; error?: FiscalReviewError | null; localCompletion: string;
  profileFingerprint?: string | null; provenance: string; evidenceState: string;
}

export interface FiscalApiRequestReview {
  requestId: string; startedAt: string; completedAt?: string | null; durationMs?: number | null;
  method: string; routeTemplate: string; apiHttpStatus: number; outcome: string;
  error?: FiscalReviewError | null; clientId?: string | null; initiatorId?: string | null;
  companyId?: string | null; invoiceId?: string | null; correlationId: string;
}
