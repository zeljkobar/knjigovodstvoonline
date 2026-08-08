# DEPLOYMENT.md

## 1. Produkcioni deployment za trenutni server

Konkretna, izvršiva konfiguracija nalazi se u [`../deploy/README.md`](../deploy/README.md). Za server `185.102.78.178` koriste se postojeći host PostgreSQL 16 i Nginx/Certbot. U Dockeru rade Fiscal API, Worker i backup proces. API je vezan samo za `127.0.0.1:8585`, a javna adresa je `https://fiscal.summasummarum.me`.

PostgreSQL se ne pokreće u Dockeru i port `5432` se ne otvara internetu. Fiskalni sertifikat, vault master ključ, lozinke i API ključevi ostaju van Git-a i Docker image-a.

Javni health endpoint je `https://fiscal.summasummarum.me/health`. Početna ruta `/` trenutno nema HTML aplikaciju i očekivano vraća `404`. Budući klijentski portal može koristiti isti domen ili `knjigovodstvo.summasummarum.me`, ali browser ne smije direktno dobiti sistemski API ključ: portal mora pozivati Fiscal API preko svoje serverske komponente i provjeravati korisnika, firmu i dozvole.

## 2. Opšta preporuka

- Linux VPS
- Docker
- PostgreSQL
- Redis
- Nginx reverse proxy
- HTTPS obavezno

## 3. Okruženja

```text
Development
Testing
Staging
Production
```

## 4. Varijable okruženja

- DATABASE_URL
- REDIS_URL
- JWT_SECRET
- CERTIFICATE_STORAGE_KEY
- PU_TEST_ENDPOINT
- PU_PRODUCTION_ENDPOINT

## 5. Backup

- dnevni backup baze
- backup sertifikata
- backup request/response logova
- odvojeno čuvanje produkcionih tajni
