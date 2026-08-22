import nodemailer from "nodemailer";

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} nije podesen u .env fajlu.`);
  }

  return value;
}

function createSmtpTransporter() {
  return nodemailer.createTransport({
    host: getRequiredEnv("SMTP_HOST"),
    port: Number(getRequiredEnv("SMTP_PORT")),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: getRequiredEnv("SMTP_USER"),
      pass: getRequiredEnv("SMTP_PASS")
    }
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendInvitationEmail({
  to,
  korisnickoIme,
  inviteUrl
}: {
  to: string;
  korisnickoIme: string;
  inviteUrl: string;
}) {
  const transporter = createSmtpTransporter();

  await transporter.sendMail({
    from: getRequiredEnv("SMTP_FROM"),
    to,
    subject: "Pozivnica za Summa Summarum",
    text: [
      "Pozdrav,",
      "",
      "Kreiran vam je korisnicki nalog za Summa Summarum.",
      `Korisnicko ime: ${korisnickoIme}`,
      "",
      "Lozinku postavljate preko ovog linka:",
      inviteUrl,
      "",
      "Link vazi 7 dana. Ako niste ocekivali ovu poruku, mozete je ignorisati.",
      "",
      "Summa Summarum"
    ].join("\n"),
    html: `
      <p>Pozdrav,</p>
      <p>Kreiran vam je korisnicki nalog za <strong>Summa Summarum</strong>.</p>
      <p><strong>Korisnicko ime:</strong> ${korisnickoIme}</p>
      <p>Lozinku postavljate preko ovog linka:</p>
      <p><a href="${inviteUrl}">${inviteUrl}</a></p>
      <p>Link vazi 7 dana. Ako niste ocekivali ovu poruku, mozete je ignorisati.</p>
      <p>Summa Summarum</p>
    `
  });
}

export async function sendFiscalAgencyTransferRequestEmail({
  companyName,
  companyPib,
  agencyName,
  requestedBy
}: {
  companyName: string;
  companyPib: string;
  agencyName: string;
  requestedBy: string;
}) {
  const transporter = createSmtpTransporter();
  const recipient =
    process.env.FISCAL_TRANSFER_NOTIFICATION_EMAIL ?? "zeljkodj@t-com.me";
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const reviewUrl = new URL("/admin/fiskalizacija/korisnici", appUrl).toString();
  const safeCompany = escapeHtml(companyName);
  const safePib = escapeHtml(companyPib);
  const safeAgency = escapeHtml(agencyName);
  const safeUser = escapeHtml(requestedBy);
  const safeReviewUrl = escapeHtml(reviewUrl);

  await transporter.sendMail({
    from: getRequiredEnv("SMTP_FROM"),
    to: recipient,
    subject: `Zahtjev za povezivanje firme ${companyName} sa agencijom`,
    text: [
      "Pojavio se novi zahtjev za povezivanje fiskalnog klijenta sa knjigovodstvenom agencijom.",
      "",
      `Firma: ${companyName}`,
      `PIB: ${companyPib}`,
      `Ciljna agencija: ${agencyName}`,
      `Zahtjev poslao: ${requestedBy}`,
      "",
      "Zahtjev možete pregledati i odobriti ili odbiti ovdje:",
      reviewUrl,
      "",
      "Summa Summarum"
    ].join("\n"),
    html: `
      <p>Pojavio se novi zahtjev za povezivanje fiskalnog klijenta sa knjigovodstvenom agencijom.</p>
      <p><strong>Firma:</strong> ${safeCompany}<br />
      <strong>PIB:</strong> ${safePib}<br />
      <strong>Ciljna agencija:</strong> ${safeAgency}<br />
      <strong>Zahtjev poslao:</strong> ${safeUser}</p>
      <p><a href="${safeReviewUrl}">Pregledaj zahtjev u administratorskom panelu</a></p>
      <p>Summa Summarum</p>
    `
  });
}
