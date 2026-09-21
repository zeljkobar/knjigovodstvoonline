import nodemailer from "nodemailer";
import { createPublicAppUrl } from "@/lib/app-url";

export const SYSTEM_EMAIL_FROM_ADDRESS = "admin@summasummarum.me";
export const SYSTEM_EMAIL_FROM = `Summa Summarum <${SYSTEM_EMAIL_FROM_ADDRESS}>`;

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
  inviteUrl,
  replyTo
}: {
  to: string;
  korisnickoIme: string;
  inviteUrl: string;
  replyTo?: string | null;
}) {
  const transporter = createSmtpTransporter();

  await transporter.sendMail({
    from: SYSTEM_EMAIL_FROM,
    replyTo: replyTo || undefined,
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

export async function sendAgencyEmailTest({
  to,
  agencyName
}: {
  to: string;
  agencyName: string;
}) {
  const transporter = createSmtpTransporter();
  const safeAgencyName = escapeHtml(agencyName);

  await transporter.sendMail({
    from: SYSTEM_EMAIL_FROM,
    replyTo: to,
    to,
    subject: "Proba email podešavanja — Summa Summarum",
    text: [
      `Pozdrav, ${agencyName}.`,
      "",
      "Ovo je probna poruka iz računovodstvenog programa Summa Summarum.",
      `Poruka je poslata sa ${SYSTEM_EMAIL_FROM_ADDRESS}, a odgovori idu na ${to}.`,
      "",
      "Summa Summarum"
    ].join("\n"),
    html: `
      <p>Pozdrav, <strong>${safeAgencyName}</strong>.</p>
      <p>Ovo je probna poruka iz računovodstvenog programa Summa Summarum.</p>
      <p>Poruka je poslata sa <strong>${SYSTEM_EMAIL_FROM_ADDRESS}</strong>, a odgovori idu na <strong>${escapeHtml(to)}</strong>.</p>
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
  const reviewUrl = createPublicAppUrl("/admin/fiskalizacija/korisnici").toString();
  const safeCompany = escapeHtml(companyName);
  const safePib = escapeHtml(companyPib);
  const safeAgency = escapeHtml(agencyName);
  const safeUser = escapeHtml(requestedBy);
  const safeReviewUrl = escapeHtml(reviewUrl);

  await transporter.sendMail({
    from: SYSTEM_EMAIL_FROM,
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
