import "server-only";
import { ImapFlow, type ImapFlowOptions } from "imapflow";

const messages = {
  CONFIG: "IMAP nije podešen. Provjerite IMAP varijable u serverskom .env fajlu; obavezni su TLS, port 993 i INBOX.",
  AUTH: "Prijava nije uspjela. Provjerite IMAP korisničko ime i lozinku u serverskom .env fajlu.",
  NETWORK: "IMAP server nije dostupan ili je veza prekinuta. Provjerite mrežu, adresu servera i port pa pokušajte ponovo.",
  TLS: "TLS provjera nije uspjela. Provjerite sertifikat, naziv servera i sistemsko vrijeme. Provjera sertifikata mora ostati uključena.",
  MAILBOX: "INBOX nije moguće otvoriti u režimu samo za čitanje. Provjerite pristup sandučetu.",
  PROTOCOL: "IMAP server nije uspješno završio provjeru veze. Pokušajte ponovo kasnije.",
  BUSY: "Provjera je već pokrenuta ili je nedavno završena. Sačekajte 15 sekundi pa pokušajte ponovo."
} as const;

type ErrorCode = keyof typeof messages;
export type ImapTestResult =
  | { ok: true; messageCount: number; folder: "INBOX"; readOnly: true }
  | { ok: false; code: ErrorCode; message: string };

function failure(code: ErrorCode): ImapTestResult {
  return { ok: false, code, message: messages[code] };
}

export function safeImapError(error: unknown): ImapTestResult {
  // Never return the raw message/response/command: it can contain credentials.
  const e = (error && typeof error === "object" ? error : {}) as {
    code?: string; authenticationFailed?: boolean; tlsFailed?: boolean;
  };
  const code = typeof e.code === "string" ? e.code : "";
  if (e.tlsFailed || /TLS|SSL|CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(code)) return failure("TLS");
  if (e.authenticationFailed) return failure("AUTH");
  if (["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ETIMEOUT", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "NoConnection", "ConnectionClosed", "GreetingTimeout"].includes(code)) return failure("NETWORK");
  return failure("PROTOCOL");
}

type ImapEnvironment = Record<string, string | undefined>;

export function imapOptions(env: ImapEnvironment): ImapFlowOptions | null {
  const host = env.IMAP_HOST?.trim();
  const user = env.IMAP_USER?.trim();
  const pass = env.IMAP_PASS;
  if (!host || !user || !pass || env.IMAP_PORT !== "993" || env.IMAP_SECURE !== "true" || env.IMAP_FOLDER !== "INBOX") return null;
  return {
    host, port: 993, secure: true, servername: host,
    auth: { user, pass },
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2", servername: host },
    logger: false, logRaw: false, emitLogs: false,
    disableAutoIdle: true, disableAutoEnable: true, disableCompression: true,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000
  };
}

type ProbeClient = {
  connect(): Promise<unknown>;
  mailboxOpen(folder: string, options: { readOnly: boolean }): Promise<{ readOnly?: boolean; exists: number }>;
  logout(): Promise<unknown>;
  close(): void;
  on(event: "error", listener: (error: unknown) => void): unknown;
};

export async function probeImap(
  env: ImapEnvironment = process.env,
  createClient: (options: ImapFlowOptions) => ProbeClient = (options) => new ImapFlow(options),
  timeoutMs = 25_000
): Promise<ImapTestResult> {
  const options = imapOptions(env);
  if (!options) return failure("CONFIG");
  let client: ProbeClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stage = "connect";
  try {
    client = createClient(options);
    const connection = client;
    const interrupted = new Promise<never>((_, reject) => {
      connection.on("error", reject);
      timer = setTimeout(() => {
        reject({ code: "ETIMEOUT" });
        connection.close();
      }, timeoutMs);
    });
    return await Promise.race([
      (async (): Promise<ImapTestResult> => {
        await connection.connect();
        stage = "mailbox";
        // EXAMINE only; no FETCH, STORE, SEARCH, attachments or flag changes.
        const mailbox = await connection.mailboxOpen("INBOX", { readOnly: true });
        if (!mailbox.readOnly || !Number.isSafeInteger(mailbox.exists) || mailbox.exists < 0) return failure("MAILBOX");
        const messageCount = mailbox.exists;
        stage = "logout";
        await connection.logout();
        return { ok: true, messageCount, folder: "INBOX", readOnly: true };
      })(),
      interrupted
    ]);
  } catch (error) {
    const result = safeImapError(error);
    return !result.ok && result.code === "PROTOCOL" && stage === "mailbox" ? failure("MAILBOX") : result;
  } finally {
    clearTimeout(timer);
    client?.close();
  }
}

// One connection at a time per Node process; no automatic authentication retries.
let running = false;
let nextAllowedAt = 0;
export async function testImapConnection(): Promise<ImapTestResult> {
  if (running || Date.now() < nextAllowedAt) return failure("BUSY");
  running = true;
  try {
    return await probeImap();
  } finally {
    running = false;
    nextAllowedAt = Date.now() + 15_000;
  }
}
