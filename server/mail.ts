import nodemailer from "nodemailer";
import {message, type Lang} from "./messages.ts";

export type Mailer = (email: string, code: string, lang: Lang) => Promise<void>;

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
  return async (email, code, lang) => {
    await transport.sendMail({
      from,
      to: email,
      subject: message(lang, "mailSubject", {code}),
      text: message(lang, "mailBody", {code}),
    });
  };
}
