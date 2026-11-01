-- Static snapshot of 27 positions and full descriptions from
-- https://summasummarum.me/pozicije.html (2026-11-01), including the five
-- account-specific positions explicitly requested as global by the owner.
-- No remote access or credentials are needed when deploying this migration.
-- Match only global base rows by trimmed/case-insensitive name. Keep their
-- IDs, references, names and activation choices; agency jobs/overrides and
-- saved employment-contract snapshots remain untouched. Existing Knjigovođa
-- is not part of this import and is retained. Repeated SQL is a no-op.
BEGIN;
LOCK TABLE radna_mjesta IN SHARE ROW EXCLUSIVE MODE;

WITH source(naziv, opis_poslova) AS (
 VALUES
  ('Administrativni radnik', '-Ažuriranje dokumentacije
-Rukovanje korporativnom korespondencijom, e-mailom i telefonskim pozivima. 
-Evidentiranje ulazne i izlazne dokumentacije.
-Odgovornost za nabavku kancelarijske opreme i drugih dobara koji se troše na dnevnoj bazi.
-Vodi brigu o higjeni radnog prostora'),
  ('Čistač i pomoćno osoblje', '-svakodnevno održavanje higijene i čišćenje objekata, 
-stara se o blagovremenoj porudžbi potrebnih sredstava za higijenu
-obavlja i druge poslove vezane za konkretno obavljanje poslova radnog mijesta'),
  ('Frizer', '- Šišanje, oblikovanje, feniranje i stilizovanje kose prema željama klijenata i pravilima struke.
- Bojenje, pramenovanje, toniranje i tretiranje kose odgovarajućim profesionalnim preparatima.
- Savetovanje klijenata o održavanju kose i predlaganje odgovarajućih frizura i tretmana.
- Održavanje higijene i urednosti radnog mesta, alata i opreme u skladu sa propisanim standardima.
-Praćenje trendova u frizerskoj industriji i kontinuirano usavršavanje kroz obuke i edukacije.'),
  ('Građevinski inženjer', '- Organizacija i vođenje građevinskih radova na terenu.
- Upravljanje resursima (radna snaga, materijali, oprema
- Rešavanje tehničkih problema tokom izvođenja radova
- Koordinacija sa podizvođačima i dobavljačia. 
- Obezbeđivanje poštovanja propisa o bezbednosti na radu.'),
  ('Higjeničar/ka', '-čišćenje radnih prostora
-sanitarni čvorovi
-rukovanje sredstvima za čišćenje
-odnošenje smeća
-izvještavanje'),
  ('Izvodjac osnovnih gradjevinskih radova', 'Izvođenje osnovnih građevinskih radova na objektima.
Priprema terena i prostora za izvođenje radova.
Zidarski, betonski i pomoćni građevinski poslovi.
Sanacija, adaptacija i popravka građevinskih objekata.
Obavljanje ostalih osnovnih građevinskih radova po nalogu poslodavca.'),
  ('Izvrsni direktor', '-	Organizuje, uskladjuje, rukovodi procesom rada I poslovanjem Društva,
-	rasporedjuje radnike u skladu sa propisima, stara se o zaštiti na radu, 
-	podnosi izvještaje o rezultatima poslovanja, po godišnjem obračunu, 
-	potpisuje finansiska dokumenta, 
-	vrši I druge poslove.'),
  ('Komercijalista', 'Istražuje tržište, pronalazi nove kupce i poslovne prilike, prati konkurenciju i predlaže aktivnosti za širenje prodajne mreže.'),
  ('Konobar', '-poslužuju hranu i piće u ugostiteljskim objektima. 
- Pošto od gostiju prime narudžbe, prenose ih osoblju u kuhinji ili na šanku i vode računa o tome da goste što brže i što kvalitetnije ugoste.
-postavljanje stolova i njihovo pospremanje nakon upotrebe
-ispostavljanje računa i naplata usluga.'),
  ('Moler', '- priprema povrsina
- priprema materijala
- zastita prostora
- nanošenje boje
- zavrsni radovi'),
  ('Noćni čuvar', '- obilazak i nadgledanje prostora
- praćenje sigurnosnih kamera
- kontrola pristupa
- odgovor na alarme
- komunikacija sa nadležnim tijelima'),
  ('Novinar', '- Istrazivanje I prikupljanje informacija
- Pisanje I uređivanje članaka
- Praćenje aktuelnih događaja
- Saradnja sa uredništvom i timom
- Poštovanje etičkih i profesionalnih standarda'),
  ('Pica majstor', '- Priprema sastojaka
- Priprema i pečenje pizza
- Održavanje kvaliteta i standarda
- Komunikacija i saradnja
- Održavanje čistoće i organizacije'),
  ('Pomoćni radnik na otpadu', '- prikupljanje i sortiranje otpada
- utovar i istovar
- odvajanje opasnog otpada
- održavanje čistoće i reda
- pomoć pri reciklaži'),
  ('Pomoćni radnik u kuhinji', '-Prijem i skladištenje robe
-Prijem porudžbina
-Priprema primljenih porudžbina po unapred utvrđenim standardima
-Odlaganje prljavog posuđa, pranje posuđa
-Razvrstavanje opranog posuđa i pribora, slaganje na predviđeno mesto'),
  ('Pomoćni radnik u proizvodnji', '- proizvodnja i obrada
- montaza
- kontrola kvaliteta
- odrzavanje opreme
- pakovanje i skladistenje'),
  ('Poslovođa', '- organizacija i nadzor rada osoblja
- planiranje i vodjenje smijena
- obuka i motivacija zaposlenih
- kontrola kvaliteta hrane/pića i higijenskih standarda
- upravljanje zalihama i poručivanje robe'),
  ('Prodavac', '- ulsuživanje kupaca
- prodaja i promotivne aktivnosti
- održavanje prodajnog prostora
- kontrola zaliha
- blagajnički poslovi'),
  ('Radnik u servisu', '- Varenje
- ispravljanje limarije
- montaza I demontaza limarije
- priprema I farbanje automobila'),
  ('Recepcioner', '- Docek i usmjeravanje gostiju
- telefonska i e-mail komunikacija
- vodjenje evidencije i administrativni poslovi
- odrzavanje urednosi recepcije
- Saradnja sa ostalim odjeljenjima'),
  ('Rudarski inženjer', '- Istraživanje mineralnih resursa
- planiranje i dizajn kamonoloma
- eksplotacija i prerada mineralnih resursa
- sigurnost i zaštita na radu
- administracija i menadzment'),
  ('Rukovalac građevinskih masina', 'Upravljanje mašinama: Rukovalac upravlja različitim građevinskim mašinama kao što su bageri, buldožeri, utovarivači, rovokopači, valjci, kranovi i druge specijalizovane mašine.
Održavanje mašina: Redovno pregledanje, čišćenje i osnovno održavanje mašina kako bi se osiguralo da su u ispravnom stanju za rad. To uključuje proveru ulja, goriva, rashladne tečnosti i drugih važnih komponenti.'),
  ('Sanker', '-Pružanje profesionalne i kvalitetne usluge gostima, a po instrukcijama menadžera restorana.
-Pripremanje i izdavanje pića, pravljenje koktela, dekoracije.
-Održavanje higijene radnog prostora
-Blagovremeno pisanje trebovanja robe
-Po zahtjevu menadžera učestvovanje u mjesečnim popisima pića i opreme.'),
  ('Trener', 'Izrada individualnih planova treninga prema ciljevima klijenata (masa, definicija, snaga, rehabilitacija).Demonstracija pravilnog izvođenja vježbi i nadzor tehnike radi sprječavanja povreda. Praćenje napretka klijenata kroz redovne procjene, mjerenja i prilagođavanje programa. Savjetovanje o ishrani i suplementaciji u skladu sa bodi bilding principima. Održavanje discipline, motivacije i sigurnosti u teretani, uključujući pripremu i održavanje opreme.'),
  ('Turistički vodič', '-vodjenje turisticke grupe
-objasnjavanje istorijskih cinjenica
-vodi racuna o bezbjednosti grupe
-setnja zadatim destinacijama
-prevodi'),
  ('Upravitelj čamca', 'Upravljanje čamcem u skladu sa propisima i pravilima plovidbe.  Navigacija i održavanje kursa čamca tokom vožnje po jezeru. Prijem i iskrcavanje putnika uz obavezne mere bezbednosti. 
Informisanje putnika o pravilima ponašanja na čamcu i o toku vožnje. Redovna provera ispravnosti motora, kormila, prsluka za spasavanje i ostale opreme. 
Pranje i čišćenje čamca nakon završetka radnog dana. 
Prijavljivanje kvarova i nepravilnosti. Poštovanje svih važećih zakona i propisa vezanih za javni prevoz na vodi. Poznavanje I sprovođenje propisa o zaštiti životne sredine'),
  ('Vozač', '- održava vozilo
- vodi računa da uvijek ima goriva
- pristojan prijem putnika
- brine o higjeni vozila
- da je na raspolaganju po potrebi agencije')
), before_rows AS MATERIALIZED (
 SELECT r.* FROM radna_mjesta r
 JOIN source s ON lower(btrim(r.naziv)) = lower(btrim(s.naziv))
 WHERE r.agencija_id IS NULL AND r.globalno_id IS NULL
), updated AS (
 UPDATE radna_mjesta r
 SET opis_poslova = s.opis_poslova, updated_at = CURRENT_TIMESTAMP
 FROM source s
 WHERE r.agencija_id IS NULL AND r.globalno_id IS NULL
   AND lower(btrim(r.naziv)) = lower(btrim(s.naziv))
   AND r.opis_poslova IS DISTINCT FROM s.opis_poslova
 RETURNING r.*
), inserted AS (
 INSERT INTO radna_mjesta (naziv, opis_poslova, agencija_id, globalno_id)
 SELECT s.naziv, s.opis_poslova, NULL, NULL FROM source s
 WHERE NOT EXISTS (
  SELECT 1 FROM radna_mjesta r
  WHERE r.agencija_id IS NULL AND r.globalno_id IS NULL
    AND lower(btrim(r.naziv)) = lower(btrim(s.naziv))
 )
 RETURNING *
), changes AS (
 SELECT u.id, to_jsonb(b) AS old_value, to_jsonb(u) AS new_value
 FROM updated u JOIN before_rows b ON b.id = u.id
 UNION ALL
 SELECT i.id, NULL::jsonb, to_jsonb(i) FROM inserted i
)
INSERT INTO audit_log
 (modul, akcija, tip_entiteta, entitet_id, stara_vrijednost, nova_vrijednost, napomena)
SELECT 'plate', 'import_global_job', 'RadnoMjesto', id, old_value, new_value,
 'Migracija 20261101140000_globalne_pozicije_summa: nazivi i puni opisi sa summasummarum.me/pozicije.html, snimak 2026-11-01.'
FROM changes;
COMMIT;
