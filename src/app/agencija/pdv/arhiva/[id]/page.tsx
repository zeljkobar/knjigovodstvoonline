import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePdvContext } from "@/lib/pdv-service";
import { money } from "@/lib/pdv";
export default async function PdvVersion({params}:{params:Promise<{id:string}>}) {
 const context=await requirePdvContext("view"),{id}=await params;
 const version=await prisma.pdvVerzija.findFirst({where:{id,pdv_period:{agencija_id:context.agencijaId,firma_id:context.firma.id,poslovna_godina_id:context.poslovnaGodina.id}},include:{pdv_period:true}});
 if(!version)notFound();
 const snapshot=version.snapshot as {prijava:{stavke:Array<{sifra:string;opis:string;kolona:string;sistemska_vrijednost:string;rucna_vrijednost:string|null;razlog_korekcije:string|null}>}};
 return <div className="admin-stack"><header><h1>PDV — verzija {version.broj}</h1><p>{context.firma.naziv} · {version.pdv_period.mjesec}/{context.poslovnaGodina.godina}</p><p>Sačuvano {version.created_at.toLocaleString("sr-Latn")} · {version.korisnik_ime}</p></header><section className="admin-panel"><p>Sačuvano stanje pri zaključavanju. Ova verzija se ne mijenja nakon otključavanja.</p><Link className="secondary-button" href={`/api/pdv/xml?verzija=${version.id}&mjesec=${version.pdv_period.mjesec}`}>XML ove verzije</Link><table className="admin-table"><thead><tr><th>Red</th><th>Opis</th><th>Kolona</th><th>Iznos</th><th>Razlog korekcije</th></tr></thead><tbody>{snapshot.prijava.stavke.map(r=><tr key={`${r.sifra}-${r.kolona}`}><td>{r.sifra}</td><td>{r.opis}</td><td>{r.kolona}</td><td>{money(Number(r.rucna_vrijednost??r.sistemska_vrijednost))}</td><td>{r.razlog_korekcije??"—"}</td></tr>)}</tbody></table></section></div>;
}
