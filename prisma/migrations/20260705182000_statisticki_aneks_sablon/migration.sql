WITH statisticki_aneks_template AS (
  INSERT INTO finansijski_izvjestaj_sabloni (tip_sifra, naziv, sistemski)
  VALUES ('STATISTICKI_ANEKS', 'Statistički aneks', true)
  RETURNING id
), existing_template AS (
  SELECT id FROM statisticki_aneks_template
  UNION ALL
  SELECT id FROM finansijski_izvjestaj_sabloni
  WHERE tip_sifra = 'STATISTICKI_ANEKS' AND sistemski = true AND agencija_id IS NULL AND firma_id IS NULL
  LIMIT 1
)
INSERT INTO finansijski_izvjestaj_pozicije (
  sablon_id, rbr, uslov, bold, grupa, pozicija, aop, nivo, prikazi, formula, konto, preskoci_konta, rucni_unos, znak
) VALUES
  ((SELECT id FROM existing_template), 1, NULL, false, 1, 'Prosjecan broj zaposlenih (ukupan broj zaposlenih krajem svakog mjeseca podijeljen sa brojem mjeseci)', '001', 1, true, NULL, NULL, NULL, true, -1),
  ((SELECT id FROM existing_template), 2, '60', false, 1, 'Prihodi od prodaje robe', '002', 1, true, NULL, '60', NULL, false, -1),
  ((SELECT id FROM existing_template), 3, '61', false, 1, 'Prihodi od prodaje proizvoda i usluga', '003', 1, true, NULL, '61', NULL, false, -1),
  ((SELECT id FROM existing_template), 4, '62', false, 1, 'Prihodi od aktiviranja ucinaka i robe', '004', 1, true, NULL, '62', NULL, false, -1),
  ((SELECT id FROM existing_template), 5, '640', false, 1, 'Prihodi od subvencija, prihodi od dotacija i prihodi od donacija', '005', 1, true, NULL, '640', NULL, false, -1),
  ((SELECT id FROM existing_template), 6, '650', false, 1, 'Prihodi od zakupnina', '006', 1, true, NULL, '650', NULL, false, -1),
  ((SELECT id FROM existing_template), 7, '673', false, 1, 'Dobici od prodaje materijala', '007', 1, true, NULL, '673', NULL, false, -1),
  ((SELECT id FROM existing_template), 8, '501', false, 1, 'Nabavna vrijednost prodate robe', '008', 1, true, NULL, '501', NULL, false, 1),
  ((SELECT id FROM existing_template), 9, '511', false, 1, 'Troškovi materijala za izradu', '009', 1, true, NULL, '511', NULL, false, 1),
  ((SELECT id FROM existing_template), 10, '512', false, 1, 'Troškovi ostalog materijala (režijskog)', '010', 1, true, NULL, '512', NULL, false, 1),
  ((SELECT id FROM existing_template), 11, '513', false, 1, 'Troškovi goriva i energije', '011', 1, true, NULL, '513', NULL, false, 1),
  ((SELECT id FROM existing_template), 12, '520', false, 1, 'Troškovi zarada i naknada zarada (bruto)', '012', 1, true, NULL, '520', NULL, false, 1),
  ((SELECT id FROM existing_template), 13, '529', false, 1, 'Naknada troškova smještaja i ishrane na službenom putu, naknade troškova prevoza na službenom putu', '013', 1, true, NULL, '529', NULL, false, 1),
  ((SELECT id FROM existing_template), 14, '53', false, 1, 'Troškovi proizvodnih usluga', '014', 1, true, NULL, '53', NULL, false, 1),
  ((SELECT id FROM existing_template), 15, '531 i 532', false, 1, 'Troškovi transportnih usluga i troškovi usluga održavanja', '015', 1, true, NULL, '531,532', NULL, false, 1),
  ((SELECT id FROM existing_template), 16, '533', false, 1, 'Troškovi zakupnina', '016', 1, true, NULL, '533', NULL, false, 1),
  ((SELECT id FROM existing_template), 17, '534 i 535', false, 1, 'Troškovi sajmova i troškovi reklame i propagande', '017', 1, true, NULL, '534,535', NULL, false, 1),
  ((SELECT id FROM existing_template), 18, '536', false, 1, 'Troškovi istraživanja', '018', 1, true, NULL, '536', NULL, false, 1),
  ((SELECT id FROM existing_template), 19, '550 i 551', false, 1, 'Troškovi neproizvodnih usluga i troškovi reprezentacije', '019', 1, true, NULL, '550,551', NULL, false, 1),
  ((SELECT id FROM existing_template), 20, '552 i 553', false, 1, 'Troškovi premija osiguranja i troškovi platnog prometa', '020', 1, true, NULL, '552,553', NULL, false, 1),
  ((SELECT id FROM existing_template), 21, '573', false, 1, 'Gubici od prodaje materijala', '021', 1, true, NULL, '573', NULL, false, 1),
  ((SELECT id FROM existing_template), 22, '10', false, 1, 'Zalihe materijala', '022', 1, true, NULL, '10', NULL, false, 1),
  ((SELECT id FROM existing_template), 24, '11', false, 1, 'Zalihe nedovršene proizvodnje', '023', 1, true, NULL, '11', NULL, false, 1),
  ((SELECT id FROM existing_template), 25, '12', false, 1, 'Zalihe gotovih proizvoda', '024', 1, true, NULL, '12', NULL, false, 1),
  ((SELECT id FROM existing_template), 26, '13', false, 1, 'Zalihe roba', '025', 1, true, NULL, '13', NULL, false, 1),
  ((SELECT id FROM existing_template), 27, NULL, false, 2, 'Analiticki prikaz prihoda i izdataka vezanih za nematerijalnu imovinu', NULL, 0, true, NULL, NULL, NULL, false, 1),
  ((SELECT id FROM existing_template), 28, '652', false, 2, 'Prihodi od naknada po osnovu patenata', '026', 1, true, NULL, '652', NULL, false, 1),
  ((SELECT id FROM existing_template), 29, '652', false, 2, 'Prihodi po osnovu autorskih prava', '027', 1, true, NULL, '652', NULL, false, 1),
  ((SELECT id FROM existing_template), 30, '652', false, 2, 'Prihod od prodaje licenci', '028', 1, true, NULL, '652', NULL, false, 1),
  ((SELECT id FROM existing_template), 31, '010', false, 2, 'Ulaganje u razvoj', '029', 1, true, NULL, '010', NULL, false, 1),
  ((SELECT id FROM existing_template), 32, '0100', false, 2, 'Ulaganja u razvoj tržišta, sa efektom dužim od jedne godine', '030', 1, true, NULL, '0100', NULL, false, 1),
  ((SELECT id FROM existing_template), 33, '0101', false, 2, 'Ulaganja u razvoj tehnologije, sa efektom dužim od jedne godine', '031', 1, true, NULL, '0101', NULL, false, 1),
  ((SELECT id FROM existing_template), 34, '0102', false, 2, 'Ulaganja u razvoj proizvoda, sa efektom dužim od jedne godine', '032', 1, true, NULL, '0102', NULL, false, 1),
  ((SELECT id FROM existing_template), 35, '0103', false, 2, 'Ostali izdaci za razvoj', '033', 1, true, NULL, '0103', NULL, false, 1),
  ((SELECT id FROM existing_template), 36, '0108', false, 2, 'Ispravka vrijednosti ulaganja u razvoj', '034', 1, true, NULL, '0108', NULL, false, 1),
  ((SELECT id FROM existing_template), 37, '0109', false, 2, 'Obezvredivanje vrijednosti ulaganja u razvoj', '035', 1, true, NULL, '0109', NULL, false, 1),
  ((SELECT id FROM existing_template), 38, '011', false, 2, 'Koncesije, patenti, licence i slicna prava', '036', 1, true, NULL, '011', NULL, false, 1),
  ((SELECT id FROM existing_template), 39, '0110', false, 2, 'Koncesije', '037', 1, true, NULL, '0110', NULL, false, 1),
  ((SELECT id FROM existing_template), 40, '0111', false, 2, 'Patenti', '038', 1, true, NULL, '0111', NULL, false, 1),
  ((SELECT id FROM existing_template), 41, '0112', false, 2, 'Licence', '039', 1, true, NULL, '0112', NULL, false, 1),
  ((SELECT id FROM existing_template), 42, '0113', false, 2, 'Pravo na industrijski uzorak, žig, model, zaštitni znak i sl.', '040', 1, true, NULL, '0113', NULL, false, 1),
  ((SELECT id FROM existing_template), 43, '0114', false, 2, 'Druga slicna prava', '041', 1, true, NULL, '0114', NULL, false, 1),
  ((SELECT id FROM existing_template), 44, '0118', false, 2, 'Ispravka vrijednosti koncesija, patenata licenci i slicnih prava', '042', 1, true, NULL, '0118', NULL, false, 1),
  ((SELECT id FROM existing_template), 45, '0119', false, 2, 'Obezvredivanje koncesija, patenata licenci i slicnih prava', '043', 1, true, NULL, '0119', NULL, false, 1),
  ((SELECT id FROM existing_template), 46, '012', false, 2, 'Goodwill', '044', 1, true, NULL, '012', NULL, false, 1),
  ((SELECT id FROM existing_template), 47, '0120', false, 2, 'Goodwill nastao po osnovu stecene (pripojene) neto imovine drugog pravnog lica', '045', 1, true, NULL, '0120', NULL, false, 1),
  ((SELECT id FROM existing_template), 48, '0121', false, 2, 'Goodwill nastao po osnovu kupovine akcija i udjela u drugom pravnom licu', '046', 1, true, NULL, '0121', NULL, false, 1),
  ((SELECT id FROM existing_template), 49, '0129', false, 2, 'Obezvredivanje goodwill-a', '047', 1, true, NULL, '0129', NULL, false, 1),
  ((SELECT id FROM existing_template), 50, '014', false, 2, 'Ostala nematerijalna ulaganja', '048', 1, true, NULL, '014', NULL, false, 1),
  ((SELECT id FROM existing_template), 51, '0140', false, 2, 'Racunarski programi', '049', 1, true, NULL, '0140', NULL, false, 1),
  ((SELECT id FROM existing_template), 52, '0141', false, 2, 'Pravo korišcenja gradskog gradevinskog zemljišta', '050', 1, true, NULL, '0141', NULL, false, 1),
  ((SELECT id FROM existing_template), 53, '0142', false, 2, 'Ulaganja u lizing', '051', 1, true, NULL, '0142', NULL, false, 1),
  ((SELECT id FROM existing_template), 54, '0145', false, 2, 'Ostala nematerijalna ulaganja', '052', 1, true, NULL, '0145', NULL, false, 1),
  ((SELECT id FROM existing_template), 55, '0148', false, 2, 'Ispravka vrijednosti ostalih nematerijalnih ulaganja', '053', 1, true, NULL, '0148', NULL, false, 1),
  ((SELECT id FROM existing_template), 56, '0149', false, 2, 'Obezvredenje ostalih nematerijalnih ulaganja', '054', 1, true, NULL, '0149', NULL, false, 1),
  ((SELECT id FROM existing_template), 57, '015', false, 2, 'Nematerijalna ulaganja u pripremi', '055', 1, true, NULL, '015', NULL, false, 1),
  ((SELECT id FROM existing_template), 58, '0150', false, 2, 'Ulaganja u razvoj u pripremi', '056', 1, true, NULL, '0150', NULL, false, 1),
  ((SELECT id FROM existing_template), 59, '0151', false, 2, 'Interno generisana nematerijalna ulaganja u pripremi', '057', 1, true, NULL, '0151', NULL, false, 1),
  ((SELECT id FROM existing_template), 60, '0155', false, 2, 'Druga nematerijalna ulaganja u pripremi', '058', 1, true, NULL, '0155', NULL, false, 1),
  ((SELECT id FROM existing_template), 61, '0159', false, 2, 'Obezvredenje nematerijalnih ulaganja u pripremi', '059', 1, true, NULL, '0159', NULL, false, 1),
  ((SELECT id FROM existing_template), 62, '016', false, 2, 'Avansi za nematerijalna ulaganja', '060', 1, true, NULL, '016', NULL, false, 1),
  ((SELECT id FROM existing_template), 63, '0160', false, 2, 'Avansi za nematerijalna ulaganja u razvoj', '061', 1, true, NULL, '0160', NULL, false, 1),
  ((SELECT id FROM existing_template), 64, '0161', false, 2, 'Avansi za druga nematerijalna ulaganja', '062', 1, true, NULL, '0161', NULL, false, 1);
