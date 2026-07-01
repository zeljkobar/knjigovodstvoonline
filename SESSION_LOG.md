# SESSION_LOG.md — bilješke poslije većih sesija

> Kratke bilješke (datum + šta je urađeno) poslije svake veće sesije. Najnovije
> gore. Detaljno stanje je u [`CURRENT_STATE.md`](CURRENT_STATE.md).

## 2026-07-01
- Ekran izvoda sada ima odvojen detalj režim: kad se otvori izvod, sakrivaju se
  uvoz i veliki spisak, tabovi `Stavke izvoda` / `Predlog naloga` su odmah na
  vrhu sadržaja, a dodato je dugme `Povrat na spisak izvoda`.
- Knjiženje izvoda sada koristi broj izvoda kao broj naloga na vrsti naloga
  podešenoj za bankovni račun. Ako broj izvoda nije numerički ili je taj broj
  već zauzet na istoj vrsti naloga, knjiženje staje sa jasnom porukom.
- Uklonjeno direktno brisanje sa detalja naloga; za proknjižen nalog ostaje samo
  `Vrati u nacrt`. U pregledu nacrta dodate su brze akcije `Proknjiži` i
  `Izbriši`; brisanje nacrta je fizičko i oslobađa broj naloga, uz audit zapis.

## 2026-06-30
- Na pregledima KIF/KUF dodato brisanje cijele knjige. Backend ga dozvoljava
  samo za otvorenu, rasknjiženu knjigu bez povezanog naloga i bez proknjiženih
  stavki; brisanje je fizičko da se oslobodi redni broj, a audit log bilježi
  obrisanu knjigu.
- Brisanje neproknjiženih KIF/KUF računa prebačeno je sa soft-delete na fizičko
  brisanje pod istim pravilima, da se oslobode redni brojevi.
- Ispravljeno čuvanje predloga naloga izvoda: dropdown sada šalje šifru konta,
  a backend je pretvara u `firma_konta` link. Time se uklanja FK greška kada je
  izabran konto iz globalnog kontnog plana.
- Konto banke pri importu izvoda takođe se bira preko šifre i backend ga
  automatski povezuje na firmu.
- Predlog/knjiženje naloga izvoda ostaje po dogovoru: banka ide zbirno kroz
  ukupan priliv/odliv, a pojedinačne stavke izvoda knjiže se samo na kontra
  konta.
- Implementirane podstranice menija Izvodi umjesto placeholdera: obrada stavki,
  parseri banaka, pravila knjiženja kao kandidati, žiro računi komitenata,
  kartica banke i kontrole.
- Uvoz izvoda proširen na izbor više XML fajlova odjednom. Svaki validan fajl
  pravi poseban izvod, duplikati se preskaču po postojećem ključu
  firma/godina/bankovni račun/broj izvoda, a ručna polja zaglavlja se koriste
  samo kod jednog fajla ili paste teksta.
- Stilizovan izbor fajlova na uvozu izvoda (`Izaberi izvode`) i dodato dugme
  `Proknjiži spremne`, koje knjiži sve `READY` izvode bez ručnog čekiranja.
- KIF SEP/MAPR import više ne traži jedan isti konto prihoda po računu; prihvata
  različite fiksne prihode po PDV stopama iz KIF šeme i knjiženje ostavlja
  postojećoj šemi po poljima.

## 2026-06-29
- Implementirana prva MVP osnova modula Izvodi: migracija
  `20260629190000_bank_statements_mvp`, modeli `bank_statements`,
  `bank_statement_lines`, `partner_bank_accounts`, stranica `/agencija/izvodi`
  sa uvozom/paste tekstom, gornjim pregledom izvoda, tabovima `Stavke izvoda` i
  `Predlog naloga`, ručnim podešavanjem konta/partnera i knjiženjem selektovanih
  `READY` izvoda u posebne proknjižene `IZV` naloge.
- Dodat prvi konkretni parser izvoda: NLB XML iz `zadaci/nlb izvodi xml`, sa
  UTF-16 dekodiranjem, čitanjem broja izvoda, datuma, početnog/krajnjeg stanja i
  stavki po `benefit` debit/credit.
- Pročitana finalna specifikacija `zadaci/07_Izvodi_i_Automatsko_Knjizenje_FINAL.md`
  i dokumentacija preusmjerena: modul izvoda ide kao import/preview/povezivanje
  i knjiženje, ne kao paralelni ručni unos koji duplira nalog `IZV`.
- U podmeni Nalozi dodata stranica Kupci / dobavljači: zbirno prikazuje
  otvoreni saldo po partneru za izabrani konto sa obaveznom partner analitikom,
  sa linkom na postojeću analitičku karticu za partnera.
- Na ručnom nalogu i izmjeni nacrta dodat izbor otvorenih stavki: dupli klik na
  “Broj dok.” za izabrani konto/partner otvara modal proknjiženih otvorenih
  faktura i popunjava broj dokumenta, datume i dugovnu/potražnu stranu.
- Na kontnom planu firme dodata vidljiva pretraga direktno iznad kombinovane
  tabele, sa filtriranjem po šifri ili nazivu konta i linkom za čišćenje filtera.
- Na podešavanjima računa dodat uvoz KIF/KUF podešavanja iz druge firme iste
  agencije: vrste knjiga, šeme kontiranja po poljima i šema za uvoz.
- PDV XML izvoz prebačen sa internog snapshot-a na format `PR_PDV_2025` iz
  `zadaci/pdv izvoz.xml`; download fajl se naziva `pdv <firma> <mm>-<godina>.xml`.

## 2026-06-28
- Dodata prva implementacija PDV modula: mjesečni periodi, ulazni/izlazni PDV
  pregledi iz KIF/KUF po datumu knjige, PDV prijava po redovima obrasca,
  ručne korekcije, XML snapshot, podešavanja knjiženja i osnovno zbirno
  knjiženje prijave u nalog.
- PDV prijava prebačena na izgled nalik portalu: lijevo/desno kolone za
  izlazni/ulazni PDV, bez polja razloga korekcije, sa automatskim preračunom
  PDV-a po stopama i zbirnih redova 24-29.
- PDV podešavanja prebačena na šemu knjiženja kao KIF/KUF: za svaku PDV stavku
  bira se smjer D/P i konto.
- PDV šema knjiženja proširena na pravila po aktivnim PDV stopama iz baze:
  izlazni/ulazni PDV po stopama, carinski PDV, paušalni PDV, PDV obaveza i PDV
  kredit; knjiženje koristi KIF/KUF tax lines za razdvajanje po stopama.
- PDV podešavanja sada u dropdownu konta prikazuju cijeli spojeni kontni plan
  (globalni plan + firmine izmjene); izbor globalnog konta se pri čuvanju
  pretvara u firmi konto link.
- Ispravljeno prelivanje KIF/KUF šema u UI-u podešavanja: redovi šeme se sada
  remount-uju po vrsti knjige, pa KIF, KUF virmani, kartica i gotovina ostaju
  odvojene šeme.
- PDV kontrole proširene: upozoravaju na KIF/KUF stavke koje ulaze u period a
  nisu proknjižene, i porede PDV iz evidencije sa glavnom knjigom po kontima iz
  PDV šeme.
- Brisanje naloga povezanog sa PDV prijavom sada vraća prijavu u nacrt i čisti
  `journal_id`; PDV pregled, prijava i arhiva ignorišu obrisane naloge.
- Dodata migracija `20260628150000_pdv_periodi_prijave_podesavanja` za
  `pdv_periodi`, `pdv_prijave`, `pdv_prijava_stavke` i `pdv_podesavanja`.
- Dodata migracija `20260628162000_pdv_podesavanja_smjer` za smjerove D/P u
  podešavanjima PDV knjiženja.
- Dodata migracija `20260628170000_pdv_podesavanja_pravila` za tabelu pravila
  knjiženja PDV prijave.
- Dodat Excel export KIF/KUF pregleda preko `/api/racuni/export/kif` i
  `/api/racuni/export/kuf`, sa backend provjerom `export` prava, aktivnog
  konteksta firme/godine i istim datumskim filterima kao print.
- Uvedena konfigurabilna šema za uvoz (KUF): 5 konta, smjer D/P i partner po
  stavci; carina kao zasebna stavka troška, carinska obaveza na partnera „CARINA”.
- Pretraga partnera prebačena na async (`/api/partners/search`) na stranicama
  naloga (`nalozi/novi`, `nalozi/[id]`) i u filteru analitičkih kartica — više se
  ne učitava svih ~64k partnera. Nove komponente: `JournalPartnerCell`,
  `PartnerFilterSelect`.
- Dodata migracija `20260628120000_komitent_pretraga_indeksi`: `pg_trgm` GIN
  indeks na `komitenti.naziv` + btree na `pib` i `scope`.
- Uspostavljena dokumentaciona struktura: `AGENTS.md`, `CURRENT_STATE.md`,
  `NEXT_STEPS.md`, `SESSION_LOG.md`, `docs/` (sažeci iz `zadaci/`). Dokumenti
  obogaćeni korisnim spec sadržajem iz starog handoff foldera (PDV modul,
  `vat_transaction_type`, izvodi, kontrole bruto bilansa).
- Planer prebačen na tekstualni izvor: `zadaci/planer/*.csv` + `manifest.json`
  su source of truth, Excel se regeneriše skriptom `scripts/planer.mjs`
  (`npm run planer:dump` / `planer:build`). Dodat list `Status 2026-06-28`.

## 2026-06-25
- Handoff stanje zabilježeno (vidi raniji `zadaci/project_status.md`): Moduli
  1, 2, 3 i 6 core funkcionalni; robno, izvodi, plate, PDV prijava i klijentski
  portal nisu implementirani.
