// Email notifications over SMTP (works with Gmail app passwords, SendGrid SMTP,
// Mailgun SMTP, etc.). Disabled by default; enabled + configured from Settings.

import nodemailer from "nodemailer";
import { getConfig, getSmtpPass } from "../config/store.js";

export function emailConfigured(): boolean {
  const { email } = getConfig().settings;
  return Boolean(email.enabled && email.host && email.user && email.to && getSmtpPass());
}

function transport() {
  const { email } = getConfig().settings;
  return nodemailer.createTransport({
    host: email.host,
    port: email.port,
    secure: email.secure,
    auth: { user: email.user, pass: getSmtpPass() },
  });
}

export async function sendEmail(subject: string, html: string, text?: string): Promise<void> {
  const { email } = getConfig().settings;
  const from = email.from || email.user;
  await transport().sendMail({
    from,
    to: email.to,
    subject,
    text: text ?? html.replace(/<[^>]+>/g, " "),
    html,
  });
}

/** Send a test email to confirm SMTP settings are valid. */
export async function testEmail(): Promise<{ ok: true; to: string }> {
  const { email } = getConfig().settings;
  await sendEmail(
    "KeelCat — test notification",
    `<p>This is a test email from <b>KeelCat</b>. Your SMTP settings are working.</p>`
  );
  return { ok: true, to: email.to };
}
