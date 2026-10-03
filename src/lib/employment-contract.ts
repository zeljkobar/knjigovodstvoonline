import {employmentTemplate} from "./employment-contract-template";
export type EmploymentSnapshot = {broj:string;datum:string;firma:string;pib:string;firmaAdresa:string;direktor:string;radnik:string;jmbg:string;adresa:string;opstina:string;pozicija:string;opis:string;mjestoRada:string;tip:string;pocetak:string;istekTekst:string;neto:string;vrstaVremena:string;dnevno:string;nedjeljno:string;dnevnoTekst:string;nedjeljnoTekst:string};
export function renderEmploymentContract(snapshot:EmploymentSnapshot) {
 const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 return employmentTemplate.replace(/\{\{(\w+)\}\}/g,(_,key:keyof EmploymentSnapshot)=>escape(snapshot[key]??""));
}
