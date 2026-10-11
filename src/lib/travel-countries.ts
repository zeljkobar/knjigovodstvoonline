import countries from "./travel-countries.json";
import { TravelError, type TravelSettings } from "./travel-orders";
// Public regulatory appendix: 133 named destinations + other places; domestic rate is firm-configured.
// Official consolidated text through Sl. list CG 7/2026, published by Parliament 2026-03-05.
export const travelCountries = countries;
export const travelCountrySource = "https://api.skupstina.me/media/files/1773062039-klasifikavioni-broj-00-41-25-98.pdf";
export function travelCountry(code: string) {
 const row = countries.find(c=>c.kod===code);
 if(!row) throw new TravelError("Izaberite državu.");
 return row;
}
export function countryDaily(code: string, settings: TravelSettings) {
 const row=travelCountry(code);
 return settings.dnevniceDrzava?.[code] ?? row.dnevnica ?? settings.dnevnica;
}
