import nodemailer from "nodemailer";

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} nije podesen u .env fajlu.`);
  }

  return value;
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
  const transporter = nodemailer.createTransport({
    host: getRequiredEnv("SMTP_HOST"),
    port: Number(getRequiredEnv("SMTP_PORT")),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: getRequiredEnv("SMTP_USER"),
      pass: getRequiredEnv("SMTP_PASS")
    }
  });

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
