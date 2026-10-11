import type { SelectHTMLAttributes } from "react";
import { travelCountries } from "@/lib/travel-countries";
export default function CountrySelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
 return <select required {...props}><option value="" disabled>Izaberite državu</option>{[...travelCountries].sort((a,b)=>a.naziv.localeCompare(b.naziv,"sr-Latn")).map(c=><option key={c.kod} value={c.kod}>{c.naziv}</option>)}</select>;
}
