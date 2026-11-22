import type {Plugin} from "vite";
import {siteCopy} from "../src/site/content.ts";
import {locales, pageHref, publicOrigin, repository, route, type Locale} from "../src/site/routes.ts";

const themeScript = `(() => {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    let theme;
    try { theme = localStorage.getItem("easel.theme"); } catch {}
    document.documentElement.dataset.theme = theme === "light" || theme === "dark"
      ? theme : media.matches ? "dark" : "light";
  };
  apply();
  media.addEventListener("change", () => {
    try { if (["light", "dark"].includes(localStorage.getItem("easel.theme"))) return; } catch {}
    document.documentElement.dataset.theme = media.matches ? "dark" : "light";
  });
  window.EXCALIDRAW_ASSET_PATH = "/";
})();`;

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

function home(locale: Locale) {
  const copy = siteCopy[locale];
  const other = locale === "en" ? "zh-CN" : "en";
  return `<header class="site-header">
    <div class="site-container site-header-inner">
      <a class="site-brand" href="${pageHref("home", locale)}"><img src="/favicon.svg" width="40" height="40" alt=""><span>Easel</span></a>
      <nav class="site-controls">
        <a href="${pageHref("login", locale)}">${copy.signIn}</a>
        <a lang="${other}" hreflang="${other}" href="${pageHref("home", other)}">${other === "en" ? "English" : "简体中文"}</a>
        <a href="${repository}">GitHub</a>
      </nav>
    </div>
  </header>
  <main class="site-container site-intro">
    <h1>${copy.heading}</h1>
    <p>${copy.description}</p>
    <div class="site-actions">
      <a class="button button--primary" href="${pageHref("app", locale)}">${copy.open}</a>
      <a class="button button--secondary" href="${repository}/blob/main/docs/en/for-agents.md">${copy.install}</a>
    </div>
  </main>
  <footer class="site-container site-footer">
    <a href="https://niltavi.com/"><img class="site-wordmark--light" src="/niltavi-logo-light.svg" width="72" height="26" alt="Niltavi"><img class="site-wordmark--dark" src="/niltavi-logo-dark.svg" width="72" height="26" alt="Niltavi"></a>
  </footer>`;
}

export function siteHtml(): Plugin {
  const rewrite = (req: {url?: string}, _res: unknown, next: () => void) => {
    const url = new URL(req.url ?? "/", publicOrigin);
    const page = route(url.pathname);
    if (page?.page === "home") req.url = (page.locale === "en" ? "/index.html" : "/zh/index.html") + url.search;
    else if (page) req.url = "/app/index.html" + url.search;
    next();
  };
  return {
    name: "easel-page-shells",
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
    transformIndexHtml(html, context) {
      const locale = context.path.startsWith("/zh/") ? "zh-CN" : "en";
      const isHome = !context.path.startsWith("/app/");
      const copy = siteCopy[locale];
      const metadata = isHome
        ? `<title>${copy.title}</title>
    <meta name="description" content="${escape(copy.description)}">
    <link rel="canonical" href="${publicOrigin}${pageHref("home", locale)}">
    ${[...locales, "x-default"].map((lang) => `<link rel="alternate" hreflang="${lang}" href="${publicOrigin}${pageHref("home", lang === "zh-CN" ? lang : "en")}">`).join("\n    ")}`
        : '<title>Easel</title><meta name="robots" content="noindex">';
      return html.replace('lang="en"', `lang="${locale}"`)
        .replace("<!-- page-metadata -->", metadata)
        .replace("<!-- theme-init -->", () => `<script>${themeScript}</script>`)
        .replace("<!-- static-content -->", () => isHome ? home(locale) : "");
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locales.map((locale) => `  <url><loc>${publicOrigin}${pageHref("home", locale)}</loc></url>`).join("\n")}\n</urlset>\n`,
      });
    },
  };
}
