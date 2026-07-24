# 08_Plate_i_Obracun_Zarada.md

## Modul 8 — Plate i obračun zarada

**Aplikacija:** Računovodstveni program
**Tip dokumenta:** Specifikacija modula za Codex / razvoj
**Status:** Početna kvalitetna specifikacija za implementaciju
**Verzija:** 1.0
**Napomena:** Stope, pragovi, šifre i pravila ne smiju biti hardkodirani.

---

## 1. Svrha modula

Modul plata služi za obračun zarada i ostalih ličnih primanja u Crnoj Gori.

Modul mora podržati:

- zaposlene / radnike
- ugovore i radno vrijeme
- obračunske periode
- više vrsta obračuna zarada
- obračun iz neto iznosa
- obračun iz bruto iznosa
- obračun iz koeficijenta
- obračun sa i bez minulog rada
- puno i nepuno radno vrijeme
- fond sati obračuna
- IOPPD/PID šifarnik
- šifre primanja
- poreze i doprinose kroz šifarnike
- obustave
- preview obračuna
- uplatnice
- pripremu IOPPD prijave
- automatsko knjiženje obračuna plata
- vezu sa izvodima za isplatu plata

Prvi cilj modula nije da odmah pokrije sve moguće vrste ličnih primanja, nego da napravi stabilan sistem koji može kasnije da se širi.

---

## 2. Najvažnije pravilo

Modul plata ne smije imati hardkodirane poreske stope, doprinose, pragove, šifre primanja, IOPPD šifre, opštine, vrste rada ili pravila obračuna.

Sve mora biti kroz šifarnike sa datumom važenja.

```text
Stope i pravila se mijenjaju kroz bazu / admin šifarnike, ne kroz kod.
```

Razlog: pravila plata, poreza, doprinosa i IOPPD prijava se mogu mijenjati, pa sistem mora biti fleksibilan.

---

## 3. Odnos između IOPPD šifre, vrste obračuna i šifre primanja

Ovo je ključno.

U sistemu postoje tri različite stvari:

```text
1. IOPPD/PID šifra
2. Vrsta obračuna
3. Šifra primanja
```

One nijesu isto.

### 3.1. IOPPD/PID šifra

IOPPD/PID šifra govori **šta se prijavljuje**.

Primjeri:

```text
001 — Zarada
006 — Bolovanje do 60 dana
007 — Bolovanje preko 60 dana
047 — Ugovor o djelu
065 — Prihod od imovine i imovinskih prava
066 — Prihod od kapitala
097 — Lična primanja čiji ukupni bruto iznos je iznad 700 EUR
```

IOPPD šifarnik mora biti sistemski šifarnik.

### 3.2. Vrsta obračuna

Vrsta obračuna govori **kako se računa**.

Primjeri:

```text
Neto bez minulog rada
Neto sa minulim radom
Bruto bez minulog rada
Bruto sa minulim radom
Bruto iz koeficijenta sa minulim radom
Bruto iz koeficijenta bez minulog rada
Preračunati neto iz koeficijenta
```

### 3.3. Šifra primanja

Šifra primanja je operativno pravilo koje povezuje:

- IOPPD šifru
- vrstu obračuna
- porez
- doprinose
- da li se prikazuje na IOPPD
- da li ima bruto/neto
- da li koristi minuli rad
- kategoriju obračuna

Primjer:

```text
Šifra primanja: 001 Zarada
IOPPD šifra: 001 Zarada
Vrsta obračuna: Neto bez minulog rada
Porez: prema poreskom šifarniku
Doprinosi: prema šifarniku doprinosa
Prikaz na IOPPD: da
```

Drugi primjer:

```text
Šifra primanja: 001 Zarada
IOPPD šifra: 001 Zarada
Vrsta obračuna: Bruto iz koeficijenta sa minulim radom
```

Zaključak:

```text
IOPPD šifra govori šta se prijavljuje.
Vrsta obračuna govori kako se računa.
Šifra primanja povezuje šifru, algoritam i pravila poreza/doprinosa.
```

---

## 4. Prioritet MVP verzije

Za prvu verziju modula plata implementirati:

```text
1. Zaposleni
2. Ugovori / radno vrijeme
3. Obračunski period
4. IOPPD šifarnik
5. Vrste obračuna
6. Šifre primanja
7. Redovan rad
8. Neto → bruto
9. Bruto → neto
10. Koeficijent → bruto/neto
11. Sa i bez minulog rada
12. Puno i nepuno radno vrijeme
13. Fond sati po obračunu
14. Obračunske stavke po radniku
15. Preview obračuna
16. Osnovne obustave
17. Priprema IOPPD podataka
18. Automatski nalog za knjiženje
```

Za kasnije faze:

```text
- bolovanje do 60 dana
- bolovanje preko 60 dana
- porodiljsko/trudničko
- ugovor o djelu
- ugovor o zakupu
- dividende
- odbori direktora
- ostale IOPPD šifre
- uplatnice XML/štampa
- automatska predaja IOPPD
- napredne kontrole
```

---

## 5. Kategorije obračuna

Sistem mora podržati kategorije obračuna.

Minimalno:

```text
REDOVAN_RAD
UGOVOR_O_DJELU
ZAKUP
OSTALI_UGOVORI
```

Za MVP se implementira:

```text
REDOVAN_RAD
```

Ostale kategorije moraju biti predviđene u modelu, ali ne moraju biti kompletno implementirane odmah.

---

## 6. Zaposleni

Zaposleni je osnovni entitet za obračun plata.

Predložena tabela:

```text
payroll_employees
```

### 6.1. Polja zaposlenog

```sql
id
agency_id
company_id
employee_number
first_name
last_name
parent_name
personal_id_number
birth_date
gender
address
municipality_id
tax_municipality_id
email
phone
bank_account
employment_start_date
employment_end_date
termination_reason
is_active
is_employed
job_position_id
job_position_description
organization_unit_id
education_level
work_time_type_id
employment_percentage
weekly_hours
monthly_hours
uses_seniority
seniority_years
seniority_months
seniority_days
seniority_coefficient
complexity_coefficient
fixed_part_amount
net_salary_amount
gross_salary_amount
default_income_type_id
default_calculation_type_id
payout_in_cash
union_member
is_disabled_person
seasonal_worker
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

### 6.2. Pravila zaposlenog

- zaposleni pripada firmi
- zaposleni pripada agenciji preko firme
- JMBG je obavezan za IOPPD
- opština je važna zbog obračuna prireza/opštine ako se koristi
- tekući račun je potreban za isplatu, ali ne mora blokirati obračun u nacrtu
- neaktivan zaposleni se ne nudi za nove obračune
- zaposlenom se može definisati default šifra primanja
- zaposlenom se može definisati default vrsta obračuna
- zaposlenom se može definisati ugovorena neto ili bruto zarada
- zaposlenom se može definisati koeficijent
- zaposlenom se može definisati minuli rad

---

## 7. Ugovori i radno vrijeme

Radno vrijeme utiče na obračun zarade.

Ako radnik radi pola radnog vremena, treba da mu se obračuna proporcionalna plata.

### 7.1. Fond sati

Normalan fond sati za redovan obračun može biti:

```text
176
```

Ali to ne smije biti hardkodirano.

Fond sati mora biti polje na obračunskom periodu.

Primjer:

```text
Fond sati obračuna: 176
Radnik radi 50%: 88 sati
```

### 7.2. Formula za nepuno radno vrijeme

```text
obračunska_osnovica = ugovoreni_iznos × broj_sati_radnika / fond_sati
```

Primjer:

```text
Ugovorena neto plata: 600
Fond sati: 176
Radnikovi sati: 88

Neto za obračun = 600 × 88 / 176 = 300
```

### 7.3. Pravilo

```text
Ako je radnik prijavljen na manje od punog radnog vremena, zarada se proporcionalno računa prema odnosu radnikovih sati i fonda sati obračuna.
```

---

## 8. Obračunski period

Obračun se radi po firmi, poslovnoj godini i mjesecu.

Predložena tabela:

```text
payroll_periods
```

### 8.1. Polja

```sql
id
agency_id
company_id
business_year_id
year
month
period_from
period_to
calculation_date
payment_date
default_working_hours
status
note
created_at
created_by
updated_at
updated_by
locked_at
locked_by
```

### 8.2. Statusi

```text
DRAFT
CALCULATED
REVIEWED
POSTED
SUBMITTED
LOCKED
DELETED
```

### 8.3. Pravila

- jedan obračunski period pripada jednoj firmi i jednoj poslovnoj godini
- obračun ima period od/do
- obračun ima mjesec i godinu
- fond sati se unosi u obračun
- zaključan obračun ne smije se mijenjati bez posebnog prava
- zaključana poslovna godina blokira izmjene obračuna

---

## 9. Zaglavlje obračuna

Predložena tabela:

```text
payroll_calculations
```

### 9.1. Polja

```sql
id
agency_id
company_id
business_year_id
payroll_period_id
calculation_category
calculation_number
calculation_label
year
month
period_from
period_to
calculation_date
payment_date
default_working_hours
uses_seniority
coefficient_value_mode
status
note
journal_id
created_at
created_by
updated_at
updated_by
calculated_at
calculated_by
posted_at
posted_by
locked_at
locked_by
deleted_at
deleted_by
```

### 9.2. Primjer zaglavlja

```text
Vrsta obračuna: Redovan rad
Broj obračuna: 6 / 2026
Mjesec: 6
Godina: 2026
Datum od: 01.06.2026
Datum do: 30.06.2026
Datum obračuna: 30.06.2026
Datum isplate: 30.06.2026
Fond sati: 176
Status: DRAFT
```

---

## 10. IOPPD/PID šifarnik

Predložena tabela:

```text
payroll_ioppd_codes
```

### 10.1. Polja

```sql
id
code
name
description
category
is_active
valid_from
valid_to
created_at
updated_at
```

### 10.2. Pravila

- šifarnik je sistemski
- šifre moraju biti verzionisane
- ne smiju se brisati ako su korišćene
- svaka šifra primanja referencira IOPPD šifru
- za MVP treba seedovati šifarnik iz postojeće baze / validnog izvora

### 10.3. Primjeri šifara

```text
001 — Zarada
002 — Zarada za dopunski rad
006 — Bolovanje do 60 dana
007 — Bolovanje preko 60 dana
047 — Ugovorena naknada / ugovor o djelu
065 — Prihod od imovine i imovinskih prava
066 — Prihod od kapitala
097 — Lična primanja čiji ukupni bruto iznos je iznad 700 EUR
```

---

## 11. Vrste obračuna

Predložena tabela:

```text
payroll_calculation_types
```

### 11.1. Polja

```sql
id
code
name
input_type
uses_net
uses_gross
uses_coefficient
uses_seniority
is_other_income
algorithm_code
is_active
valid_from
valid_to
```

### 11.2. Predložene sistemske vrste

```text
GROSS_WITHOUT_SENIORITY
GROSS_WITH_SENIORITY
NET_WITHOUT_SENIORITY
NET_WITH_SENIORITY
COEFFICIENT_WITH_SENIORITY
COEFFICIENT_NET_RECALCULATION
NET_OTHER_INCOME
GROSS_OTHER_INCOME
GROSS2_OTHER_INCOME
COEFFICIENT_WITHOUT_SENIORITY
```

Mapiranje prema postojećoj logici:

```text
1 — Bruto bez minulog rada
2 — Bruto sa minulim radom
3 — Neto bez minulog rada
4 — Neto sa minulim radom
5 — Bruto iz koeficijenata i minulog rada
6 — Preračunati neto iz koeficijenata
7 — Neto, ostali obračuni
8 — Bruto, ostali obračuni
9 — Bruto 2, ostali obračuni
10 — Bruto iz koeficijenata bez minulog rada
```

### 11.3. Pravila

- vrsta obračuna određuje algoritam
- vrsta obračuna nije isto što i IOPPD šifra
- vrsta obračuna može koristiti neto, bruto ili koeficijent
- vrsta obračuna može uključivati ili isključivati minuli rad
- vrsta obračuna može biti namijenjena ostalim primanjima

---

## 12. Šifre primanja

Predložena tabela:

```text
payroll_income_types
```

### 12.1. Polja

```sql
id
agency_id
company_id nullable
code
name
short_name
ioppd_code_id
calculation_type_id
income_category
base_type
base_percentage
amount_calculation_percentage
uses_personal_income_tax
tax_rule_id
uses_employee_pio
employee_pio_rate_id
uses_employee_health
employee_health_rate_id
uses_employee_unemployment
employee_unemployment_rate_id
uses_employer_pio
employer_pio_rate_id
uses_employer_health
employer_health_rate_id
uses_employer_unemployment
employer_unemployment_rate_id
uses_labor_fund
labor_fund_rate_id
uses_union
union_rate_id
uses_chamber
chamber_rate_id
seniority_status
show_on_ioppd
without_gross_amount
without_net_amount
is_active
valid_from
valid_to
created_at
created_by
updated_at
updated_by
```

### 12.2. Pravila

- šifra primanja može biti sistemska ili po firmi
- mora imati IOPPD šifru ako se prikazuje na IOPPD
- mora imati vrstu obračuna
- određuje koji porezi i doprinosi se koriste
- određuje da li koristi minuli rad
- određuje da li ima bruto/neto iznos
- ne smije se fizički brisati ako je korišćena

---

## 13. Poreska pravila i doprinosi

Porezi i doprinosi moraju biti šifarnici.

Predložene tabele:

```text
payroll_tax_rules
payroll_tax_brackets
payroll_contribution_rules
payroll_contribution_rates
payroll_municipality_surtax_rates
```

### 13.1. Porez

Porez može biti:

- fiksna stopa
- progresivna stopa po razredima
- oslobođen
- specifičan po IOPPD šifri

### 13.2. Doprinosi

Doprinosi mogu biti:

- na teret zaposlenog
- na teret poslodavca
- dodatni doprinosi/fondovi

Primjeri vrsta doprinosa:

```text
EMPLOYEE_PIO
EMPLOYEE_HEALTH
EMPLOYEE_UNEMPLOYMENT
EMPLOYER_PIO
EMPLOYER_HEALTH
EMPLOYER_UNEMPLOYMENT
LABOR_FUND
UNION
CHAMBER
```

### 13.3. Pravilo

```text
Obračun koristi pravila koja važe na datum obračuna ili datum isplate, prema podešavanju sistema.
```

---

## 14. Minuli rad

Minuli rad mora biti podesiv.

Na zaposlenom:

```sql
uses_seniority
seniority_years
seniority_months
seniority_days
seniority_coefficient
```

Na vrsti obračuna:

```sql
uses_seniority
```

Na obračunu:

```sql
uses_seniority
```

### 14.1. Pravilo

```text
Minuli rad se obračunava samo ako ga koristi obračun, vrsta obračuna i radnik.
```

Ako je bilo koji od ovih uslova isključen, minuli rad se ne obračunava.

---

## 15. Radnici uključeni u obračun

Predložena tabela:

```text
payroll_calculation_employees
```

### 15.1. Polja

```sql
id
agency_id
company_id
payroll_calculation_id
employee_id
employee_snapshot_json
seniority_years
seniority_months
seniority_days
working_hours
employment_percentage
status
email_sent
created_at
created_by
updated_at
updated_by
```

### 15.2. Snapshot

Kada se radnik doda u obračun, treba snimiti snapshot osnovnih podataka.

Razlog: ako se kasnije promijeni radnik u šifarniku, stari obračun mora ostati isti.

Snapshot može sadržati:

- ime i prezime
- JMBG
- opštinu
- radno mjesto
- tekući račun
- radno vrijeme
- koeficijent
- minuli rad
- default šifru primanja
- default vrstu obračuna

---

## 16. Stavke obračuna

Stavke obračuna su srce modula plata.

Predložena tabela:

```text
payroll_calculation_lines
```

### 16.1. Polja

```sql
id
agency_id
company_id
payroll_calculation_id
employee_id
calculation_employee_id
line_number
income_type_id
ioppd_code_id
calculation_type_id
income_code
income_name
period_from
period_to
working_hours
working_hours_fund
employment_percentage
percentage
base_amount
input_net_amount
input_gross_amount
input_coefficient
fixed_part_amount
complexity_coefficient
seniority_coefficient
uses_seniority
amount_for_calculation
net_amount
gross_amount
taxable_gross_amount
personal_income_tax
surtax_amount
employee_pio
employee_health
employee_unemployment
employer_pio
employer_health
employer_unemployment
labor_fund
union_amount
chamber_amount
total_employee_contributions
total_employer_contributions
total_cost
net_for_payment
previous_gross
calculated_gross
calculation_details_json
status
warning_message
created_at
created_by
updated_at
updated_by
```

### 16.2. Pravila

- jedan radnik može imati više stavki obračuna
- svaka stavka ima šifru primanja
- svaka stavka ima IOPPD šifru
- svaka stavka ima vrstu obračuna
- stavka može biti redovan rad, bolovanje, ugovor, zakup, dividenda itd.
- za MVP obavezno podržati redovan rad
- rezultat obračuna se čuva na stavci, ne samo računa u letu

---

## 17. Algoritmi obračuna

Sistem mora podržati više algoritama.

### 17.1. Neto bez minulog rada

Korisnik unosi neto iznos.

Sistem računa bruto tako da nakon poreza i doprinosa dobije zadati neto.

```text
input: neto
output: bruto, porez, doprinosi
```

### 17.2. Neto sa minulim radom

Korisnik unosi neto iznos.

Sistem primjenjuje minuli rad ako je uključen.

```text
input: neto + minuli rad
output: bruto, porez, doprinosi
```

### 17.3. Bruto bez minulog rada

Korisnik unosi bruto.

Sistem računa neto.

```text
input: bruto
output: neto, porez, doprinosi
```

### 17.4. Bruto sa minulim radom

Korisnik unosi bruto.

Sistem primjenjuje minuli rad ako je uključen.

```text
input: bruto + minuli rad
output: neto, porez, doprinosi
```

### 17.5. Bruto iz koeficijenta sa minulim radom

Sistem računa osnovicu iz koeficijenta.

Polja:

```text
fiksni dio
koeficijent složenosti
koeficijent minulog rada
```

Primjer logike:

```text
osnovica = fiksni_dio × koeficijent_slozenosti
minuli_rad = osnovica × koeficijent_minulog_rada
bruto = osnovica + minuli_rad
```

Tačna formula mora biti podesiva kroz algoritam i šifarnike, jer može zavisiti od lokalne prakse.

### 17.6. Bruto iz koeficijenta bez minulog rada

Kao prethodno, ali bez minulog rada.

### 17.7. Preračunati neto iz koeficijenta

Sistem računa bruto iz koeficijenta, zatim računa neto.

---

## 18. Redovan rad — MVP pravila

Za redovan rad u MVP-u:

- IOPPD šifra: `001 Zarada`
- kategorija: `REDOVAN_RAD`
- može se računati iz neta, bruta ili koeficijenta
- može biti sa ili bez minulog rada
- mora podržati puno i nepuno radno vrijeme
- mora koristiti fond sati iz obračuna
- rezultat mora prikazati neto, bruto, porez, prirez, doprinose i ukupni trošak

---

## 19. Obustave

Obustave mogu biti:

- kredit
- administrativna zabrana
- alimentacija
- akontacija
- sindikat
- druge obustave

Predložene tabele:

```text
payroll_deductions
payroll_calculation_deductions
```

### 19.1. `payroll_deductions`

```sql
id
agency_id
company_id
employee_id
deduction_type
name
start_date
end_date
amount
percentage
total_debt
remaining_balance
installments_total
installments_remaining
partner_id
bank_account
is_active
created_at
created_by
updated_at
updated_by
```

### 19.2. `payroll_calculation_deductions`

```sql
id
agency_id
company_id
payroll_calculation_id
employee_id
deduction_id
amount
note
created_at
created_by
```

### 19.3. Pravila

- obustave umanjuju neto za isplatu
- obustave ne moraju mijenjati bruto
- sistem mora prikazati bruto/neto prije i poslije obustava
- obustava se može obračunavati po iznosu ili procentu
- obustava može imati saldo i broj rata

---

## 20. Uplatnice

Sistem treba predvidjeti uplatnice/naloge plaćanja.

Predložena tabela:

```text
payroll_payment_orders
```

### 20.1. Polja

```sql
id
agency_id
company_id
payroll_calculation_id
employee_id nullable
payment_order_type
payer_name
payment_purpose
receiver_name
payer_bank_account
receiver_bank_account
amount
payment_code
debit_reference_model
debit_reference_number
credit_reference_model
credit_reference_number
payment_date
municipality_id
status
created_at
created_by
```

### 20.2. Vrste uplatnica

```text
NET_SALARY
TAX
EMPLOYEE_CONTRIBUTIONS
EMPLOYER_CONTRIBUTIONS
SURTAX
DEDUCTION
OTHER
```

---

## 21. IOPPD priprema

Modul mora pripremiti podatke za IOPPD prijavu.

Predložene tabele:

```text
payroll_ioppd_reports
payroll_ioppd_report_lines
```

### 21.1. Zaglavlje IOPPD prijave

```sql
id
agency_id
company_id
business_year_id
payroll_calculation_id
year
month
period_from
period_to
payment_date
status
total_gross
total_net
total_tax
total_surtax
total_employee_contributions
total_employer_contributions
created_at
created_by
submitted_at
submitted_by
locked_at
locked_by
```

### 21.2. Stavke IOPPD prijave

```sql
id
payroll_ioppd_report_id
employee_id
ioppd_code_id
personal_id_number
employee_name
period_from
period_to
gross_amount
net_amount
tax_amount
surtax_amount
employee_pio
employee_health
employee_unemployment
employer_pio
employer_health
employer_unemployment
municipality_id
line_data_json
```

### 21.3. Pravila

- IOPPD se generiše iz obračunskih stavki
- samo stavke sa `show_on_ioppd = true` ulaze u IOPPD
- IOPPD koristi snapshot podataka iz obračuna
- zaključani IOPPD ne smije se mijenjati bez posebnog prava

---

## 22. Automatsko knjiženje plata

Obračun plata treba da kreira nalog za knjiženje.

Predložena tabela podešavanja:

```text
payroll_posting_settings
```

### 22.1. Default konta

Koristiti default konta firme, ne hardkodirati brojeve konta.

Potrebna default konta:

```text
DEFAULT_GROSS_SALARY_EXPENSE_ACCOUNT
DEFAULT_NET_SALARY_PAYABLE_ACCOUNT
DEFAULT_PAYROLL_TAX_PAYABLE_ACCOUNT
DEFAULT_EMPLOYEE_CONTRIBUTIONS_PAYABLE_ACCOUNT
DEFAULT_EMPLOYER_CONTRIBUTIONS_PAYABLE_ACCOUNT
DEFAULT_SURTAX_PAYABLE_ACCOUNT
DEFAULT_PAYROLL_DEDUCTIONS_PAYABLE_ACCOUNT
DEFAULT_BANK_ACCOUNT
```

### 22.2. Primjer knjiženja obračuna

Okvirno:

```text
Duguje: Trošak bruto zarada
Duguje: Trošak doprinosa na teret poslodavca, ako postoji
Potražuje: Obaveze prema zaposlenima
Potražuje: Obaveze za porez
Potražuje: Obaveze za doprinose
Potražuje: Obaveze za prirez
Potražuje: Obaveze za obustave
```

### 22.3. Isplata preko izvoda

Isplata plata se kasnije zatvara kroz modul izvoda.

Primjer:

```text
Duguje: Obaveze prema zaposlenima
Potražuje: Banka
```

### 22.4. Pravila

- jedan obračun plata u pravilu kreira jedan nalog
- nalog se kreira tek kada je obračun pregledan
- proknjižen obračun se ne mijenja direktno
- ako se obračun mijenja, prvo se vraća u nacrt
- svaka izmjena ide u audit log

---

## 23. UI ekran obračuna

Ekran treba biti organizovan po principu:

```text
Gore: zaglavlje obračuna
Lijevo: lista radnika
Desno/sredina: podaci izabranog radnika
Dolje: stavke obračuna za radnika
```

### 23.1. Gornja akcijska traka

Dugmad:

```text
Novi obračun
Dodaj radnike
Snimi
Obradi
Preview
IOPPD
Uplatnice
Nalog za knjiženje
Štampa
Izvoz
Kopija
Zaključaj
Izlaz
```

### 23.2. Zaglavlje obračuna

Polja:

```text
Vrsta obračuna
Broj obračuna
Mjesec
Godina
Datum od
Datum do
Datum obračuna
Datum isplate
Fond sati
Napomena
Status
```

### 23.3. Lista radnika

Lijeva lista prikazuje:

```text
Prezime i ime
Status obračuna
Neto
Bruto
Broj sati
Upozorenja
```

Klik na radnika otvara njegove detalje.

### 23.4. Podaci o radniku

Prikazati:

```text
Ime i prezime
JMBG
Opština
Radna jedinica
Radno mjesto
Datum početka
Radni staž
Vrsta radnog vremena
Procenat radnog vremena
Fond sati
Sati radnika
Fiksni dio
Koeficijent
Minuli rad
Koeficijent minulog rada
Bruto osnovica
Neto ugovoreno
Bruto ugovoreno
Tekući račun
Obustave
```

### 23.5. Stavke obračuna

Tabela:

```text
Šifra
Naziv
IOPPD šifra
Vrsta obračuna
Datum od
Datum do
Broj sati
Procenat
Osnovica
Polazni iznos
Neto
Bruto
Oporezivi bruto
Porez
Prirez
PIO
Zdravstvo
Nezaposlenost
Doprinosi poslodavca
Ukupan trošak
```

### 23.6. Preview prije obrade

Kada korisnik klikne `Obradi`, sistem treba prikazati preview.

Preview prikazuje:

```text
Radnik
Šifra primanja
Vrsta obračuna
Sati
Neto
Bruto
Porez
Prirez
Doprinosi zaposlenog
Doprinosi poslodavca
Obustave
Neto za isplatu
Status
Upozorenja
```

Obračun se ne zaključava dok korisnik ne potvrdi.

---

## 24. Validacije

### 24.1. Zaposleni

- ime je obavezno
- prezime je obavezno
- JMBG je obavezan za IOPPD
- opština je potrebna za obračun ako se koristi prirez/opštinsko pravilo
- aktivan radnik se nudi u obračun
- neaktivan radnik se ne nudi u novi obračun

### 24.2. Obračun

- firma je obavezna
- poslovna godina je obavezna
- mjesec je obavezan
- period od/do je obavezan
- fond sati je obavezan
- datum obračuna je obavezan
- datum isplate je preporučen/obavezan prije IOPPD-a

### 24.3. Stavke

- šifra primanja je obavezna
- IOPPD šifra je obavezna ako se stavka prikazuje na IOPPD
- vrsta obračuna je obavezna
- broj sati ne smije biti negativan
- neto/bruto/koeficijent mora postojati prema vrsti obračuna
- ako je minuli rad uključen, radnik mora imati podatke za minuli rad

### 24.4. Zaključavanje

- obračun sa greškama se ne može zaključati
- zaključan obračun se ne može mijenjati
- proknjižen obračun se ne mijenja direktno
- izmjena proknjiženog obračuna ide kroz vraćanje u nacrt

---

## 25. Audit log

Audit log mora bilježiti:

- kreiranje obračuna
- dodavanje radnika u obračun
- izmjenu podataka radnika u obračunu
- dodavanje/izmjenu/brisanje stavki
- obradu obračuna
- promjenu neto/bruto/koeficijenta
- uključivanje/isključivanje minulog rada
- promjenu fonda sati
- zaključavanje obračuna
- otključavanje obračuna
- generisanje IOPPD-a
- generisanje uplatnica
- generisanje naloga za knjiženje
- vraćanje proknjiženog obračuna u nacrt

---

## 26. API endpointi

### 26.1. Zaposleni

```http
GET    /api/payroll/employees
POST   /api/payroll/employees
GET    /api/payroll/employees/:id
PUT    /api/payroll/employees/:id
DELETE /api/payroll/employees/:id
POST   /api/payroll/employees/:id/deactivate
POST   /api/payroll/employees/:id/reactivate
```

### 26.2. Šifarnici

```http
GET /api/payroll/ioppd-codes
GET /api/payroll/calculation-types
GET /api/payroll/income-types
POST /api/payroll/income-types
PUT /api/payroll/income-types/:id
GET /api/payroll/tax-rules
GET /api/payroll/contribution-rules
```

### 26.3. Obračuni

```http
GET    /api/payroll/calculations
POST   /api/payroll/calculations
GET    /api/payroll/calculations/:id
PUT    /api/payroll/calculations/:id
DELETE /api/payroll/calculations/:id
POST   /api/payroll/calculations/:id/add-employees
POST   /api/payroll/calculations/:id/calculate
POST   /api/payroll/calculations/:id/preview
POST   /api/payroll/calculations/:id/post
POST   /api/payroll/calculations/:id/reopen
POST   /api/payroll/calculations/:id/lock
POST   /api/payroll/calculations/:id/unlock
```

### 26.4. Stavke obračuna

```http
GET    /api/payroll/calculations/:id/lines
POST   /api/payroll/calculations/:id/lines
PUT    /api/payroll/calculation-lines/:lineId
DELETE /api/payroll/calculation-lines/:lineId
```

### 26.5. IOPPD i uplatnice

```http
POST /api/payroll/calculations/:id/ioppd/generate
GET  /api/payroll/calculations/:id/ioppd
POST /api/payroll/calculations/:id/payment-orders/generate
GET  /api/payroll/calculations/:id/payment-orders
```

### 26.6. Knjiženje

```http
POST /api/payroll/calculations/:id/journal-preview
POST /api/payroll/calculations/:id/create-journal
GET  /api/payroll/calculations/:id/journal
```

---

## 27. Test scenariji

### 27.1. Neto bez minulog rada

1. Radnik ima neto zaradu 600.
2. Vrsta obračuna je Neto bez minulog rada.
3. Fond sati je 176.
4. Radnik radi 176 sati.

Očekivano:

```text
Sistem računa bruto, porez, doprinose i neto za isplatu.
Minuli rad se ne obračunava.
```

### 27.2. Neto sa pola radnog vremena

1. Radnik ima ugovorenu neto zaradu 600.
2. Fond sati je 176.
3. Radnik radi 88 sati.

Očekivano:

```text
Neto osnovica za obračun je 300.
```

### 27.3. Bruto bez minulog rada

1. Korisnik unese bruto.
2. Sistem računa neto.

Očekivano:

```text
Neto = bruto - porez - doprinosi iz zarade.
```

### 27.4. Koeficijent bez minulog rada

1. Radnik ima fiksni dio i koeficijent.
2. Vrsta obračuna je koeficijent bez minulog rada.

Očekivano:

```text
Sistem računa bruto iz koeficijenta bez dodatka za minuli rad.
```

### 27.5. Koeficijent sa minulim radom

1. Radnik ima fiksni dio, koeficijent i minuli rad.
2. Vrsta obračuna koristi minuli rad.

Očekivano:

```text
Sistem računa bruto iz koeficijenta i dodaje minuli rad.
```

### 27.6. IOPPD šifra

1. Stavka obračuna ima šifru primanja 001 Zarada.
2. Šifra ima IOPPD šifru 001.

Očekivano:

```text
Stavka ulazi u IOPPD sa šifrom 001.
```

### 27.7. Obračun sa obustavom

1. Radnik ima neto za isplatu 600.
2. Ima obustavu 100.

Očekivano:

```text
Neto prije obustave = 600.
Obustava = 100.
Neto za isplatu = 500.
```

### 27.8. Zaključan obračun

1. Obračun je zaključan.
2. Korisnik pokuša izmjenu stavke.

Očekivano:

```text
Sistem odbija izmjenu bez posebnog prava.
```

### 27.9. Proknjižen obračun

1. Obračun je proknjižen.
2. Korisnik pokuša direktnu izmjenu.

Očekivano:

```text
Sistem traži vraćanje u nacrt.
```

---

## 28. Prompt za Codex

```text
Implementiraj Modul 8 — Plate i obračun zarada prema specifikaciji iz fajla 08_Plate_i_Obracun_Zarada.md.

Obavezno poštuj:
- stope, pragovi, doprinosi i šifre ne smiju biti hardkodirani
- IOPPD šifra nije isto što i vrsta obračuna
- vrsta obračuna određuje algoritam: neto, bruto, koeficijent, sa/bez minulog rada
- šifra primanja povezuje IOPPD šifru, vrstu obračuna, poreze i doprinose
- obračun mora podržati puno i nepuno radno vrijeme
- fond sati je polje obračuna, normalno 176, ali podesivo
- pola radnog vremena računa proporcionalnu platu
- obračunske stavke su srce modula i moraju čuvati rezultate obračuna
- implementirati neto→bruto, bruto→neto i koeficijent algoritme kao servisni sloj
- implementirati minuli rad kao opciju po radniku, obračunu i vrsti obračuna
- implementirati preview prije zaključavanja
- implementirati pripremu IOPPD podataka
- implementirati osnovne uplatnice
- implementirati automatski nalog za knjiženje plata
- zaključan/proknjižen obračun se ne mijenja direktno
- sve bitne izmjene idu u audit log

Za MVP obavezno podržati redovan rad i IOPPD šifru 001 Zarada, a model ostaviti spreman za bolovanja, ugovor o djelu, zakup, dividende i ostale IOPPD šifre.
```

---

## 29. Zaključak

Modul plata treba graditi kao fleksibilan obračunski sistem.

Ključne odluke:

1. Postoji IOPPD šifarnik.
2. Postoje vrste obračuna.
3. Postoje šifre primanja koje povezuju IOPPD, algoritam i pravila poreza/doprinosa.
4. Sistem podržava neto, bruto i koeficijent.
5. Sistem podržava obračun sa i bez minulog rada.
6. Sistem podržava nepuno radno vrijeme.
7. Fond sati je podesiv po obračunu.
8. Obračunske stavke čuvaju rezultat obračuna.
9. Preview prije zaključavanja je obavezan.
10. IOPPD i knjiženje se generišu iz obračunskih stavki.

---

## Dopuna: Preračun neto ↔ bruto

Ovo poglavlje je obavezno za implementaciju modula plata.

Modul mora podržati obračun u oba smjera:

```text
BRUTO → NETO
NETO → BRUTO
```

Ovo je važno jer se u praksi zarada često ugovara kao neto iznos, ali za IOPPD, poreze, doprinose i knjiženje sistem mora izračunati bruto iznos.

Takođe, kod nekih firmi i ugovora se radi obrnuto: korisnik unese bruto, a sistem računa neto.

---

### 1. Pravilo: ne hardkodirati stope

Stope, pragovi i formule ne smiju biti trajno hardkodirani u kodu.

Moraju postojati šifarnici sa datumom važenja:

```text
payroll_tax_brackets
payroll_contribution_rates
payroll_gross_net_rules
```

Razlog:

- poreski razredi se mogu promijeniti
- doprinosi se mogu promijeniti
- pravila IOPPD-a se mogu promijeniti
- različite vrste primanja mogu imati različita pravila

U kodu se smije imati algoritam, ali ne i fiksno upisane stope kao trajna poslovna logika.

---

### 2. Trenutna pravila za redovnu zaradu

Za redovnu zaradu, prema trenutno korišćenoj logici obračuna:

```text
Doprinosi zaposlenog:
PIO = 10%
Nezaposlenost = 0.5%

Ukupni doprinosi zaposlenog = 10.5%
```

Porez na zarade se obračunava po razredima:

```text
0% do 700 EUR bruto
9% od 700.01 EUR do 1,000 EUR bruto
15% preko 1,000 EUR bruto
```

Ova pravila se koriste kao početna verzija šifarnika i moraju imati `valid_from` i `valid_to`.

---

### 3. Bruto → neto

Za bruto u neto obračun:

```text
doprinosi_zaposleni = bruto × 10.5%
```

Porez:

```text
ako bruto <= 700:
    porez = 0

ako bruto > 700 i bruto <= 1000:
    porez = (bruto - 700) × 9%

ako bruto > 1000:
    porez = 300 × 9% + (bruto - 1000) × 15%
```

Pošto je:

```text
300 × 9% = 27
```

za treći razred može se pisati:

```text
porez = 27 + (bruto - 1000) × 15%
```

Neto:

```text
neto = bruto - doprinosi_zaposleni - porez
```

---

### 4. Neto → bruto

Kod neto u bruto obračuna ne postoji jedan univerzalni koeficijent za sve iznose, jer porez ima razrede.

Zato sistem mora odrediti razred na osnovu neto iznosa.

#### 4.1. Neto pragovi

Ako je bruto 700 EUR:

```text
doprinosi = 700 × 10.5% = 73.50
porez = 0
neto = 626.50
```

Ako je bruto 1,000 EUR:

```text
doprinosi = 1000 × 10.5% = 105.00
porez = (1000 - 700) × 9% = 27.00
neto = 868.00
```

Zato su neto pragovi:

```text
do 626.50 EUR
od 626.51 EUR do 868.00 EUR
preko 868.00 EUR
```

---

### 5. Neto → bruto formule po razredima

#### 5.1. Prvi razred — neto do 626.50 EUR

U prvom razredu porez je 0.

```text
neto = bruto - bruto × 10.5%
neto = bruto × 0.895
```

Zato:

```text
bruto = neto / 0.895
```

Koeficijent:

```text
1 / 0.895 = 1.1173184358
```

Primjer:

```text
neto = 600
bruto = 600 / 0.895
bruto = 670.39
```

---

#### 5.2. Drugi razred — neto od 626.51 do 868.00 EUR

U drugom razredu:

```text
porez = (bruto - 700) × 9%
```

Neto:

```text
neto = bruto - bruto × 10.5% - (bruto - 700) × 9%
```

Sređeno:

```text
neto = 0.805 × bruto + 63
```

Zato:

```text
bruto = (neto - 63) / 0.805
```

Primjer:

```text
neto = 800
bruto = (800 - 63) / 0.805
bruto = 915.53
```

---

#### 5.3. Treći razred — neto preko 868.00 EUR

U trećem razredu:

```text
porez = 27 + (bruto - 1000) × 15%
```

Sređeno:

```text
porez = 0.15 × bruto - 123
```

Neto:

```text
neto = bruto - bruto × 10.5% - porez
neto = bruto - 0.105 × bruto - (0.15 × bruto - 123)
neto = 0.745 × bruto + 123
```

Zato:

```text
bruto = (neto - 123) / 0.745
```

Primjer:

```text
neto = 1,200
bruto = (1200 - 123) / 0.745
bruto = 1,445.64
```

---

### 6. Koeficijenti za preračun

Za trenutna pravila mogu se izvesti sljedeći koeficijenti/formule:

| Neto razred | Formula za bruto |
|---|---|
| `neto <= 626.50` | `bruto = neto / 0.895` |
| `626.50 < neto <= 868.00` | `bruto = (neto - 63) / 0.805` |
| `neto > 868.00` | `bruto = (neto - 123) / 0.745` |

Ovo nijesu obični fiksni koeficijenti za sve iznose, nego formule po poreskim razredima.

---

### 7. Veza sa vrstama obračuna

Ove formule se koriste kod vrsta obračuna:

```text
Neto bez minulog rada
Neto sa minulim radom
Neto iz koeficijenta
Neto — ostali obračuni
```

Kod bruto vrsta obračuna sistem prvo ima bruto, pa računa neto.

Kod koeficijent obračuna sistem prvo računa bruto ili neto osnovicu iz koeficijenta, pa zatim primjenjuje odgovarajući algoritam.

---

### 8. Minuli rad i neto/bruto

Ako vrsta obračuna koristi minuli rad, sistem mora prvo odrediti osnovicu, pa obračunati minuli rad prema pravilima firme/radnika.

Pravilo:

```text
Minuli rad se primjenjuje samo ako ga koristi i radnik i vrsta obračuna.
```

Kod bruto obračuna:

```text
bruto_sa_minulim = bruto_osnovica + iznos_minulog_rada
```

Kod neto obračuna postoje dva moguća pristupa, zavisno od pravila firme:

```text
1. neto ugovoreni iznos se tretira kao konačni neto, pa se bruto računa iz tog neta
2. neto osnovica se uveća za minuli rad, pa se onda računa bruto
```

Za MVP treba podržati podešavanje na vrsti obračuna:

```text
seniority_calculation_mode
```

Vrijednosti:

```text
INCLUDED_IN_NET
ADD_TO_BASE_BEFORE_GROSSING
```

---

### 9. Puno i nepuno radno vrijeme

Fond sati obračuna, na primjer 176, nalazi se u zaglavlju obračuna.

Ako radnik radi nepuno radno vrijeme, zarada se proporcionalno računa.

Formula:

```text
obračunska_osnovica = ugovoreni_iznos × broj_sati_radnika / fond_sati_obracuna
```

Primjer:

```text
Fond sati: 176
Radnik radi: 88 sati
Ugovoreni neto: 600

Neto za obračun = 600 × 88 / 176 = 300
```

Zatim se na taj iznos primjenjuje neto → bruto formula.

---

### 10. Prirez

Ako se prirez koristi, mora biti dio šifarnika po opštini.

Prirez se ne smije hardkodirati.

Tabela:

```text
payroll_municipality_surtax_rates
```

Polja:

```text
id
municipality_id
rate
valid_from
valid_to
is_active
```

U obračunu stavke čuvati:

```text
municipality_surtax_rate
surtax_amount
```

Ako se prirez ne koristi za određenu vrstu primanja, iznos je 0.

---

### 11. Predložene tabele za formule

#### `payroll_tax_brackets`

```sql
id
country_code
income_type
bracket_from
bracket_to
tax_rate
fixed_amount
valid_from
valid_to
is_active
```

#### `payroll_contribution_rates`

```sql
id
country_code
contribution_code
contribution_name
payer_type
rate
valid_from
valid_to
is_active
```

`payer_type`:

```text
EMPLOYEE
EMPLOYER
OTHER
```

#### `payroll_gross_net_rules`

```sql
id
country_code
rule_name
net_from
net_to
gross_from
gross_to
employee_contribution_rate
tax_rate
formula_type
coefficient
fixed_amount
valid_from
valid_to
is_active
```

Primjer trenutnih pravila:

```text
net_from: 0
net_to: 626.50
formula: bruto = neto / 0.895

net_from: 626.51
net_to: 868.00
formula: bruto = (neto - 63) / 0.805

net_from: 868.01
net_to: null
formula: bruto = (neto - 123) / 0.745
```

---

### 12. Validacije

Sistem mora validirati:

- da za period obračuna postoje važeće poreske stope
- da za period obračuna postoje važeći doprinosi
- da za neto → bruto postoji odgovarajuće pravilo
- da bruto → neto ne daje negativan neto
- da neto → bruto nakon preračuna ponovo daje isti neto u toleranciji centa
- da su stope i pragovi verzionisani
- da nije korišćeno neaktivno pravilo

Tolerancija za zaokruživanje:

```text
0.01 EUR
```

---

### 13. Test scenariji

#### Test 1 — neto 600 u bruto

Ulaz:

```text
neto = 600
```

Očekivano:

```text
bruto = 670.39
doprinosi zaposlenog = 70.39
porez = 0
neto = 600.00
```

#### Test 2 — bruto 670.39 u neto

Ulaz:

```text
bruto = 670.39
```

Očekivano:

```text
doprinosi zaposlenog = 70.39
porez = 0
neto = 600.00
```

#### Test 3 — neto 800 u bruto

Ulaz:

```text
neto = 800
```

Formula:

```text
bruto = (800 - 63) / 0.805
```

Očekivano:

```text
bruto = 915.53
```

#### Test 4 — neto 1200 u bruto

Ulaz:

```text
neto = 1200
```

Formula:

```text
bruto = (1200 - 123) / 0.745
```

Očekivano:

```text
bruto = 1445.64
```

#### Test 5 — pola radnog vremena

Ulaz:

```text
ugovoreni neto = 600
fond sati = 176
sati radnika = 88
```

Očekivano:

```text
neto za obračun = 300
bruto se računa iz 300 po prvom razredu
```

---

### 14. Prompt za Codex — dopuna bruto/neto

```text
Dopuni modul plata preračunom bruto-neto i neto-bruto.

Sistem mora podržati:
- bruto u neto obračun
- neto u bruto obračun
- poreske razrede
- doprinose zaposlenog
- doprinose poslodavca
- prirez po opštini ako se koristi
- puno i nepuno radno vrijeme
- minuli rad sa podešavanjem načina obračuna

Za trenutna pravila koristi početne šifarnike:
- doprinosi zaposlenog: PIO 10%, nezaposlenost 0.5%
- porez: 0% do 700 bruto, 9% od 700.01 do 1000 bruto, 15% preko 1000 bruto

Bruto → neto:
- doprinosi_zaposleni = bruto * 10.5%
- porez = 0 ako bruto <= 700
- porez = (bruto - 700) * 9% ako je bruto između 700 i 1000
- porez = 27 + (bruto - 1000) * 15% ako je bruto preko 1000
- neto = bruto - doprinosi_zaposleni - porez

Neto → bruto:
- ako neto <= 626.50: bruto = neto / 0.895
- ako neto > 626.50 i neto <= 868.00: bruto = (neto - 63) / 0.805
- ako neto > 868.00: bruto = (neto - 123) / 0.745

Ove formule ne smiju biti hardkodirane kao trajna poslovna logika, nego moraju biti izvedene iz šifarnika stopa i poreskih razreda sa datumom važenja.

Dodaj testove za:
- neto 600 -> bruto 670.39
- bruto 670.39 -> neto 600
- neto 800 -> bruto 915.53
- neto 1200 -> bruto 1445.64
- pola radnog vremena 88/176
```

---
