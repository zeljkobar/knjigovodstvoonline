"use client";
import { useState } from "react";
import { fiscalAccessGroups, defaultFiscalAccessGroups } from "@/lib/platform-fiscal-access-policy";
type Candidate = {
    id: string;
    username: string;
    email: string | null;
    version: string;
};
export function FiscalAccessFields({ permissions }: {
    permissions?: string[];
}) {
    return <fieldset className="fiscal-access-fields"><legend>Fiskalna prava (uređuje samo admin platforme)</legend><p>Pregled fiskalnih računa, artikala i kupaca je uključen. Ova prava ne mijenjaju knjigovodstvene preglede.</p>{fiscalAccessGroups.map(group => <label className="api-checkbox" key={group.id}><input type="checkbox" name="grupe" value={group.id} defaultChecked={permissions ? group.keys.every(key => permissions.includes(key)) : defaultFiscalAccessGroups.includes(group.id)}/><span>{group.label}</span></label>)}</fieldset>;
}
export function ExistingFiscalAccessForm({ firmaId, candidates, action }: {
    firmaId: string;
    candidates: Candidate[];
    action: (form: FormData) => Promise<void>;
}) {
    const [userId, setUserId] = useState("");
    const selected = candidates.find(user => user.id === userId);
    return <form action={action} className="admin-form"><input type="hidden" name="firma_id" value={firmaId}/><input type="hidden" name="operation" value="grant"/><input type="hidden" name="version" value={selected?.version ?? "new"}/><label><span>Postojeći klijentski nalog</span><select name="korisnik_id" required value={userId} onChange={event => setUserId(event.target.value)}><option value="">Izaberi korisnika</option>{candidates.map(user => <option key={user.id} value={user.id}>{user.username}{user.email ? ` · ${user.email}` : ""}</option>)}</select></label><FiscalAccessFields /><button className="primary-button" disabled={!selected}>Odobri fiskalni pristup postojećem nalogu</button><p>Lozinka i knjigovodstvena prava ostaju isti. Ne šalje se nova pozivnica.</p></form>;
}
