import nodemailer from "nodemailer";

/**
 * Email service for BoardOps.
 *
 * Reads SMTP configuration from environment variables. If not configured,
 * falls back to "dev mode" — logs the email content (including OTP) to the
 * console so the system works without an SMTP server (for development/testing).
 *
 * To enable production email sending, set these in .env:
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_USER=your-email@gmail.com
 *   SMTP_PASS=your-app-password
 *   SMTP_FROM=BoardOps <your-email@gmail.com>
 *
 * Deliverability tips (to avoid spam):
 *  - The "From" address MUST match the SMTP_USER (Gmail enforces this).
 *  - We set Reply-To, Message-ID, Date, and X-Auto-Response-Suppress headers.
 *  - We include both plain-text and HTML versions.
 *  - We use a clear, non-spammy subject line.
 *  - For best results, add SPF/DKIM/DMARC records if using a custom domain.
 */

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null; // dev mode
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return transporter;
}

/** Is real SMTP configured? If false, emails are logged to console (dev mode).
 *
 *  Required env vars: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`. `SMTP_PORT`
 *  defaults to 587 (STARTTLS) and `SMTP_FROM` defaults to a no-reply address,
 *  so neither is required for email to be considered "configured".
 *
 *  Pure check — does NOT initialize the transporter. The transporter is built
 *  lazily on the first `sendOtpEmail` / `sendNotificationEmail` call (which
 *  also caches it for subsequent calls). */
export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** Get the configured "from" address, or a dev-mode fallback. */
function getFromAddress(): string {
  return process.env.SMTP_FROM || "BoardOps <noreply@boardops.local>";
}

/** Get the reply-to address (defaults to the SMTP user). */
function getReplyTo(): string {
  return process.env.SMTP_USER || "noreply@boardops.local";
}

/** Generate a unique Message-ID for email threading/deliverability. */
function generateMessageId(): string {
  const domain = (process.env.SMTP_USER || "boardops.local").split("@")[1] || "boardops.local";
  const random = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return `<${random}@${domain}>`;
}

export async function sendOtpEmail(to: string, otp: string, purpose: string = "login"): Promise<void> {
  const t = getTransporter();
  const subject = purpose === "login"
    ? `Use ${otp} as your BoardOps verification code`
    : `Use ${otp} to reset your BoardOps password`;

  const text = [
    `BoardOps verification`,
    ``,
    `Use ${otp} as your verification code.`,
    ``,
    `This code will expire in 5 minutes.`,
    ``,
    `If you didn't request this, you can safely ignore this email.`,
    ``,
    `© ${new Date().getFullYear()} BoardOps`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>BoardOps Verification</title>
</head>
<body style="margin:0;padding:0;background:#FFFFFF;font-family:'Google Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Use ${otp} as your BoardOps verification code.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="460" cellpadding="0" cellspacing="0" style="max-width:460px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <span style="font-size:28px;">✨</span>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td align="center" style="padding-bottom:8px;">
              <h1 style="font-size:24px;font-weight:400;color:#202124;margin:0;letter-spacing:-0.01em;">
                ${purpose === "login" ? "Verify it's you" : "Reset your password"}
              </h1>
            </td>
          </tr>

          <!-- Separator -->
          <tr>
            <td style="padding:16px 0;">
              <hr style="border:none;border-top:1px solid #E8EAED;margin:0;" />
            </td>
          </tr>

          <!-- Body text -->
          <tr>
            <td style="padding:0 8px 24px;">
              <p style="font-size:14px;line-height:1.6;color:#3C4043;margin:0 0 16px;">
                ${purpose === "login"
                  ? "A sign-in attempt requires verification with your BoardOps code."
                  : "Use this code to reset your BoardOps password."}
              </p>
            </td>
          </tr>

          <!-- Code -->
          <tr>
            <td align="center" style="padding:8px 8px 32px;">
              <p style="font-size:32px;font-weight:500;color:#202124;margin:0;letter-spacing:0.15em;font-family:'SF Mono','Fira Code','Courier New',monospace;">
                ${otp}
              </p>
            </td>
          </tr>

          <!-- Expiry -->
          <tr>
            <td style="padding:0 8px 8px;">
              <p style="font-size:13px;color:#5F6368;margin:0;">
                This code will expire in <strong style="color:#3C4043;">5 minutes</strong>.
              </p>
            </td>
          </tr>

          <!-- Security note -->
          <tr>
            <td style="padding:8px 8px 24px;">
              <p style="font-size:13px;color:#5F6368;margin:0;">
                If you didn't request this code, you can safely ignore this email. Someone may have entered your email by mistake.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 8px 0;border-top:1px solid #E8EAED;">
              <p style="font-size:12px;color:#9AA0A6;margin:0;text-align:center;line-height:1.6;">
                © ${new Date().getFullYear()} BoardOps · Secure Operations Platform<br/>
                This is an automated message — please do not reply.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (!t) {
    // Dev mode — log to console (only in non-production)
    if (process.env.NODE_ENV !== "production") {
      console.log("\n📧 ───────────────────────────────────");
      console.log(`   TO: ${to}`);
      console.log(`   SUBJECT: ${subject}`);
      console.log(`   OTP CODE: ${otp}`);
      console.log("📧 ───────────────────────────────────\n");
    }
    return;
  }

  await t.sendMail({
    from: getFromAddress(),
    to,
    replyTo: getReplyTo(),
    subject,
    text,
    html,
    headers: {
      "Message-ID": generateMessageId(),
      "X-Auto-Response-Suppress": "All",
      "X-Priority": "1 (Highest)",
      "X-MS-Exchange-Organization-AuthAs": "Internal",
    },
    date: new Date(),
  });
}

export async function sendNotificationEmail(to: string, subject: string, body: string): Promise<void> {
  const t = getTransporter();
  if (!t) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`\n📧 [DEV] TO: ${to} | SUBJECT: ${subject} | BODY: ${body}\n`);
    }
    return;
  }
  await t.sendMail({
    from: getFromAddress(),
    to,
    replyTo: getReplyTo(),
    subject,
    text: body,
    headers: {
      "Message-ID": generateMessageId(),
      "X-Auto-Response-Suppress": "All",
    },
    date: new Date(),
  });
}
