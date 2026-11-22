import {Globe, LogoGithub, Moon, Sun} from "@gravity-ui/icons";
import {Button, Dropdown, Label, Spinner} from "@heroui/react";
import {buttonVariants} from "@heroui/styles";
import {useEffect, useRef, useState} from "react";
import {selectLocale, t} from "../lib/i18n.ts";
import {editor} from "../lib/state.ts";
import {siteCopy} from "./content.ts";
import {pageHref, publicOrigin, repository, route, type Locale} from "./routes.ts";
import {toggleTheme, useTheme} from "./theme.ts";

const loadApp = () => import("../components/App.tsx");
const loadAuth = () => import("../components/AuthDialog.tsx");
const readRoute = (url: URL) => route(url.pathname) ?? {page: "home" as const, locale: "en" as const};

function Header({url}: {url: URL}) {
  const {page, locale} = readRoute(url);
  const copy = siteCopy[locale];
  const theme = useTheme();
  const brand = page === "app" ? "app" : "home";
  return (
    <header className="site-header">
      <div className="site-container site-header-inner" data-wide={page === "app" || undefined}>
        <a className="site-brand" href={pageHref(brand, locale)}>
          <img src="/favicon.svg" width={40} height={40} alt="" />
          <span>Easel</span>
        </a>
        <nav className="site-controls">
          {page === "home" && <a className={buttonVariants({size: "sm", variant: "secondary"})} href={pageHref("login", locale)}>{copy.signIn}</a>}
          <Button data-header-icon="" isIconOnly size="sm" variant="ghost" aria-label={theme === "light" ? copy.dark : copy.light} onPress={toggleTheme}>
            {theme === "light" ? <Moon aria-hidden width={18} height={18} /> : <Sun aria-hidden width={18} height={18} />}
          </Button>
          <Dropdown>
            <Button data-header-icon="" isIconOnly size="sm" variant="ghost" aria-label={copy.language}><Globe aria-hidden width={18} height={18} /></Button>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu aria-label={copy.language} selectionMode="single" disallowEmptySelection selectedKeys={[locale]}
                onSelectionChange={(keys) => {
                  const next = [...keys][0];
                  if ((next === "en" || next === "zh-CN") && next !== locale) navigate(pageHref(page, next) + url.search + url.hash);
                }}>
                <Dropdown.Item id="en" textValue="English"><Label lang="en">English</Label><Dropdown.ItemIndicator /></Dropdown.Item>
                <Dropdown.Item id="zh-CN" textValue="简体中文"><Label lang="zh-CN">简体中文</Label><Dropdown.ItemIndicator /></Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
          <a data-header-icon="" className={buttonVariants({isIconOnly: true, size: "sm", variant: "ghost"})} href={repository} aria-label={copy.github}>
            <LogoGithub aria-hidden width={18} height={18} />
          </a>
        </nav>
      </div>
    </header>
  );
}

function Home({locale}: {locale: Locale}) {
  const copy = siteCopy[locale];
  return (
    <>
      <main className="site-container site-intro">
        <h1>{copy.heading}</h1>
        <p>{copy.description}</p>
        <div className="site-actions">
          <a className={buttonVariants({variant: "primary"})} href={pageHref("app", locale)}>{copy.open}</a>
          <a className={buttonVariants({variant: "secondary"})} href={repository + "/blob/main/docs/en/for-agents.md"}>{copy.install}</a>
        </div>
      </main>
      <footer className="site-container site-footer">
        <a href="https://niltavi.com/">
          <img className="site-wordmark--light" src="/niltavi-logo-light.svg" width={72} height={26} alt="Niltavi" />
          <img className="site-wordmark--dark" src="/niltavi-logo-dark.svg" width={72} height={26} alt="Niltavi" />
        </a>
      </footer>
    </>
  );
}

export function navigate(href: string, replace = false) {
  if (replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function Root() {
  const [url, setUrl] = useState(() => new URL(location.href));
  const [App, setApp] = useState<typeof import("../components/App.tsx").App>();
  const [AuthPage, setAuthPage] = useState<typeof import("../components/AuthDialog.tsx").AuthPage>();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const lastNavigation = useRef(0);
  const activePage = useRef(readRoute(url).page);
  const {page, locale} = readRoute(url);

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
        if (index !== lastNavigation.current) return;
        if (activePage.current === "app" && view.page !== "app") await editor.flush();
        if (index !== lastNavigation.current) return;
        activePage.current = view.page;
        if (app) setApp(() => app.App);
        if (auth) setAuthPage(() => auth.AuthPage);
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
    else if (page !== "app") document.title = (page === "login" ? t("auth.title") : t("auth.registerTitle")) + " · Easel";
  }, [page, locale]);

  return (
    <>
      <Header url={url} />
      {page === "home" ? <Home locale={locale} />
        : page === "app" && App ? <App locale={locale} />
        : page !== "app" && AuthPage ? <AuthPage key={page} creating={page === "register"} locale={locale} onSignedIn={() => { const current = readRoute(new URL(location.href)); if (current.page === page) navigate(pageHref("app", current.locale), true); }} />
        : <main className="site-pending" role="status" aria-label={t("app.opening")}>{!failed && <Spinner />}</main>}
      {pending && <span role="status" className="sr-only">{t("app.opening")}</span>}
      {failed && <div role="alert" className="site-container py-4">{t("api.unavailable")} <Button size="sm" onPress={() => location.reload()}>{t("common.retry")}</Button></div>}
    </>
  );
}
