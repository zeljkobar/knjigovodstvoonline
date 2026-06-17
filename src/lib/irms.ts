const IRMS_BASE_URL = "https://irms.tax.gov.me/public/api";
const REQUEST_TIMEOUT_MS = 12000;
const MIN_REQUEST_INTERVAL_MS = 900;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

let requestChain = Promise.resolve();
let lastRequestAt = 0;

export type IrmsBusinessEntity = {
  id: string;
  name: string;
  legalName?: string;
  pib: string;
  registrationNumber?: string;
  legalForm?: string;
  status?: string;
  founded?: string;
  activity?: string;
  address?: string;
  city?: string;
  email?: string;
  phone?: string;
  webAddress?: string;
  capital?: string;
  directors?: Array<{
    name: string;
    lastname: string;
    role: string;
    fullName: string;
  }>;
  owners?: Array<{
    fullName: string;
    percentage: string;
  }>;
  rawData: Record<string, unknown>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function isRetryableStatus(status: number) {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function isRetryableError(error: unknown) {
  const errorWithCause = error as { cause?: { code?: string }; status?: number };
  const code = String(errorWithCause.cause?.code ?? "").toUpperCase();
  const status = Number(errorWithCause.status ?? 0);

  return (
    isRetryableStatus(status) ||
    ["ECONNABORTED", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND"].includes(
      code
    )
  );
}

async function scheduleRequest<T>(task: () => Promise<T>) {
  const runTask = async () => {
    const elapsed = Date.now() - lastRequestAt;
    const waitMs = Math.max(0, MIN_REQUEST_INTERVAL_MS - elapsed);

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    try {
      return await task();
    } finally {
      lastRequestAt = Date.now();
    }
  };

  const result = requestChain.then(runTask, runTask);
  requestChain = result.then(
    () => undefined,
    () => undefined
  );

  return result;
}

function mapDirector(role: Record<string, unknown>) {
  const name = normalizeText(role.name);
  const lastname = normalizeText(role.lastname);
  const fullName = normalizeText(role.fullName) || `${name} ${lastname}`.trim();

  return {
    name,
    lastname,
    role: normalizeText(role.role),
    fullName
  };
}

function mapOwner(owner: Record<string, unknown>) {
  return {
    fullName: normalizeText(owner.fullName),
    percentage: normalizeText(owner.percentage)
  };
}

function mapToBusinessEntity(
  apiData: Record<string, unknown>,
  directors: Array<ReturnType<typeof mapDirector>> = [],
  owners: Array<ReturnType<typeof mapOwner>> = []
): IrmsBusinessEntity {
  return {
    id: normalizeText(apiData.taxpayerId),
    name: normalizeText(apiData.shortName || apiData.fullName),
    legalName: normalizeText(apiData.fullName) || undefined,
    pib: normalizeText(apiData.identificationNumber),
    registrationNumber: normalizeText(apiData.registrationNumber) || undefined,
    legalForm: normalizeText(apiData.legalStatus) || undefined,
    status: normalizeText(apiData.taxpayerStatusDisplayName) || undefined,
    founded: normalizeText(apiData.registrationDate) || undefined,
    activity: normalizeText(apiData.mainActivity) || undefined,
    address: normalizeText(apiData.address) || undefined,
    city: normalizeText(apiData.city) || undefined,
    email: normalizeText(apiData.email) || undefined,
    phone: normalizeText(apiData.phoneNumber) || undefined,
    webAddress: normalizeText(apiData.website) || undefined,
    capital: normalizeText(apiData.totalCapital) || undefined,
    directors: directors.length > 0 ? directors : undefined,
    owners: owners.length > 0 ? owners : undefined,
    rawData: apiData
  };
}

async function getJson(path: string, params?: Record<string, string | number>) {
  const url = new URL(`${IRMS_BASE_URL}${path}`);

  Object.entries(params ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await scheduleRequest(() =>
        fetch(url, {
          headers: {
            Accept: "application/json, text/plain"
          },
          signal: controller.signal
        })
      );

      if (!response.ok) {
        const error = new Error(`IRMS status ${response.status}`) as Error & {
          status?: number;
        };
        error.status = response.status;
        throw error;
      }

      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      const isLastAttempt = attempt >= MAX_RETRIES;

      if (!isRetryableError(error) || isLastAttempt) {
        throw error;
      }

      await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

export async function searchIrmsByPib(pib: string) {
  const searchData = await getJson("/business-entities", {
    page: 1,
    perPage: 5,
    identificationNumber: pib
  });

  const results = Array.isArray(searchData?.results) ? searchData.results : [];
  const businessEntity = results[0] as Record<string, unknown> | undefined;
  const entityId = normalizeText(businessEntity?.taxpayerId);

  if (!entityId) {
    return null;
  }

  const detailsData = await getJson(`/business-entity/${entityId}`);

  if (!detailsData) {
    return null;
  }

  let directors: Array<ReturnType<typeof mapDirector>> = [];
  let owners: Array<ReturnType<typeof mapOwner>> = [];

  try {
    const rolesData = await getJson(`/business-entity/${entityId}/ownership-roles`, {
      id: entityId,
      page: 1,
      perPage: 25
    });
    const roles = Array.isArray(rolesData?.results) ? rolesData.results : [];
    directors = roles.map((role) => mapDirector(role as Record<string, unknown>));
  } catch {
    directors = [];
  }

  try {
    const ownersData = await getJson(`/business-entity/${entityId}/owners`, {
      id: entityId,
      page: 1,
      perPage: 25
    });
    const ownerResults = Array.isArray(ownersData?.results) ? ownersData.results : [];
    owners = ownerResults.map((owner) => mapOwner(owner as Record<string, unknown>));
  } catch {
    owners = [];
  }

  return mapToBusinessEntity(detailsData, directors, owners);
}
