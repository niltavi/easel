import {Button, Spinner} from "@heroui/react";
import {buttonVariants} from "@heroui/styles";
import {useEffect, useRef, useState} from "react";
import {selectLocale, t} from "../lib/i18n.ts";
import {editor} from "../lib/state.ts";
import {siteCopy} from "./content.ts";
import {pageHref, publicOrigin, repository, route, type Locale} from "./routes.ts";
import {ProductFooter, ProductHeader} from "../vendor/niltavi-ui/ProductHeader.tsx";
import {applyTheme, preferredTheme, systemDarkQuery} from "../vendor/niltavi-ui/theme.ts";
import {toggleTheme, useTheme} from "./theme.ts";

const loadApp = () => import("../components/App.tsx");
const loadAuth = () => import("../components/AuthDialog.tsx");
const loadAdmin = () => import("../admin/AdminPage.tsx");
const readRoute = (url: URL) => route(url.pathname) ?? {page: "home" as const, locale: "en" as const};

function Header({url}: {url: URL}) {
  const {page, locale} = readRoute(url);
  const copy = siteCopy[locale];
  const theme = useTheme();
  const brand = page === "app" ? "app" : "home";
  return (
    <ProductHeader
      variant={page === "app" || page === "admin" ? "app" : "site"}
      brand={{name: "Easel", href: pageHref(brand, locale), symbol: <img src="/favicon.svg" width={40} height={40} alt="" />}}
      theme={theme}
      onToggleTheme={toggleTheme}
      locale={locale}
      locales={[
        {locale: "en", label: "English", href: pageHref(page, "en") + url.search + url.hash},
        {locale: "zh-CN", label: "简体中文", href: pageHref(page, "zh-CN") + url.search + url.hash},
      ]}
      onNavigateLocale={(href) => navigate(href)}
      githubHref={repository}
      signIn={page === "home" ? {href: pageHref("login", locale), label: copy.signIn} : undefined}
      labels={copy}
    />
  );
}

function Home({locale}: {locale: Locale}) {
  const copy = siteCopy[locale];
  return (
    <>
      <main className="niltavi-container site-intro">
        <h1>{copy.heading}</h1>
        <p>{copy.description}</p>
        <div className="site-actions">
          <a className={buttonVariants({variant: "primary"})} href={pageHref("app", locale)}>{copy.open}</a>
          <a className={buttonVariants({variant: "secondary"})} href="/llms.txt">{copy.install}</a>
        </div>
      </main>
      <ProductFooter lightLogo="/niltavi-logo-light.svg" darkLogo="/niltavi-logo-dark.svg" />
    </>
  );
}

export function navigate(href: string, replace = false) {
  if (new URL(href, location.href).href === location.href) return;
  if (replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function Root() {
  const [url, setUrl] = useState(() => new URL(location.href));
  const [App, setApp] = useState<typeof import("../components/App.tsx").App>();
  const [AuthPage, setAuthPage] = useState<typeof import("../components/AuthDialog.tsx").AuthPage>();
  const [AdminPage, setAdminPage] = useState<typeof import("../admin/AdminPage.tsx").AdminPage>();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const lastNavigation = useRef(0);
  const activePage = useRef(readRoute(url).page);
  const {page, locale} = readRoute(url);

  useEffect(() => {
    const media = matchMedia(systemDarkQuery);
    const syncTheme = () => applyTheme(preferredTheme());
    media.addEventListener("change", syncTheme);
    return () => media.removeEventListener("change", syncTheme);
  }, []);

  useEffect(() => {
    const update = async () => {
      const index = ++lastNavigation.current;
      const next = new URL(location.href);
      const view = readRoute(next);
      setFailed(false);
      setPending(true);
      try {
        const app = view.page === "app" ? await loadApp() : undefined;
        const auth = view.page === "login" || view.page === "register" ? await loadAuth() : undefined;
        const admin = view.page === "admin" ? await loadAdmin() : undefined;
        if (index !== lastNavigation.current) return;
        if (activePage.current === "app" && view.page !== "app") await editor.flush();
        if (index !== lastNavigation.current) return;
        activePage.current = view.page;
        if (app) setApp(() => app.App);
        if (auth) setAuthPage(() => auth.AuthPage);
        if (admin) setAdminPage(() => admin.AdminPage);
        selectLocale(view.locale);
        setUrl(next);
      } catch {
        if (index === lastNavigation.current) setFailed(true);
      } finally {
        if (index === lastNavigation.current) setPending(false);
      }
    };
    const follow = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target || link.hasAttribute("download")) return;
      const target = new URL(link.href);
      if (target.origin !== location.origin || !route(target.pathname)) return;
      event.preventDefault();
      if (target.href !== location.href) navigate(target.pathname + target.search + target.hash);
    };
    window.addEventListener("popstate", update);
    document.addEventListener("click", follow);
    void update();
    return () => {
      lastNavigation.current++;
      window.removeEventListener("popstate", update);
      document.removeEventListener("click", follow);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    const canon = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canon) canon.href = publicOrigin + pageHref("home", locale);
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = siteCopy[locale].description;
    if (page === "home") document.title = siteCopy[locale].title;
    else if (page === "admin") document.title = t("admin.title") + " · Easel";
    else if (page !== "app") document.title = (page === "login" ? t("auth.title") : t("auth.registerTitle")) + " · Easel";
  }, [page, locale]);

  return (
    <>
      <Header url={url} />
      {page === "home" ? <Home locale={locale} />
        : page === "app" && App ? <App locale={locale} />
        : page === "admin" && AdminPage ? <AdminPage locale={locale} path={url.pathname} />
        : page !== "app" && page !== "admin" && AuthPage ? <AuthPage key={page} creating={page === "register"} locale={locale} onSignedIn={() => { const current = readRoute(new URL(location.href)); if (current.page === page) navigate(pageHref("app", current.locale), true); }} />
        : <main className="site-pending" role="status" aria-label={t("app.opening")}>{!failed && <Spinner />}</main>}
      {pending && <span role="status" className="sr-only">{t("app.opening")}</span>}
      {failed && <div role="alert" className="niltavi-container py-4">{t("api.unavailable")} <Button size="sm" onPress={() => location.reload()}>{t("common.retry")}</Button></div>}
    </>
  );
}
