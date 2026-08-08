# OFFICIAL_PU_DOCUMENTATION_NOTES.md

## Zvanični izvori

Za razvoj fiskalnog modula koriste se zvanični izvori Poreske uprave / gov.me:

- Elektronska fiskalizacija - Poreska uprava
- Testni SEP
- Produkcioni SEP
- Funkcionalna specifikacija v5
- Tehnička specifikacija v5
- Pravilnici objavljeni u sekciji Legislativa

## Važna napomena

Repozitorijum sadrži lokalnu kopiju korišćene zvanične EFI v5 DOCX/XSD/WSDL dokumentacije u:

```text
docs/official_pu_v5/
```

Trenutno sačuvani izvori:

```text
Fiskalni_servis_Funkcionalna_specifikacija_v5_final.docx
Fiskalni_servis_Tehnicka_specifikacija_v5_final.docx
FiscalService_v5_official.xsd
FiscalService_v5_official.wsdl
```

## Pravilo za Codex

Codex ne smije izmisliti nijedan tehnički detalj koji pripada zvaničnoj specifikaciji. Ako nema lokalnog XSD/WSDL fajla, mora napraviti TODO i ostaviti jasnu oznaku `TO_BE_FILLED_FROM_OFFICIAL_SPEC`.
