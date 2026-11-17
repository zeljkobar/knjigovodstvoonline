import type { FiscalInvoiceSubmission } from "./fiscal-admin-api";

export const FISCAL_CONTROL_TEST_FAILURE = "fiscal_control_test_failed";

function efiFaultMessage(value?: string | null) {
  const message = value?.split(/\s+(?:(?:Request|Response)UUID|Code)\s*=/i, 1)[0]
    .replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  // Koristimo samo tekst iz polja za EFI grešku, bez XML odgovora i pratećih identifikatora.
  if (!message || /[<>]/.test(message)) return null;
  switch (message.toLowerCase().replace(/\.$/, "")) {
    case "business unit code is not valid": return "Kod poslovne jedinice nije važeći.";
    case "issuer does not exist": return "Izdavalac računa nije pronađen u EFI sistemu.";
    default: return message.length <= 360 ? message : `${message.slice(0, 357)}…`;
  }
}

export function describeControlTestFailure(submission: FiscalInvoiceSubmission) {
  const rawCode = submission.faultCode?.trim();
  const efiCode = submission.faultMessage?.match(/\sCode\s*=\s*(\d{1,10})(?=\s|$)/i)?.[1];
  const code = efiCode ?? (rawCode && /^[\w.:-]{1,50}$/.test(rawCode) ? rawCode : null);
  const reason = efiFaultMessage(submission.faultMessage);
  if (!reason && !code) {
    return submission.jikr
      ? "Fiscal API nije potvrdio fiskalizaciju i nije vratio detaljan razlog."
      : "Fiscal API nije vratio JIKR ni detaljan razlog.";
  }
  if (!reason) return `EFI je vratio kod greške ${code} bez opisa.`;
  return `EFI: ${reason}${code ? ` (kod: ${code})` : ""}`;
}
