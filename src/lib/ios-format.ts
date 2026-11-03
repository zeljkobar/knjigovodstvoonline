export const iosMoney = (cents: number) => (cents / 100).toLocaleString("sr-Latn-ME", {minimumFractionDigits:2,maximumFractionDigits:2});
export const iosDate = (value: string | null) => value ? new Date(`${value}T00:00:00Z`).toLocaleDateString("sr-Latn-ME",{timeZone:"UTC"}) : "—";
