import "server-only";

import { env } from "cloudflare:workers";

type RuntimeEnv = Cloudflare.Env & {
  EMAIL_FROM?: string;
};

function runtimeEnv(): RuntimeEnv {
  return env as RuntimeEnv;
}

export function isEmailConfigured(): boolean {
  return Boolean(runtimeEnv().EMAIL_FROM);
}

function getFromAddress(): { email: string; name: string } {
  const email = runtimeEnv().EMAIL_FROM;
  if (!email) {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }
  return { email, name: "BoardOps" };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendOrLog(message: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  if (!isEmailConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[email:dev]", {
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      return;
    }
    throw new Error("EMAIL_NOT_CONFIGURED");
  }

  await env.EMAIL.send({
    from: getFromAddress(),
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

export async function sendOtpEmail(
  to: string,
  otp: string,
  purpose: string = "login"
): Promise<void> {
  const isPasswordReset = purpose === "password-reset" || purpose === "reset";
  const title = isPasswordReset ? "Reset your password" : "Verify it's you";
  const subject = isPasswordReset
    ? `Use ${otp} to reset your BoardOps password`
    : `Use ${otp} as your BoardOps verification code`;
  const text = [
    title,
    "",
    `Your verification code is ${otp}.`,
    "",
    "This code expires shortly. Do not share it with anyone.",
    "",
    "If you did not request this, you can ignore this message.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#fff;font-family:Arial,sans-serif;color:#202124">
    <div style="max-width:480px;margin:0 auto;padding:40px 20px">
      <div style="font-size:26px;font-weight:600;margin-bottom:24px">BoardOps</div>
      <h1 style="font-size:24px;font-weight:500;margin:0 0 16px">${title}</h1>
      <p style="font-size:14px;line-height:1.6;color:#5f6368;margin:0 0 24px">Use the code below to continue.</p>
      <div style="font-size:34px;font-weight:600;letter-spacing:.18em;padding:20px 0">${otp}</div>
      <p style="font-size:13px;line-height:1.6;color:#5f6368;margin:20px 0 0">This code expires shortly. Do not share it with anyone. If you did not request this, you can ignore this message.</p>
    </div>
  </body>
</html>`;

  await sendOrLog({ to, subject, text, html });
}

export async function sendNotificationEmail(
  to: string,
  subject: string,
  body: string
): Promise<void> {
  const safeSubject = subject.trim().slice(0, 200);
  const safeBody = escapeHtml(body).replaceAll("\n", "<br>");

  await sendOrLog({
    to,
    subject: safeSubject,
    text: body,
    html: `<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;color:#202124"><div style="max-width:600px;margin:0 auto;padding:32px 20px"><h1 style="font-size:22px">${escapeHtml(safeSubject)}</h1><p style="font-size:14px;line-height:1.7">${safeBody}</p><hr style="border:0;border-top:1px solid #e5e7eb;margin:28px 0"><p style="font-size:12px;color:#6b7280">BoardOps automated notification</p></div></body></html>`,
  });
}
