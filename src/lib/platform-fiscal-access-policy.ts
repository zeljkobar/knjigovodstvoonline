export const fiscalAccessGroups = [
    {id:"mail_fakture",label:"Slanje potvrđenih faktura mejlom",keys:["fiskalna_dostava:create"]},
    {id:"mail_izvjestaji",label:"Slanje fiskalnih izvještaja mejlom",keys:["izvjestaji_dostava:create","izvjestaji:view","izvjestaji:export"]},
    {id:"kontakti",label:"Uređivanje adresara za dostavu",keys:["fiskalni_kontakti:manage"]},
    { id: "fakture", label: "Kreiranje i izmjena faktura, artikala i kupaca", keys: ["fiskalizacija:create", "robno:create", "robno:update", "robno:manage"] },
    { id: "slanje", label: "Fiskalizacija faktura", keys: ["fiskalizacija:post"] },
    { id: "pos", label: "Izdavanje i fiskalizacija POS računa", keys: ["pos:create", "pos:manage"] },
    { id: "storno", label: "Storno računa", keys: ["fiskalizacija:cancel", "robno:cancel", "pos:cancel"] },
    { id: "izvjestaji", label: "Pregled fiskalnih izvještaja", keys: ["izvjestaji:view"] },
    { id: "izvoz", label: "Izvoz fiskalnih izvještaja i POS štampa", keys: ["izvjestaji:view", "izvjestaji:export", "pos:export"] }
] as const;
export const defaultFiscalAccessGroups = ["fakture", "slanje", "izvjestaji", "izvoz"];
export function platformFiscalPermissions(groups: string[]) {
    return [...new Set(["fiskalizacija:view", "robno:view", "pos:view", ...fiscalAccessGroups.filter(group => groups.includes(group.id)).flatMap(group => [...group.keys])])].sort();
}
