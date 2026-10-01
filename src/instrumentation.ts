export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production" && process.env.BANK_AUTOMATION_ENABLED === "true" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startBankAutomation } = await import("./lib/bank-automation");
    startBankAutomation();
  }
}
