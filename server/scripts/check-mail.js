require('dotenv').config();
const nodemailer = require('nodemailer');

async function main() {
  const host = process.env.SMTP_HOST || 'smtp.resend.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || 'resend';
  const pass = process.env.SMTP_PASS || '';
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const from = process.env.EMAIL_FROM || '';

  if (!pass) {
    throw new Error('SMTP_PASS is missing in server .env');
  }
  if (!from) {
    throw new Error('EMAIL_FROM is missing in server .env');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  await transporter.verify();
  console.log('Mail transport verified successfully.');
  console.log(`Host: ${host}`);
  console.log(`Port: ${port}`);
  console.log(`User: ${user}`);
  console.log(`From: ${from}`);
}

main().catch((err) => {
  console.error('Mail transport verification failed:', err.message || err);
  process.exit(1);
});
