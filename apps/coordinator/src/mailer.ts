import nodemailer from 'nodemailer';
import { env } from './env.ts';

const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth:
        env.SMTP_USER && env.SMTP_PASS
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
    })
  : null;

export async function sendMagicLink(email: string, link: string) {
  if (!transporter) {
    // Dev mode: log the link to console.
    console.log(`\n🔗 Magic link for ${email}:\n   ${link}\n`);
    return;
  }

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject: 'Your Scatter sign-in link',
    text: `Click to sign in: ${link}\n\nThis link expires in ${env.MAGIC_LINK_TTL_MINUTES} minutes.`,
    html: `
      <p>Click to sign in to Scatter:</p>
      <p><a href="${link}">${link}</a></p>
      <p><small>This link expires in ${env.MAGIC_LINK_TTL_MINUTES} minutes.</small></p>
    `,
  });
}
