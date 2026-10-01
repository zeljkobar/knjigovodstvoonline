"use server";

import * as service from "@/lib/bank-statement-service";

export async function importBankStatement(formData: FormData) {
  return service.importBankStatement(formData);
}

export async function updateBankStatementLines(formData: FormData) {
  return service.updateBankStatementLines(formData);
}

export async function reapplyBankStatementRules(formData: FormData) {
  return service.reapplyBankStatementRules(formData);
}

export async function deleteBankStatement(formData: FormData) {
  return service.deleteBankStatement(formData);
}

export async function saveBankStatementAccountSettings(formData: FormData) {
  return service.saveBankStatementAccountSettings(formData);
}

export async function createBankPostingRule(formData: FormData) {
  return service.createBankPostingRule(formData);
}

export async function deleteBankPostingRule(formData: FormData) {
  return service.deleteBankPostingRule(formData);
}

export async function postSelectedBankStatements(formData: FormData) {
  await service.postSelectedBankStatements(formData);
}

export async function postReadyBankStatements() {
  await service.postReadyBankStatements();
}

export async function importBankStatementMailMessage(input: Parameters<typeof service.importBankStatementMailMessage>[0]) {
  return service.importBankStatementMailMessage(input);
}
