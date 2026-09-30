import { fixedAssetCentsMoney as money } from "@/lib/fixed-assets";
import { type TaxSnapshot } from "@/lib/fixed-assets-tax-data";
import { type TaxRow } from "@/lib/fixed-assets-tax";
import { taxGroupsSource } from "@/lib/fixed-assets-tax-groups";
export function TaxReport({ snapshot, confirmed, revision }: { snapshot: TaxSnapshot; confirmed: boolean; revision: number }) {
  const { result }=snapshot;
  function table(title: string, rows: TaxRow[], kind: "I"|"POOL"|"SPECIAL") {
    const keys: (keyof TaxRow)[] = kind === "POOL" ? ["opening","purchases","sales","basis","current","closing"] : ["opening","purchases","sales","basis","current","previous","total","closing"];
    const number=(r:TaxRow,k:keyof TaxRow)=>Number(r[k])+(kind==="POOL"&&k==="current"?r.extraWriteOff:0);
    return <section style={{marginBottom:24}}><h3>{title}</h3><div className="table-wrap"><table><thead><tr><th>Sredstvo / grupa</th><th>Početni saldo</th><th>Kupovina sredstava koja se stavljaju u upotrebu</th><th>Prodaja sredstava tokom godine</th><th>Neotpisana vrijednost (2+3−4)</th>{kind!=="SPECIAL"?<th>Stopa %</th>:null}<th>{kind==="POOL"?"Amortizacija":"Amortizacija tekuće godine"}</th>{kind!=="POOL"?<><th>Amortizacija prethodnih godina</th><th>Ukupna amortizacija</th></>:null}<th>Neotpisana vrijednost na kraju godine</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.key}><td>{r.name}</td>{keys.map(k=><FragmentCell key={k} value={money(number(r,k))} rate={k==="basis"&&kind!=="SPECIAL"?r.rate:undefined}/>)}</tr>)}
      <tr><th>UKUPNO</th>{keys.map(k=><FragmentCell key={k} value={money(rows.reduce((sum,r)=>sum+number(r,k),0))} rate={k==="basis"&&kind!=="SPECIAL"?"—":undefined}/>)}</tr>
    </tbody></table></div></section>;
  }
  return <article className="tax-report"><p>Obrazac OA · {confirmed?"Potvrđen obračun":"NACRT – nije potvrđen"} · Revizija {revision}</p><h2>OBRAČUN AMORTIZACIJE OSNOVNIH SREDSTAVA</h2><p>Period: {snapshot.from.split("-").reverse().join(".")}. – {snapshot.to.split("-").reverse().join(".")}.<br/>Poreski obveznik: {snapshot.company} · PIB: {snapshot.pib||"—"}</p>
    {result.errors.length?<div role="alert"><strong>Nepotpun obračun – potvrda nije dozvoljena</strong><ul>{result.errors.map(e=><li key={e}>{e}</li>)}</ul></div>:null}
    {table("a) I grupa – pojedinačna sredstva",result.rows.filter(r=>r.group==="I"),"I")}
    {table("b) Grupe II–V",result.rows.filter(r=>["II","III","IV","V"].includes(r.group)),"POOL")}
    {table("c) MRS 38 – nematerijalna imovina i MSFI 16 – lizing",result.rows.filter(r=>r.group==="POSEBNO"),"SPECIAL")}
    <p><strong>Ukupno (a+b+c): {money(result.total+result.extraWriteOff)} EUR</strong></p>
    <p>Redovna amortizacija: {money(result.total)} EUR · Poseban otpis salda grupa: {money(result.extraWriteOff)} EUR · Prihod od viška prodaje nad saldom: {money(result.taxableIncome)} EUR.</p>
    {result.rows.some(r=>r.extraWriteOff||r.taxableIncome)?<div><h3>Prilog: usklađenje salda grupa</h3>{result.rows.filter(r=>r.extraWriteOff||r.taxableIncome).map(r=><p key={r.key}>{r.name}: redovna amortizacija {money(r.current)}; poseban otpis {money(r.extraWriteOff)}; prihod {money(r.taxableIncome)}. Poseban otpis uključen je u kolonu amortizacije. Višak prodaje iskazuje se odvojeno kao prihod, uz nulti saldo.</p>)}</div>:null}
    <p>Za I grupu početni saldo predstavlja poresku nabavnu osnovicu prije ranijeg otpisa; ranija amortizacija se oduzima samo jednom. Za grupe II–V početni saldo je neotpisana poreska vrijednost na kraju prethodne godine.</p>
    <p>Kapitalizovane popravke uključene su u kolonu kupovine. Za grupe II–V test 5% primjenjuje se na početni saldo; kada su popravke iznad praga uključuje se cijeli iznos. Za I grupu koristi se nabavna osnovica, a amortizacija je srazmjerna danima korišćenja, bez dana prodaje.</p>
    {snapshot.input.events.some(e=>e.kind==="SALE" && ["I","POSEBNO"].includes(e.group))?<p>Za pojedinačna sredstva kolona prodaje prikazuje uklonjenu neotpisanu vrijednost poslije tekuće amortizacije. Prodajni iznos ostaje u evidenciji izvornih promjena; eventualni dobitak/gubitak od prodaje nije dio amortizacije.</p>:null}
    <p>Izvor početnih stanja: {snapshot.input.openingSource}</p>
    <details className="tax-input-details"><summary>Izvorni poreski podaci i dokumenti</summary><ul>{snapshot.input.assets.filter(a=>a.source).map(a=><li key={a.id}>{snapshot.assets.find(s=>s.id===a.id)?.name}: {a.source}</li>)}{snapshot.input.events.map(e=><li key={e.id}>{e.date} · {e.group} · {e.kind==="PURCHASE"?"Nabavka":e.kind==="SALE"?"Prodaja":"Popravka / ulaganje"} · {money(e.amount)} EUR · {e.source}</li>)}</ul></details>
    <p><a href={taxGroupsSource} target="_blank" rel="noreferrer">Pravilnik i službeni OA obrazac</a> · Pravila: {result.rules}</p>
    <div style={{display:"flex",justifyContent:"space-around",marginTop:40}}><p>____________________<br/>Šef računovodstva</p><p>____________________<br/>Direktor</p></div>
  </article>;
}
function FragmentCell({value,rate}:{value:string;rate?:string}) { return <><td>{value}</td>{rate!==undefined?<td>{rate}</td>:null}</>; }
