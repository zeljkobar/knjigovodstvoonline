import { Prisma } from "@prisma/client";

export const agencyPartnerFields = [
  "naziv", "pib", "maticni_broj", "pdv_broj", "pravna_forma", "sifra_djelatnosti",
  "datum_registracije", "is_foreign", "country_code", "country_name", "foreign_tax_number",
  "adresa", "grad", "drzava", "telefon", "email", "web_sajt"
] as const;
const editable = new Set<string>(agencyPartnerFields);
const models = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]));
type Shape = Record<string, unknown>;
function object(value: unknown): value is Shape {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}
function relation(model: string, key: string) {
  return models.get(model)?.fields.find(field => field.name === key && field.kind === "object");
}

// Only the supplied agency participates in effective-field matching. Other
// agencies' overrides cannot influence results, counts or relation filters.
export function agencyPartnerWhere(model: string, where: unknown, agencyId: string): unknown {
  if (Array.isArray(where)) return where.map(value => agencyPartnerWhere(model, value, agencyId));
  if (!object(where)) return where;
  const result: Shape = {};
  const effective: unknown[] = [];
  for (const [key, value] of Object.entries(where)) {
    if (["AND", "OR", "NOT"].includes(key)) {
      result[key] = agencyPartnerWhere(model, value, agencyId);
    } else if (model === "Komitent" && editable.has(key)) {
      effective.push({ OR: [
        { agencijske_izmjene: { some: { agencija_id: agencyId, [key]: value } } },
        { AND: [{ agencijske_izmjene: { none: { agencija_id: agencyId } } }, { [key]: value }] }
      ] });
    } else {
      const field = relation(model, key);
      if (field && object(value)) {
        const operators = ["some", "every", "none", "is", "isNot"];
        result[key] = Object.keys(value).some(part => operators.includes(part))
          ? Object.fromEntries(Object.entries(value).map(([part, filter]) =>
              [part, agencyPartnerWhere(field.type, filter, agencyId)]))
          : agencyPartnerWhere(field.type, value, agencyId);
      } else result[key] = value;
    }
  }
  if (effective.length) result.AND = [...(result.AND ? (Array.isArray(result.AND) ? result.AND : [result.AND]) : []), ...effective];
  return result;
}

export function selectsPartners(model: string, args: Shape): boolean {
  if (model === "Komitent") return true;
  const selection = args.select ?? args.include;
  if (!object(selection)) return false;
  return Object.entries(selection).some(([key, value]) => {
    const field = relation(model, key);
    return field && value && (field.type === "Komitent" || (object(value) && selectsPartners(field.type, value)));
  });
}

export function filtersPartners(model: string, where: unknown): boolean {
  if (Array.isArray(where)) return where.some(filter => filtersPartners(model, filter));
  if (!object(where)) return false;
  if (model === "Komitent") return true;
  return Object.entries(where).some(([key, value]) => {
    if (["AND", "OR", "NOT"].includes(key)) return filtersPartners(model, value);
    const field = relation(model, key);
    if (!field || !object(value)) return false;
    if (field.type === "Komitent") return true;
    return filtersPartners(field.type, value) || Object.values(value).some(filter => filtersPartners(field.type, filter));
  });
}

// Add a scoped relation to the same Prisma read (including transaction reads).
// IDs, ownership, status and business snapshots are never rewritten.
export function agencyPartnerSelection(model: string, args: Shape, agencyId: string): Shape {
  const result = { ...args };
  for (const selectionKey of ["select", "include"]) {
    const selection = result[selectionKey];
    if (!object(selection)) continue;
    const next = { ...selection };
    for (const [key, value] of Object.entries(next)) {
      const field = relation(model, key);
      if (!field || !value || key === "agencijske_izmjene") continue;
      const child = value === true ? {} : value;
      if (object(child) && selectsPartners(field.type, child)) {
        next[key] = agencyPartnerSelection(field.type, child, agencyId);
      }
    }
    result[selectionKey] = next;
  }
  if (model === "Komitent") {
    const key = object(result.select) ? "select" : "include";
    const selection = object(result[key]) ? result[key] : {};
    result[key] = { ...selection, agencijske_izmjene: {
      where: { agencija_id: agencyId }, take: 1,
      select: { ...Object.fromEntries(agencyPartnerFields.map(field => [field, true])), verzija: true }
    } };
  }
  return result;
}

export function projectAgencyPartners(model: string, data: unknown, original: Shape): unknown {
  if (Array.isArray(data)) return data.map(row => projectAgencyPartners(model, row, original));
  if (!object(data)) return data;
  const result = { ...data };
  const selection = original.select ?? original.include;
  if (object(selection)) {
    for (const [key, value] of Object.entries(selection)) {
      const field = relation(model, key);
      if (field && value && key !== "agencijske_izmjene") {
        result[key] = projectAgencyPartners(field.type, data[key], object(value) ? value : {});
      }
    }
  }
  if (model === "Komitent") {
    const override = Array.isArray(data.agencijske_izmjene) ? data.agencijske_izmjene[0] : null;
    if (object(override)) {
      for (const key of agencyPartnerFields) {
        if (Object.hasOwn(result, key)) result[key] = override[key];
      }
    }
    // Internal relation is not exposed unless explicitly selected by the caller.
    if (!object(selection) || !selection.agencijske_izmjene) delete result.agencijske_izmjene;
  }
  return result;
}
