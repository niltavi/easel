export type Locale = "en" | "zh-CN";
export type Page = "home" | "app" | "login" | "register";

export const locales = ["en", "zh-CN"] as const;
export const repository = "https://github.com/niltavi/easel";
export const publicOrigin = "https://easel.niltavi.com";

export function route(pathname: string): {page: Page; locale: Locale} | undefined {
  const path = pathname.replace(/\/$/, "");
  const chinese = path === "/zh" || path.startsWith("/zh/");
  const pagePath = chinese ? path.slice(3) : path;
  const locale = chinese ? "zh-CN" : "en";
  if (pagePath === "") return {page: "home", locale};
  if (pagePath === "/app" || pagePath === "/login" || pagePath === "/register") {
    return {page: pagePath.slice(1) as Exclude<Page, "home">, locale};
  }
}

export function pageHref(page: Page, locale: Locale): string {
  const base = locale === "zh-CN" ? "/zh" : "";
  return page === "home" ? base + "/" : base + "/" + page;
}
