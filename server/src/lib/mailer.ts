import nodemailer from "nodemailer";
import { env } from "../config/env";

const transporter = env.smtp.host
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null;

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  if (!transporter) {
    console.log(`\n[mail:console] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  await transporter.sendMail({ from: env.smtp.from, to, subject, text, html });
}

export function emailLayout(title: string, body: string, ctaLabel?: string, ctaUrl?: string) {
  const cta = ctaUrl
    ? `<p style="margin:28px 0"><a href="${ctaUrl}" style="background:#0f1f3d;color:#fff;padding:12px 22px;text-decoration:none;font-weight:600;border-radius:4px">${ctaLabel}</a></p>`
    : "";
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1c2333">
  <div style="border-bottom:3px solid #0f1f3d;padding:16px 0;font-weight:700;letter-spacing:.12em">ZANVAR GROUP · TALENT ASSESSMENT</div>
  <h2 style="margin-top:24px">${title}</h2>${body}${cta}
  <p style="color:#6b7385;font-size:12px;margin-top:32px">This is an automated message from the Zanvar Group Talent Assessment Portal.</p></div>`;
}
