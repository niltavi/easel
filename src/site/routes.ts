export type Locale = "en" | "zh-CN";
export type Page = "home" | "app" | "login" | "register" | "admin" | "self-host";

export const locales = ["en", "zh-CN"] as const;
export const repository = "https://github.com/niltavi/easel";
export const publicOrigin = "https://easel.niltavi.com";

export function route(pathname: string): {page: Page; locale: Locale} | undefined {
  const path = pathname.replace(/\/$/, "");
  const chinese = path === "/zh" || path.startsWith("/zh/");
  const pagePath = chinese ? path.slice(3) : path;
  const locale = chinese ? "zh-CN" : "en";
  if (pagePath === "") return {page: "home", locale};
  if (pagePath === "/app" || pagePath === "/login" || pagePath === "/register" || pagePath === "/self-host") {
    return {page: pagePath.slice(1) as Exclude<Page, "home">, locale};
  }
  if (pagePath === "/admin" || pagePath.startsWith("/admin/")) return {page: "admin", locale};
}

export function pageHref(page: Page, locale: Locale): string {
  const base = locale === "zh-CN" ? "/zh" : "";
  return page === "home" ? base + "/" : base + "/" + page;
}

/** Sections of the administrator console. */
export const adminSections = ["overview", "sign-in", "sign-in/identity", "accounts", "general"] as const;
export type AdminSection = (typeof adminSections)[number];

export function adminSectionOf(pathname: string): AdminSection {
  const match = pathname.replace(/\/$/, "").match(/\/admin(?:\/([\w-]+(?:\/[\w-]+)?))?$/);
  const section = match?.[1] ?? "overview";
  return (adminSections as readonly string[]).includes(section) ? (section as AdminSection) : "overview";
}

export function adminHref(section: AdminSection, locale: Locale): string {
  const base = locale === "zh-CN" ? "/zh" : "";
  return `${base}/admin${section === "overview" ? "" : `/${section}`}`;
}
