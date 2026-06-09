-- AlterTable
ALTER TABLE "korisnici" ADD COLUMN "email" TEXT;

-- CreateTable
CREATE TABLE "pozivnice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "korisnik_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "iskorisceno_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pozivnice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "korisnici_email_key" ON "korisnici"("email");

-- CreateIndex
CREATE UNIQUE INDEX "pozivnice_token_hash_key" ON "pozivnice"("token_hash");

-- AddForeignKey
ALTER TABLE "pozivnice" ADD CONSTRAINT "pozivnice_korisnik_id_fkey" FOREIGN KEY ("korisnik_id") REFERENCES "korisnici"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
