import nodemailer from "nodemailer";

export type Mailer = (email: string, code: string) => Promise<void>;

/** Sends email when SMTP is configured; otherwise prints the verification code to the server log, for convenient local development. */
export function createMailer(env: NodeJS.ProcessEnv): Mailer {
  const url = env.EASEL_SMTP_URL;
  if (!url) {
    return async (email, code) => {
      console.log(`[easel] sign-in verification code for ${email}: ${code} (EASEL_SMTP_URL is not configured, printing only)`);
    };
  }
  const transport = nodemailer.createTransport(url);
  const from = env.EASEL_MAIL_FROM ?? "Easel <no-reply@localhost>";
  return async (email, code) => {
    await transport.sendMail({
      from,
      to: email,
      subject: `${code} 是你的 Easel 登录验证码`,
      text: `你的 Easel 登录验证码是 ${code}，10 分钟内有效。\n\n如果这不是你本人的操作，忽略这封邮件即可。`,
    });
  };
}
