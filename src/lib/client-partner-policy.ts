import { partnerReportAccountPurposes } from "./account-plan";
export const clientPartnerTypes = {
  kupci: { label: "Kupci", kind: "customers", purpose: partnerReportAccountPurposes.customers },
  "ino-kupci": { label: "Ino kupci", kind: "customers", purpose: partnerReportAccountPurposes.foreignCustomers },
  dobavljaci: { label: "Dobavljači", kind: "suppliers", purpose: partnerReportAccountPurposes.suppliers },
  "ino-dobavljaci": { label: "Ino dobavljači", kind: "suppliers", purpose: partnerReportAccountPurposes.foreignSuppliers }
} as const;
export function isClientPartnerType(value: string): value is keyof typeof clientPartnerTypes {
  return Object.hasOwn(clientPartnerTypes, value);
}
