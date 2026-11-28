import {readFileSync} from "node:fs";
import type {Plugin} from "vite";
import {themeInitialization} from "../src/vendor/niltavi-ui/theme.ts";
import {siteCopy} from "../src/site/content.ts";
import {locales, pageHref, publicOrigin, repository, route, type Locale} from "../src/site/routes.ts";

// The agent installation guide, also served from the site in case GitHub is unreachable.
const agentGuide = () => readFileSync(new URL("../docs/en/for-agents.md", import.meta.url), "utf8");

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

function home(locale: Locale) {
  const copy = siteCopy[locale];
  const other = locale === "en" ? "zh-CN" : "en";
  return `<header class="niltavi-product-header easel-site-header">
    <div class="niltavi-product-header__inner niltavi-container">
      <a class="niltavi-project-brand" aria-label="Easel" href="${pageHref("home", locale)}"><span class="niltavi-project-brand__symbol" aria-hidden="true"><img src="/favicon.svg" width="40" height="40" alt=""></span><span class="niltavi-project-brand__name">Easel</span></a>
      <nav aria-label="${copy.navigation}" class="easel-site-nav flex items-center gap-1">
        <a class="button button--sm button--secondary" aria-current="page" href="${pageHref("home", locale)}">${copy.home}</a>
        <a class="button button--sm button--ghost" href="${pageHref("self-host", locale)}">${copy["self-host"]}</a>
      </nav>
      <nav class="niltavi-product-header__actions">
        <a class="button button--sm button--secondary" href="${pageHref("login", locale)}">${copy.signIn}</a>
        <a lang="${other}" hreflang="${other}" href="${pageHref("home", other)}">${other === "en" ? "English" : "简体中文"}</a>
        <a href="${repository}">GitHub</a>
      </nav>
    </div>
  </header>
  <main class="niltavi-container grid flex-1 content-center gap-8 py-12 sm:py-16 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-center lg:gap-16">
    <div class="grid max-w-2xl gap-6">
      <h1 class="text-balance text-4xl font-medium tracking-tight sm:text-5xl lg:text-6xl">${copy.heading}</h1>
      <p class="max-w-lg text-pretty text-lg/relaxed text-muted">${copy.description}</p>
      <div class="flex flex-wrap items-center gap-3">
        <a class="button button--primary" href="${pageHref("app", locale)}">${copy.open}</a>
        <a class="button button--secondary" href="${pageHref("self-host", locale)}">${copy["self-host"]}</a>
      </div>
    </div>
    <img class="order-first w-36 justify-self-center sm:w-44 md:order-none md:w-full md:max-w-xs" src="/easel-logo-color.png" width="1000" height="1000" alt="">
  </main>
  <footer class="niltavi-product-footer niltavi-container">
    <a href="https://niltavi.com/" aria-label="Niltavi"><img class="niltavi-product-footer__light" src="/niltavi-logo-light.svg" width="75" height="28" alt=""><img class="niltavi-product-footer__dark" src="/niltavi-logo-dark.svg" width="75" height="28" alt=""></a>
  </footer>`;
}

export function siteHtml(): Plugin {
  const rewrite = (req: {url?: string}, res: {setHeader(name: string, value: string): void; end(body: string): void}, next: () => void) => {
    const url = new URL(req.url ?? "/", publicOrigin);
    if (url.pathname === "/for-agents.md") {
      res.setHeader("content-type", "text/markdown; charset=utf-8");
      return res.end(agentGuide());
    }
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
        .replace("<!-- theme-init -->", () => `<script>${themeInitialization}window.EXCALIDRAW_ASSET_PATH = "/";</script>`)
        .replace("<!-- static-content -->", () => isHome ? home(locale) : "");
    },
    generateBundle() {
      this.emitFile({type: "asset", fileName: "for-agents.md", source: agentGuide()});
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locales.map((locale) => `  <url><loc>${publicOrigin}${pageHref("home", locale)}</loc></url>`).join("\n")}\n</urlset>\n`,
      });
    },
  };
}
