# SSH tunel za PostgreSQL

Ovu komandu pokrenuti u lokalnom terminalu prije rada sa bazom:

```powershell
ssh -N -L 5433:127.0.0.1:5432 -o ExitOnForwardFailure=yes deploy@185.102.78.178
```

Kada SSH pita lozinku, unijeti SSH lozinku za korisnika `deploy`.

Ako terminal poslije unosa lozinke samo stoji bez dodatnog ispisa, to znaci da tunel radi.

Dok je tunel aktivan, lokalna aplikacija vidi PostgreSQL bazu na:

```text
127.0.0.1:5433
```

Lokalni `.env` treba da koristi:

```env
DATABASE_URL="postgresql://zeljko:POSTGRES_LOZINKA@127.0.0.1:5433/knjigovodstvoonline"
```

Tunel se zaustavlja sa `Ctrl + C` u terminalu gdje je pokrenut.
