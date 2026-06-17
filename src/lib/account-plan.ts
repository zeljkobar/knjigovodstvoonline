export const accountOverrideTypes = {
  custom: "CUSTOM",
  renamed: "RENAMED",
  deactivated: "DEACTIVATED",
  modified: "MODIFIED"
} as const;

export const defaultAccountPurposes = [
  ["DEFAULT_CUSTOMER_ACCOUNT", "Kupci"],
  ["DEFAULT_SUPPLIER_ACCOUNT", "Dobavljaci"],
  ["DEFAULT_INPUT_VAT_ACCOUNT", "Ulazni PDV"],
  ["DEFAULT_OUTPUT_VAT_ACCOUNT", "Izlazni PDV"],
  ["DEFAULT_BANK_ACCOUNT", "Banka"],
  ["DEFAULT_CASH_ACCOUNT", "Blagajna"],
  ["DEFAULT_REVENUE_ACCOUNT", "Prihod"],
  ["DEFAULT_EXPENSE_ACCOUNT", "Trosak"],
  ["DEFAULT_GOODS_ACCOUNT", "Roba"],
  ["DEFAULT_PAYROLL_ACCOUNT", "Plate"]
] as const;

export function normalBalanceForAccountCode(code: string) {
  const accountClass = code.trim().slice(0, 1);

  if (["0", "1", "2", "5"].includes(accountClass)) {
    return "D";
  }

  if (["3", "4", "6"].includes(accountClass)) {
    return "P";
  }

  return null;
}

export type AccountType = "analiticko" | "sinteticko";

export type BaseAccount = {
  id: string;
  sifra: string;
  naziv: string;
  klasa: string | null;
  tip_konta: AccountType;
  analitika_obavezna: boolean;
  sinteticki_konto: string | null;
  normalni_saldo: string | null;
  koristi_radnu_jedinicu: boolean;
  aktivan: boolean;
};

export type CompanyAccountOverride = {
  id: string;
  konto_id: string | null;
  sifra: string;
  naziv: string;
  tip_konta: AccountType;
  analitika_obavezna: boolean;
  sinteticki_konto: string | null;
  normalni_saldo: string | null;
  koristi_radnu_jedinicu: boolean;
  override_type: string;
  napomena: string | null;
  aktivan: boolean;
};

export type CombinedAccount = {
  id: string;
  baseAccountId: string | null;
  companyAccountId: string | null;
  sifra: string;
  naziv: string;
  klasa: string | null;
  tip_konta: AccountType;
  analitika_obavezna: boolean;
  sinteticki_konto: string | null;
  normalni_saldo: string | null;
  koristi_radnu_jedinicu: boolean;
  aktivan: boolean;
  source: "base" | "company" | "deactivated";
  sourceLabel: string;
  overrideType: string | null;
  napomena: string | null;
};

export function mergeCompanyAccountPlan(
  baseAccounts: BaseAccount[],
  companyOverrides: CompanyAccountOverride[]
) {
  const overridesByBaseId = new Map(
    companyOverrides
      .filter((override) => override.konto_id)
      .map((override) => [override.konto_id, override])
  );
  const combined: CombinedAccount[] = baseAccounts.map((account) => {
    const override = overridesByBaseId.get(account.id);

    if (!override) {
      return {
        id: account.id,
        baseAccountId: account.id,
        companyAccountId: null,
        sifra: account.sifra,
        naziv: account.naziv,
        klasa: account.klasa,
        tip_konta: account.tip_konta,
        analitika_obavezna: account.analitika_obavezna,
        sinteticki_konto: account.sinteticki_konto,
        normalni_saldo: account.normalni_saldo,
        koristi_radnu_jedinicu: account.koristi_radnu_jedinicu,
        aktivan: account.aktivan,
        source: "base",
        sourceLabel: "Osnovni plan",
        overrideType: null,
        napomena: null
      };
    }

    const deactivated = override.override_type === accountOverrideTypes.deactivated;

    return {
      id: override.id,
      baseAccountId: account.id,
      companyAccountId: override.id,
      sifra: account.sifra,
      naziv: deactivated ? account.naziv : override.naziv,
      klasa: account.klasa,
      tip_konta: override.tip_konta,
      analitika_obavezna: override.analitika_obavezna,
      sinteticki_konto: override.sinteticki_konto,
      normalni_saldo: override.normalni_saldo ?? account.normalni_saldo,
      koristi_radnu_jedinicu:
        override.koristi_radnu_jedinicu || account.koristi_radnu_jedinicu,
      aktivan: !deactivated && override.aktivan && account.aktivan,
      source: deactivated ? "deactivated" : "company",
      sourceLabel: deactivated ? "Deaktivirano za firmu" : "Izmjena firme",
      overrideType: override.override_type,
      napomena: override.napomena
    };
  });

  for (const override of companyOverrides) {
    if (override.konto_id) {
      continue;
    }

    combined.push({
      id: override.id,
      baseAccountId: null,
      companyAccountId: override.id,
      sifra: override.sifra,
      naziv: override.naziv,
      klasa: override.sifra.slice(0, 1) || null,
      tip_konta: override.tip_konta,
      analitika_obavezna: override.analitika_obavezna,
      sinteticki_konto: override.sinteticki_konto,
      normalni_saldo: override.normalni_saldo,
      koristi_radnu_jedinicu: override.koristi_radnu_jedinicu,
      aktivan: override.aktivan,
      source: "company",
      sourceLabel: "Specificno konto",
      overrideType: override.override_type,
      napomena: override.napomena
    });
  }

  return combined.sort((a, b) => a.sifra.localeCompare(b.sifra, "sr-Latn"));
}

export function isDefaultAccountPurpose(value: string) {
  return defaultAccountPurposes.some(([purpose]) => purpose === value);
}
