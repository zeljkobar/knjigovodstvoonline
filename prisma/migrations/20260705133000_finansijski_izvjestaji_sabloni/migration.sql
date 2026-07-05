CREATE TABLE "finansijski_izvjestaj_sabloni" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID,
  "firma_id" UUID,
  "tip_sifra" TEXT NOT NULL,
  "naziv" TEXT NOT NULL,
  "sistemski" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,
  CONSTRAINT "finansijski_izvjestaj_sabloni_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "finansijski_izvjestaj_pozicije" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sablon_id" UUID NOT NULL,
  "rbr" INTEGER NOT NULL,
  "uslov" TEXT,
  "bold" BOOLEAN NOT NULL DEFAULT false,
  "grupa" INTEGER NOT NULL DEFAULT 0,
  "pozicija" TEXT NOT NULL,
  "aop" TEXT NOT NULL,
  "nivo" INTEGER NOT NULL DEFAULT 0,
  "prikazi" BOOLEAN NOT NULL DEFAULT true,
  "formula" TEXT,
  "konto" TEXT,
  "preskoci_konta" TEXT,
  "rucni_unos" BOOLEAN NOT NULL DEFAULT false,
  "znak" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finansijski_izvjestaj_pozicije_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "finansijski_izvjestaj_sabloni_agencija_id_firma_id_tip_sifra_idx"
ON "finansijski_izvjestaj_sabloni"("agencija_id", "firma_id", "tip_sifra");

CREATE UNIQUE INDEX "finansijski_izvjestaj_pozicije_sablon_id_rbr_key"
ON "finansijski_izvjestaj_pozicije"("sablon_id", "rbr");

CREATE UNIQUE INDEX "finansijski_izvjestaj_pozicije_sablon_id_aop_key"
ON "finansijski_izvjestaj_pozicije"("sablon_id", "aop");

CREATE INDEX "finansijski_izvjestaj_pozicije_sablon_id_prikazi_idx"
ON "finansijski_izvjestaj_pozicije"("sablon_id", "prikazi");

ALTER TABLE "finansijski_izvjestaj_pozicije"
ADD CONSTRAINT "finansijski_izvjestaj_pozicije_sablon_id_fkey"
FOREIGN KEY ("sablon_id") REFERENCES "finansijski_izvjestaj_sabloni"("id") ON DELETE CASCADE ON UPDATE CASCADE;

WITH sablon AS (
  INSERT INTO "finansijski_izvjestaj_sabloni" ("tip_sifra", "naziv", "sistemski")
  VALUES ('BILANS_USPJEHA', 'Bilans uspjeha', true)
  RETURNING "id"
)
INSERT INTO "finansijski_izvjestaj_pozicije" (
  "sablon_id", "rbr", "uslov", "bold", "grupa", "pozicija", "aop", "nivo",
  "prikazi", "formula", "konto", "preskoci_konta", "rucni_unos", "znak"
)
SELECT sablon."id", v.*
FROM sablon
CROSS JOIN (VALUES
  (101, '60 i 61', TRUE, 1, '1. Prihod od prodaje', 'A201', 3, TRUE, NULL, '60, 61', NULL, FALSE, -1),
  (102, '630 i 631', TRUE, 1, '2. Promjena vrijednosti zaliha gotovih proizvoda i nedovršene proizvodnje', 'A202', 3, TRUE, NULL, '630, 631', NULL, FALSE, -1),
  (103, '62', TRUE, 1, '3. Prihodi od aktiviranja ucinaka i robe', 'A203', 3, TRUE, NULL, '62', NULL, FALSE, -1),
  (104, NULL, TRUE, 1, '4. Ostali prihodi iz poslovanja (205 do 207)', 'A204', 3, TRUE, 'A205+A206+A207', NULL, NULL, FALSE, 1),
  (105, '64 i 65', FALSE, 1, 'a) Ostali prihodi iz redovnog poslovanja', 'A205', 1, TRUE, NULL, '64, 65', NULL, FALSE, -1),
  (106, '67, 691 i 692', FALSE, 1, 'b) Ostali prihodi iz poslovanja', 'A206', 1, TRUE, NULL, '67, 691, 692', NULL, FALSE, -1),
  (107, '68, sem 683 i 685', FALSE, 1, 'c) Prihodi po osnovu vrijednosnog uskladivanja imovine', 'A207', 1, TRUE, NULL, '68', '683, 685', FALSE, -1),
  (108, NULL, TRUE, 1, '5. Troškovi poslovanja (209+210)', 'A208', 3, TRUE, 'A209+A210+A210a', NULL, NULL, FALSE, 1),
  (109, '50 i 51', FALSE, 1, 'a) Nabavna vrijednost prodate robe i troškovi materijala', 'A209', 1, TRUE, NULL, '50, 51', NULL, FALSE, 1),
  (110, '53, 54 (dio) i 55', FALSE, 1, 'b) Ostali troškovi poslovanja (amortizacija, rezervisanja i ostali poslovni rashodi)', 'A210', 1, TRUE, NULL, '53, 54, 55', '540', FALSE, 1),
  (111, '52(dio)', FALSE, 1, 'c) Amortizacija', 'A210a', 1, TRUE, NULL, '540', NULL, FALSE, 1),
  (112, NULL, TRUE, 1, '6. Troškovi zarada, naknada zarada i ostali licni rashodi (212+213)', 'A211', 3, TRUE, 'A212+A213', NULL, NULL, FALSE, 1),
  (113, '52(dio)', FALSE, 1, 'a) Neto troškovi zarada, naknada zarada i licni rashodi', 'A212', 2, TRUE, NULL, '5200, 5294, 5292, 5293, 5221, 5291, 5202', NULL, FALSE, 1),
  (114, NULL, FALSE, 1, 'b) Troškovi poreza i doprinosa (214 do 216)', 'A213', 2, TRUE, 'A214+A215+A216', NULL, NULL, FALSE, 1),
  (115, '52(dio)', FALSE, 1, '1/ Troškovi poreza', 'A214', 1, TRUE, NULL, '5201, 5207, 5222', NULL, FALSE, 1),
  (116, '52(dio)', FALSE, 1, '2/ Troškovi doprinosa za penzije', 'A215', 1, TRUE, NULL, '5208,5211', '52082,52112,52113', FALSE, 1),
  (117, '52(dio)', FALSE, 1, '3/ Troškovi doprinosa', 'A216', 1, TRUE, NULL, '52082,52112,52113, 5216', NULL, FALSE, 1),
  (118, NULL, TRUE, 1, '7. Rashodi po osnovu vrijednosnog uskladivanja imovine (osim finansijske) (218+219)', 'A217', 3, TRUE, 'A218+A219', NULL, NULL, FALSE, 1),
  (119, '580, 581, 582, 589(dio)', FALSE, 1, 'a) Rashodi po osnovu vrijednosnog uskladivanja stalne imovine (osim finansijske)', 'A218', 1, TRUE, NULL, '580, 581, 582, 5890', NULL, FALSE, 1),
  (120, '584, 589(dio)', FALSE, 1, 'b) Rashodi po osnovu vrijednosnog uskladivanja obrtne imovine (osim finansijske)', 'A219', 1, TRUE, NULL, '584, 5891', NULL, FALSE, 1),
  (121, '57, 591 i 592', TRUE, 1, '8. Ostali rashodi iz poslovanja', 'A220', 3, TRUE, NULL, '57, 591, 592', NULL, FALSE, 1),
  (122, NULL, TRUE, 1, 'I. Poslovni rezultat (201+202+203+204-208-211-217-220)', 'A221', 4, TRUE, 'A201+A202+A203+A204-A208-A211-A217-A220', NULL, NULL, FALSE, 1),
  (123, NULL, FALSE, 1, '9. Prihodi po osnovu ucešca u kapitalu (223 do 225)', 'A222', 2, TRUE, 'A223+A224+A225', NULL, NULL, FALSE, 1),
  (124, '660(dio)', FALSE, 1, 'a) Prihodi po osnovu ucešca u kapitalu zavisnih pravnih lica', 'A223', 1, TRUE, NULL, '6600', NULL, FALSE, -1),
  (125, '661(dio)', FALSE, 1, 'b) Prihodi po osnovu ucešca u kapitalu ostalih povezanih pravnih lica', 'A224', 1, TRUE, NULL, '6610', NULL, FALSE, -1),
  (126, '669(dio)', FALSE, 1, 'c) Prihodi po osnovu ucešca u kapitalu nepovezanih pravnih lica', 'A225', 1, TRUE, NULL, '6690', '6690', FALSE, -1),
  (127, NULL, TRUE, 1, '10. Prihodi od ostalih finansijskih ulaganja i zajmova (kamate, kursne razlike i efekti ugovorene zaštite) (227 do 229)', 'A226', 2, TRUE, 'A227+A228+A229', NULL, NULL, FALSE, 1),
  (128, '660(dio)', FALSE, 1, 'a) Prihodi od ostalih finansijskih ulaganja i zajmova od maticnog i zavisnih pravnih lica', 'A227', 1, TRUE, NULL, '6601', NULL, FALSE, -1),
  (129, '661(dio)', FALSE, 1, 'b) Prihodi od ostalih finansijskih ulaganja i zajmova od ostalih povezanih pravnih lica', 'A228', 1, TRUE, NULL, '6611', NULL, FALSE, -1),
  (130, '662(dio), 663(dio), 664(dio), 669(dio)', FALSE, 1, 'c) Prihodi od ostalih finansijskih ulaganja i zajmova od ostalih nepovezanih pravnih lica', 'A229', 1, TRUE, NULL, '6620, 6630, 6640, 6691', NULL, FALSE, -1),
  (131, NULL, TRUE, 1, '11. Ostali prihodi po osnovu kamata, kursnih razlika i efekata ugovorene zaštite (231 do 233)', 'A230', 2, TRUE, 'A231+A232+A233', NULL, NULL, FALSE, 1),
  (132, '660(dio)', FALSE, 1, 'a) Finansijski prihodi po osnovu tekucih potraživanja od maticnog i zavisnih pravnih lica', 'A231', 1, TRUE, NULL, '6602', NULL, FALSE, -1),
  (133, '661(dio)', FALSE, 1, 'b) Finansijski prihodi po osnovu tekucih potraživanja od ostalih povezanih pravnih lica', 'A232', 1, TRUE, NULL, '6612', NULL, FALSE, -1),
  (134, '662(dio), 663(dio), 664(dio), 669(dio)', FALSE, 1, 'c) Finansijski prihodi po osnovu tekucih potraživanja od ostalih nepovezanih pravnih lica', 'A233', 1, TRUE, NULL, '6629, 6639, 6649, 6699, 6624', NULL, FALSE, -1),
  (135, NULL, TRUE, 1, '12. Vrijednosno uskladivanje kratkorocnih finansijskih sredstava i finansijskih ulaganja koji su dio obrtne imovine (235-236)', 'A234', 2, TRUE, 'A235+A236', NULL, NULL, FALSE, 1),
  (136, '683, 685', FALSE, 1, 'a) Prihodi po osnovu vrijednosnog uskladivanja kratkorocnih finansijskih sredstava i finansijskih ulaganja koji su dio obrtne imovine', 'A235', 1, TRUE, NULL, '683, 685', NULL, FALSE, -1),
  (137, '583, 585', FALSE, 1, 'b) Rashodi po osnovu vrijednosnog uskladivanja kratkorocnih finansijskih sredstava i finansijskih ulaganja koji su dio obrtne imovine', 'A236', 1, TRUE, NULL, '583, 585', NULL, FALSE, 1),
  (138, NULL, TRUE, 1, '13. Rashodi po osnovu kamata, kursnih razlika i drugih efekata ugovorene zaštite (238 do 240)', 'A237', 2, TRUE, 'A238+A239+A240', NULL, NULL, FALSE, 1),
  (139, '560', FALSE, 1, 'a) Rashodi po osnovu kamata, kursnih razlika i drugih efekata ugovorene zaštite po osnovu odnosa sa maticnim i zavisnim pravnim licima', 'A238', 1, TRUE, NULL, '560', NULL, FALSE, 1),
  (140, '561', FALSE, 1, 'b) Rashodi po osnovu kamata, kursnih razlika i drugih efekata ugovorene zaštite po osnovu odnosa sa drugim povezanim licima', 'A239', 1, TRUE, NULL, '561', NULL, FALSE, 1),
  (141, '562, 563, 564, 569', FALSE, 1, 'c) Rashodi po osnovu kamata, kursnih razlika i drugih efekata ugovorene zaštite po osnovu odnosa sa nepovezanim licima', 'A240', 1, TRUE, NULL, '562, 563, 564, 569', NULL, FALSE, 1),
  (142, NULL, TRUE, 2, 'II. Finansijski rezultat (222+226+230+234-237)', 'A241', 4, TRUE, 'A222+A226+A230+A234-A237', NULL, NULL, FALSE, 1),
  (143, NULL, TRUE, 3, 'III. Rezultat iz redovnog poslovanja prije oporezivanja (221+241)', 'A242', 5, TRUE, 'A221+A241', NULL, NULL, FALSE, 1),
  (144, '690-590', TRUE, 4, 'IV. Neto rezultat poslovanja koje je obustavljeno', 'A243', 5, TRUE, NULL, '690, 590', NULL, FALSE, -1),
  (145, NULL, TRUE, 5, 'V. Rezultat prije oporezivanja (242+243)', 'A244', 6, TRUE, 'A242+A243', NULL, NULL, FALSE, 1),
  (146, NULL, TRUE, 5, '14. Poreski rashod perioda (246+247)', 'A245', 2, TRUE, 'A246+A247', NULL, NULL, FALSE, 1),
  (147, '721', FALSE, 5, '1. Tekuci porez na dobit', 'A246', 1, TRUE, NULL, '721', NULL, FALSE, 1),
  (148, '722', FALSE, 5, '2. Odloženi poreski rashodi ili prihodi perioda', 'A247', 1, TRUE, NULL, '722', NULL, FALSE, 1),
  (149, NULL, TRUE, 5, '15. Dobitak ili gubitak nakon oporezivanja (244-245)', 'A248', 7, TRUE, 'A244-A245', NULL, NULL, FALSE, 1),
  (150, NULL, TRUE, 6, 'VI. Bruto rezultat drugih stavki rezultata /povezanih sa kapitalom/ (250 do 257)', 'A249', 5, TRUE, NULL, NULL, NULL, FALSE, 1),
  (151, '330', FALSE, 6, '1. Promjene revalorizacionih rezervi po osnovu nekretnina, postrojenja, opreme, nematerijalnih ulaganja i bioloških sredstava', 'A250', 1, TRUE, NULL, '330', NULL, FALSE, 1),
  (152, '331', FALSE, 6, '2. Promjene nerealizovanih dobitaka i gubitaka po osnovu preracuna finansijskih izvještaja inostranog poslovanja', 'A251', 1, TRUE, NULL, '331', NULL, FALSE, 1),
  (153, '332', FALSE, 6, '3. Promjene nerealizovanih dobitaka i gubitaka po osnovu ulaganja u vlasnicke instrumente kapitala', 'A252', 1, TRUE, NULL, '332', NULL, FALSE, 1),
  (154, '333', FALSE, 6, '4. Promjene aktuarskih dobitaka i gubitaka po osnovu planova definisanih naknada aktuarskih dobitaka (ili gubitaka) u vezi sa definisanim planovima penzionih naknada', 'A253', 1, TRUE, NULL, '333', NULL, FALSE, 1),
  (155, '334', FALSE, 6, '5. Promjene ucešca u ostalom sveobuhvatnom rezultatu pridruženog društva', 'A254', 1, TRUE, NULL, '334', NULL, FALSE, 1),
  (156, '335', FALSE, 6, '6. Promjene nerealizovanih dobitaka i gubitaka po osnovu instrumenata zaštite neto ulaganja u inostrano poslovanje', 'A255', 1, TRUE, NULL, '335', NULL, FALSE, 1),
  (157, '336', FALSE, 6, '7. Promjene revalorizacionih rezervi po osnovu hedžinga tokova gotovine', 'A256', 1, TRUE, NULL, '336', NULL, FALSE, 1),
  (158, '337', FALSE, 6, '8. Ostale promjene nerealizovanih dobitaka i gubitaka', 'A257', 1, TRUE, NULL, '337', NULL, FALSE, 1),
  (159, NULL, TRUE, 7, 'VII. Odloženi poreski rashodi ili prihodi perioda u vezi sa drugim stavkama rezultata /povezanim sa kapitalom/', 'A258', 5, TRUE, NULL, NULL, NULL, TRUE, 1),
  (160, NULL, TRUE, 8, 'VIII. Neto rezultat drugih stavki rezultata /povezanim sa kapitalom/ (249-258)', 'A259', 7, TRUE, 'A249-A258', NULL, NULL, FALSE, 1),
  (161, NULL, TRUE, 9, 'IX. Neto sveobuhvatni rezultat (248+259)', 'A260', 8, TRUE, 'A248+A259', NULL, NULL, FALSE, 1),
  (162, NULL, TRUE, 10, 'X. ZARADA PO AKCIJI (262+263)', 'A261', 2, TRUE, 'A262+A263', NULL, NULL, FALSE, 1),
  (163, NULL, FALSE, 10, '1. Osnovna zarada po akciji', 'A262', 1, TRUE, NULL, NULL, NULL, TRUE, 1),
  (164, NULL, FALSE, 10, '2. Umanjena (razdvojena) zarada po akciji', 'A263', 1, TRUE, NULL, NULL, NULL, TRUE, 1),
  (165, NULL, TRUE, 10, 'XI. Neto rezultat koji pripada vlasnicima maticnog pravnog lica', 'A264', 2, TRUE, NULL, NULL, NULL, TRUE, 1),
  (166, NULL, TRUE, 10, 'XII. Neto rezultat koji pripada ucešcima koji ne obezbjeduju kontrolu', 'A265', 2, TRUE, NULL, NULL, NULL, TRUE, 1)
) AS v("rbr", "uslov", "bold", "grupa", "pozicija", "aop", "nivo", "prikazi", "formula", "konto", "preskoci_konta", "rucni_unos", "znak");
