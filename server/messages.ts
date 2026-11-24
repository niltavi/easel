// User-facing messages returned by the API, in the languages the web app offers.
// The app sends its language in the accept-language header; English is the default.

export type Lang = "en" | "zh-CN";

export const langOf = (header: string | undefined): Lang => (header?.trim().toLowerCase().startsWith("zh") ? "zh-CN" : "en");

const messages = {
  serverError: ["The service is temporarily unavailable", "服务暂时不可用"],
  tooLarge: ["The content is too large", "内容太大"],
  invalidEmail: ["Enter a valid email address", "请输入有效的邮箱地址"],
  codeJustSent: ["A code was just sent. Try again in a moment", "验证码刚刚发送过，请稍后再试"],
  codeNotSent: ["The code could not be sent. Try again later", "验证码没有发出去，请稍后再试"],
  codeIncorrect: ["That code is not correct", "验证码不正确"],
  codeExpired: ["That code is no longer valid. Request a new one", "验证码已失效，请重新获取"],
  passwordRule: ["Use a password of 8 to 128 characters", "密码长度需为 8 到 128 个字符"],
  emailTaken: ["An account with this email already exists. Sign in instead", "这个邮箱已注册，请直接登录"],
  identityUnavailable: ["The sign-in service is temporarily unavailable", "登录服务暂时不可用"],
  invalidCredentials: ["Email or password is incorrect", "邮箱或密码不正确"],
  tooManyAttempts: ["Too many attempts. Try again in a few minutes", "尝试次数过多，请过几分钟再试"],
  sessionExpired: ["Your sign-in has expired", "登录已过期"],
  workNotFound: ["This work could not be found", "找不到这件作品"],
  workGone: ["The cloud copy of this work has been removed", "这件作品的云端副本已移除"],
  incompleteRequest: ["The request is incomplete", "请求内容不完整"],
  workTooLarge: ["This work is too large to sync", "作品太大，无法同步"],
  newerVersion: ["The cloud has a newer version", "云端已有更新的版本"],
  promptRequired: ["Describe the change you want", "请输入要做的修改"],
  diagramInvalid: ["The diagram is invalid or has more than {max} objects", "结构图无效，或超过 {max} 个对象"],
  quotaExhausted: ["You have used all of today's AI requests", "今天的 AI 次数已用完"],
  previousInProgress: ["The previous request is still in progress", "上一条指令还在处理中"],
  endpointNotFound: ["Endpoint not found", "接口不存在"],
  aiUnavailable: ["AI is temporarily unavailable", "AI 暂时不可用"],
  aiBusy: ["AI is busy. Try again later", "AI 正忙，请稍后再试"],
  aiTimeout: ["AI took too long to respond. Try again", "AI 响应超时，请再试一次"],
  aiEmpty: ["AI did not suggest a usable change. Try rephrasing", "AI 没有给出可用的改动，换个说法再试试"],
  aiUnusable: ["The suggested change could not be applied. Try again", "AI 给出的改动无法应用，请再试一次"],
  aiUnrecognized: ["The AI response could not be understood", "AI 返回的内容无法识别"],
  aiRefused: ["AI could not handle this request", "AI 无法处理这条指令"],
  aiTooBig: ["This change is too large. Try describing it in smaller steps", "这次改动太大，试着分几步描述"],
  identityNoEmail: ["The Identity account has no email address", "Identity 账号没有邮箱地址"],
  identityDenied: ["Sign-in was cancelled", "登录已取消"],
  identityExpired: ["The sign-in link has expired. Try again", "登录链接已过期，请重试"],
  identityFailed: ["Sign-in failed. Try again", "登录失败，请重试"],
  mailSubject: ["{code} is your Easel sign-in code", "{code} 是你的 Easel 登录验证码"],
  mailBody: [
    "Your Easel sign-in code is {code}. It is valid for 10 minutes.\n\nIf you did not request it, you can ignore this email.",
    "你的 Easel 登录验证码是 {code}，10 分钟内有效。\n\n如果这不是你本人的操作，忽略这封邮件即可。",
  ],
} as const satisfies Record<string, readonly [string, string]>;

export type MessageKey = keyof typeof messages;

export function message(lang: Lang, key: MessageKey, params: Record<string, string | number> = {}): string {
  const text: string = messages[key][lang === "en" ? 0 : 1];
  return text.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ""));
}
