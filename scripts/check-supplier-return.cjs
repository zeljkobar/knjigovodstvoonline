/* eslint-disable @typescript-eslint/no-require-imports -- Transactional DB regression. */
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { sourceLoader, transactionProxy } = require('../tests/helpers/source-loader.cjs');
const db = new PrismaClient();
const rollback = new Error('ROLLBACK');
(async () => {
  try {
    await db.$transaction(async tx => {
      const proxy = transactionProxy(tx);
      const load = sourceLoader({ 'next/headers': { headers: async () => new Map() } });
      const service = load('src/lib/supplier-return-service.ts');
      const agency = await tx.agencija.create({ data: { naziv: 'Supplier return regression' } });
      const firm = await tx.firma.create({ data: { agencija_id: agency.id, naziv: 'Supplier return fixture', pdv_obveznik: true } });
      const year = await tx.poslovnaGodina.create({ data: { firma_id: firm.id, godina: 2026, datum_od: new Date('2026-01-01'), datum_do: new Date('2026-12-31') } });
      const user = await tx.korisnik.create({ data: { agencija_id: agency.id, korisnicko_ime: randomUUID(), lozinka_hash: 'disabled', rola: 'admin_agencije' } });
      await tx.korisnikFirma.create({ data: { korisnik_id: user.id, firma_id: firm.id } });
      const supplier = await tx.komitent.create({ data: { agencija_id: agency.id, firma_id: firm.id, scope: 'COMPANY', naziv: 'Fixture supplier' } });
      const unit = await tx.jedinicaMjere.create({ data: { sifra: randomUUID(), naziv: 'Komad', oznaka: 'kom' } });
      const rate = await tx.pdvStopa.create({ data: { agencija_id: agency.id, sifra: 'S21', naziv: 'Standardna', procenat: '21' } });
      const reduced = await tx.pdvStopa.create({ data: { agencija_id: agency.id, sifra: 'S7', naziv: 'Snižena', procenat: '7' } });
      const warehouse = await tx.magacin.create({ data: { agencija_id: agency.id, firma_id: firm.id, sifra: 'R', naziv: 'Retail', tip_prodaje: 'RETAIL' } });
      const wholesale = await tx.magacin.create({ data: { agencija_id: agency.id, firma_id: firm.id, sifra: 'W', naziv: 'Wholesale', tip_prodaje: 'WHOLESALE' } });
      const bookType = await tx.racunVrsta.create({ data: { agencija_id: agency.id, firma_id: firm.id, sifra: 'T', naziv: 'Fixture KUF', dokument_tip: 'KUF' } });
      const scope = { agencija_id: agency.id, firma_id: firm.id, poslovna_godina_id: year.id };
      const book = await tx.kufBook.create({ data: { ...scope, racun_vrsta_id: bookType.id, redni_broj: 1, internal_kuf_number: 'Fixture KUF', mjesec: 6, kuf_date: new Date('2026-06-30') } });
      const c = { userId: user.id, agencyId: agency.id, companyId: firm.id, yearId: year.id };
      const codes = { RETURN_SUPPLIER: '4300', RETURN_INVENTORY: '1340', RETURN_INPUT_VAT: '2700', RETURN_MARGIN: '1349', RETURN_INCLUDED_VAT: '1348', RETURN_LOSS: '5790', RETURN_GAIN: '6790' };
      for (const field of load('src/lib/supplier-return.ts').supplierReturnFields) {
        await tx.firmaKonto.create({ data: { firma_id: firm.id, sifra: codes[field.purpose], naziv: field.label, tip_konta: 'analiticko', analitika_obavezna: field.purpose === 'RETURN_SUPPLIER' } });
        await tx.firmaPodrazumijevanoKonto.create({ data: { firma_id: firm.id, dokument_tip: 'SUPPLIER_RETURN', podvrsta: 'GENERAL', pdv_stopa_sifra: 'GENERAL', namjena: field.purpose, sifra_konta: codes[field.purpose], smjer: field.direction } });
      }
      let n = 0;
      const atomic = fn => proxy.$transaction(fn);
      async function fixture(w = warehouse, linked = false, vatRate = rate) {
        const num = ++n;
        const item = await tx.artikal.create({ data: { agencija_id: agency.id, firma_id: firm.id, sifra: 'R' + num, naziv: 'Return item', jedinica_mjere_id: unit.id, pdv_stopa_id: vatRate.id } });
        const state = await tx.stanjeZaliha.create({ data: { ...scope, magacin_id: w.id, artikal_id: item.id, kolicina: '10', prosjecna_nabavna_cijena: '10', nabavna_vrijednost: '100', maloprodajna_vrijednost: w.tip_prodaje === 'RETAIL' ? '181.50' : '0', razlika_u_cijeni: w.tip_prodaje === 'RETAIL' ? '50' : '0', ukalkulisani_pdv: w.tip_prodaje === 'RETAIL' ? '31.50' : '0' } });
        let calculation = null, sourceLine = null;
        if (linked) {
          calculation = await tx.kalkulacija.create({ data: { ...scope, magacin_id: w.id, dobavljac_id: supplier.id, broj: num, interni_broj: 'KAL'+num, broj_racuna_dobavljaca: 'INV'+num, datum_kalkulacije: new Date('2026-06-01'), datum_racuna_dobavljaca: new Date('2026-06-01'), status: 'WAITING_KUF' } });
          sourceLine = await tx.stavkaKalkulacije.create({ data: { kalkulacija_id: calculation.id, redni_broj: 1, artikal_id: item.id, kolicina: '2', fakturna_cijena: '8', fakturna_vrijednost: '16', neto_fakturna_cijena: '8', neto_fakturna_vrijednost: '16', nabavna_vrijednost: '20', jedinicna_nabavna_cijena: '10', prodajna_cijena_bez_pdv: '15', prodajna_cijena_sa_pdv: '18.15', prodajna_vrijednost_bez_pdv: '30', prodajna_vrijednost_sa_pdv: '36.30' } });
        }
        const h = { date: new Date('2026-06-15'), warehouseId: w.id, supplierId: supplier.id, calculationId: calculation?.id ?? null, originalKufId: null, bookId: book.id, creditNumber: 'CR'+num, note: null };
        const id = await atomic(t => service.saveReturnHeader(t, c, h));
        const line = { itemId: item.id, quantity: BigInt(2000), creditPrice: BigInt(80000), vatRateId: vatRate.id, calculationLineId: sourceLine?.id ?? null };
        await atomic(t => service.saveReturnLine(t, c, id, line));
        return { id, item, state, h, line, calculation, sourceLine };
      }
      const f = await fixture(warehouse, true);
      await assert.rejects(atomic(t=>service.saveReturnHeader(t,c,f.h)), error=>error.code==='P2002');
      assert.equal(Number((await tx.stanjeZaliha.findUnique({ where: { id: f.state.id } })).kolicina), 10);
      assert.equal(await tx.kufEntry.count({ where: { ...scope, source_type: 'SUPPLIER_RETURN' } }), 0);
      await atomic(t => service.postSupplierReturn(t, c, f.id));
      await atomic(t => service.postSupplierReturn(t, c, f.id));
      const posted = await tx.povratDobavljacu.findUnique({ where: { id: f.id }, include: { nalog: { include: { stavke: true } }, kuf_entry: { include: { tax_lines: true } } } });
      assert.equal(posted.status, 'POSTED'); assert.equal(posted.nalog.status, 'POSTED');
      assert.equal(Number(posted.ukupno_odobrenje), 19.36);
      assert.equal(Number(posted.kuf_entry.total_gross), -19.36);
      assert.equal(Number(posted.kuf_entry.deductible_vat), -3.36);
      assert.equal(posted.kuf_entry.posting_mode, 'SOURCE_DOCUMENT');
      assert.equal(posted.nalog.stavke.reduce((s,l)=>s+Math.round(Number(l.duguje)*100)-Math.round(Number(l.potrazuje)*100),0), 0);
      assert.equal(posted.nalog.stavke.find(l=>l.komitent_id)?.komitent_id, supplier.id);
      const state = await tx.stanjeZaliha.findUnique({ where: { id: f.state.id } });
      assert.equal(Number(state.kolicina), 8); assert.equal(Number(state.nabavna_vrijednost), 80); assert.equal(Number(state.maloprodajna_vrijednost), 145.20);
      assert.equal(await tx.prometZaliha.count({ where: { dokument_id: f.id, tip_dokumenta: 'SUPPLIER_RETURN' } }), 1);
      const {loadPdvBooks}=load('src/lib/pdv-service.ts');
      const books=await loadPdvBooks({agencijaId:agency.id,firmaId:firm.id,poslovnaGodinaId:year.id,godina:2026,mjesec:6},tx);
      assert.equal(load('src/lib/pdv.ts').calculatePdvPostingAmounts(books.kifBooks,books.kufBooks).get('INPUT_VAT_S21'),-3.36);
      await assert.rejects(atomic(t=>service.deleteReturnDraft(t,c,f.id)), /nacrt/);
      // A second linked return cannot exceed the original received quantity.
      const id2 = await atomic(t=>service.saveReturnHeader(t,c,{...f.h,creditNumber:'CR-extra'}));
      await atomic(t=>service.saveReturnLine(t,c,id2,f.line));
      await assert.rejects(atomic(t=>service.postSupplierReturn(t,c,id2)), /prelaze količinu/);
      const wh = await fixture(wholesale, false, reduced);
      await tx.firma.update({where:{id:firm.id},data:{pdv_obveznik:false}});
      await atomic(t=>service.postSupplierReturn(t,c,wh.id));
      const nonVat=await tx.povratDobavljacu.findUnique({where:{id:wh.id},include:{kuf_entry:true}});
      assert.equal(Number(nonVat.kuf_entry.deductible_vat),0); assert.equal(Number(nonVat.kuf_entry.non_deductible_vat),-1.12);
      await tx.firma.update({where:{id:firm.id},data:{pdv_obveznik:true}});
      const fail = await fixture();
      await tx.firmaPodrazumijevanoKonto.updateMany({where:{firma_id:firm.id,namjena:'RETURN_SUPPLIER'},data:{sifra_konta:''}});
      await assert.rejects(atomic(t=>service.postSupplierReturn(t,c,fail.id)),/Podesite konto/);
      assert.equal(Number((await tx.stanjeZaliha.findUnique({where:{id:fail.state.id}})).kolicina),10);
      assert.equal(await tx.prometZaliha.count({where:{dokument_id:fail.id}}),0);
      await tx.firmaPodrazumijevanoKonto.updateMany({where:{firma_id:firm.id,namjena:'RETURN_SUPPLIER'},data:{sifra_konta:'4300'}});
      const period=await tx.pdvPeriod.create({data:{...scope,mjesec:6,datum_od:new Date('2026-06-01'),datum_do:new Date('2026-06-30'),status:'LOCKED'}});
      await assert.rejects(atomic(t=>service.postSupplierReturn(t,c,fail.id)),/PDV period/);
      await assert.rejects(atomic(t=>service.saveReturnLine(t,c,fail.id,fail.line)),/PDV period/);
      await assert.rejects(atomic(t=>service.deleteReturnDraft(t,c,fail.id)),/PDV period/);
      await tx.pdvPeriod.update({where:{id:period.id},data:{status:'OPEN'}});
      await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});
      await assert.rejects(atomic(t=>service.postSupplierReturn(t,c,fail.id)),/godina je zaključana/);
      await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:false}});
      await tx.korisnik.update({where:{id:user.id},data:{rola:'korisnik_agencije'}});
      await assert.rejects(atomic(t=>service.postSupplierReturn(t,c,fail.id)),/prava/);
      await tx.korisnik.update({where:{id:user.id},data:{rola:'admin_agencije'}});
      await assert.rejects(atomic(t=>service.postSupplierReturn(t,{...c,agencyId:randomUUID()},fail.id)),/pristup/);
      await assert.rejects(atomic(t=>service.saveReturnHeader(t,c,{...fail.h,creditNumber:'OTHER',supplierId:randomUUID()})),/Dobavljač/);
      const failLineId=(await tx.stavkaPovrataDobavljacu.findFirst({where:{povrat_dobavljacu_id:fail.id}})).id;
      await atomic(t=>service.saveReturnLine(t,c,fail.id,{...fail.line,quantity:BigInt(11000)},failLineId));
      await assert.rejects(atomic(t=>service.postSupplierReturn(t,c,fail.id)),/Nema dovoljno robe/);
      const lineId=(await tx.stavkaPovrataDobavljacu.findFirst({where:{povrat_dobavljacu_id:fail.id}})).id;
      await atomic(t=>service.saveReturnLine(t,c,fail.id,fail.line,lineId));
      const negative=await fixture();
      const negativeLine=(await tx.stavkaPovrataDobavljacu.findFirst({where:{povrat_dobavljacu_id:negative.id}})).id;
      await atomic(t=>service.saveReturnLine(t,c,negative.id,{...negative.line,quantity:BigInt(11000)},negativeLine));
      await tx.magacin.update({where:{id:warehouse.id},data:{dozvoli_negativan_lager:true}});
      await atomic(t=>service.postSupplierReturn(t,c,negative.id));
      assert.equal(Number((await tx.stanjeZaliha.findUnique({where:{id:negative.state.id}})).kolicina),-1);
      await tx.magacin.update({where:{id:warehouse.id},data:{dozvoli_negativan_lager:null}});
      const discarded=await fixture(warehouse,true);
      await atomic(t=>service.deleteReturnDraft(t,c,discarded.id));
      const deleted=await tx.povratDobavljacu.findUnique({where:{id:discarded.id},include:{stavke:true}});
      assert.equal(deleted.status,'DELETED'); assert.equal(deleted.kuf_book_id,null); assert.equal(deleted.kalkulacija_id,null);
      assert.ok(deleted.stavke.every(l=>l.stavka_kalkulacije_id===null));
      const badAudit = new Proxy(tx,{get(target,key){if(key==='auditLog')return new Proxy(target.auditLog,{get(m,method){if(method==='create')return async()=>{throw new Error('AUDIT_FAILURE')};return m[method];}});return target[key];}});
      await assert.rejects(atomic(()=>service.postSupplierReturn(badAudit,c,fail.id)),/AUDIT_FAILURE/);
      assert.equal(Number((await tx.stanjeZaliha.findUnique({where:{id:fail.state.id}})).kolicina),10);
      assert.equal(await tx.kufEntry.count({where:{source_type:'SUPPLIER_RETURN',source_id:fail.id}}),0);
      // Template-only return settings resolve into the target company's accounts.
      const template=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Return template fixture'}});
      await tx.agencijaKnjizenjeTemplate.create({data:{agencija_id:agency.id,firma_id:template.id}});
      await tx.firmaPodrazumijevanoKonto.updateMany({where:{firma_id:firm.id,dokument_tip:'SUPPLIER_RETURN'},data:{firma_id:template.id}});
      const inherited=await fixture();
      await atomic(t=>service.postSupplierReturn(t,c,inherited.id));
      const inheritedDoc=await tx.povratDobavljacu.findUnique({where:{id:inherited.id},include:{nalog:{include:{stavke:{include:{firma_konto:true}}}}}});
      assert.ok(inheritedDoc.nalog.stavke.every(l=>l.firma_konto.firma_id===firm.id));
      assert.equal(await tx.firmaPodrazumijevanoKonto.count({where:{firma_id:firm.id,dokument_tip:'SUPPLIER_RETURN'}}),0);
      // Actual server actions enforce expected year, and render real detail/print components.
      const React=require('react'); const {renderToStaticMarkup}=require('react-dom/server');
      let work={firmaId:firm.id,poslovnaGodinaId:year.id};
      const uiLoad=sourceLoader({
        '@/lib/prisma':{prisma:proxy}, '@/lib/auth':{requireAnyRole:async()=>user},
        '@/lib/work-context':{readWorkContext:async()=>work},
        'next/navigation':{redirect:url=>{throw new Error('REDIRECT:'+url)},notFound:()=>{throw new Error('NOT_FOUND')}},
        'next/cache':{revalidatePath(){}},
        'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},
        '@/components/PartnerSearchInput':{PartnerSearchInput:()=>React.createElement('input',{name:'dobavljac_id'})}
      });
      const page=uiLoad('src/app/agencija/robno/povrat-dobavljacu/[id]/page.tsx').default;
      const print=uiLoad('src/app/stampa/robno/povrat-dobavljacu/[id]/page.tsx').default;
      const html=renderToStaticMarkup(await page({params:Promise.resolve({id:f.id}),searchParams:Promise.resolve({})}));
      assert.match(html,/19,36/); assert.match(html,/Negativan KUF zapis/); assert.doesNotMatch(html,/Proknjiži povrat/);
      const printed=renderToStaticMarkup(await print({params:Promise.resolve({id:f.id})}));
      assert.match(printed,/POVRAT DOBAVLJAČU/); assert.match(printed,/CR1/);
      const form=new FormData();
      for(const [k,v] of Object.entries({firma_id:firm.id,godina_id:year.id,povrat_id:fail.id,potvrda:'on'}))form.set(k,v);
      const actions=uiLoad('src/app/agencija/robno/povrat-dobavljacu/actions.ts');
      work={...work,poslovnaGodinaId:randomUUID()};
      await assert.rejects(actions.postSupplierReturnAction(form),/REDIRECT:.*greska=/);
      work={firmaId:firm.id,poslovnaGodinaId:year.id};
      await assert.rejects(actions.postSupplierReturnAction(form),/REDIRECT:.*poruka=/);
      assert.equal((await tx.povratDobavljacu.findUnique({where:{id:fail.id}})).status,'POSTED');
      // Real company purge removes return children before source documents and KUF.
      const {purgeCompanyData}=load('src/lib/company-purge.ts');
      await atomic(t=>purgeCompanyData(t,{agencijaId:agency.id,firmaId:firm.id,potvrdaNaziva:firm.naziv,korisnikId:user.id}));
      assert.equal(await tx.povratDobavljacu.count({where:{firma_id:firm.id}}),0);
      assert.equal(await tx.stavkaPovrataDobavljacu.count({where:{povrat_dobavljacu_id:f.id}}),0);
      throw rollback;
    }, { isolationLevel: 'Serializable', timeout: 60000 });
  } catch (e) { if (e !== rollback) throw e; }
  console.log('PASS supplier returns: draft, MP/VP, VAT/non-VAT, KUF/GL/stock balance, idempotence, source quantity, permissions/scope/locks, failure rollback and actual company purge; fixtures rolled back.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
