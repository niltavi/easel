import {Card} from "@heroui/react";
import {buttonVariants} from "@heroui/styles";
import {Gear, House, Persons, ShieldCheck} from "@gravity-ui/icons";
import {useEffect, useState} from "react";
import {api, ApiError} from "../lib/api.ts";
import * as store from "../lib/db.ts";
import type {Session} from "../lib/types.ts";
import {AppSidebar, type SidebarGroup} from "../vendor/niltavi-ui/templates/saas/Navigation.tsx";
import {LocaleContext, useText} from "../vendor/niltavi-ui/site/Locale.tsx";
import {adminHref, adminSectionOf, pageHref, type AdminSection, type Locale} from "../site/routes.ts";
import {AccountsPage} from "./AccountsPage.tsx";
import {GeneralPage} from "./GeneralPage.tsx";
import {OverviewPage} from "./OverviewPage.tsx";
import {IdentityPage} from "./IdentityPage.tsx";
import {SignInPage} from "./SignInPage.tsx";
import {Loading} from "./ui.tsx";

/** The instance console: a sidebar of sections on wide screens, a row of links on narrow ones. */
export function AdminPage({locale, path}: {locale: Locale; path: string}) {
  const [session, setSession] = useState<Session | null | undefined>();

  useEffect(() => {
    let current = true;
    void store.kvGet<Session>("session").then((value) => {
      if (current) setSession(value && !value.expired ? value : null);
    });
    return () => { current = false; };
  }, []);

  return (
    <LocaleContext.Provider value={locale}>
      {session === undefined ? <main className="niltavi-container py-12"><Loading /></main>
        : session === null ? <SignedOut locale={locale} />
        : <Console session={session} section={adminSectionOf(path)} locale={locale} />}
    </LocaleContext.Provider>
  );
}

function SignedOut({locale}: {locale: Locale}) {
  const text = useText();
  return (
    <main className="niltavi-container grid max-w-xl gap-5 py-12 md:py-16">
      <h1 className="text-balance text-3xl font-semibold tracking-tight">{text("Instance console", "实例管理台")}</h1>
      <Card>
        <Card.Content className="grid gap-4">
          <p className="text-sm leading-6 text-muted">{text("Sign in with an administrator account to continue.", "请用管理员账号登录后继续。")}</p>
          <a className={buttonVariants({variant: "primary"})} href={pageHref("login", locale)}>{text("Sign in", "登录")}</a>
        </Card.Content>
      </Card>
    </main>
  );
}

function Console({session, section, locale}: {session: Session; section: AdminSection; locale: Locale}) {
  const text = useText();
  const {token} = session;
  const [forbidden, setForbidden] = useState(false);
  const [checked, setChecked] = useState(false);

  // The overview is the cheapest admin-only request; a 403 here means this account is not an administrator.
  useEffect(() => {
    let current = true;
    api.admin.overview(token).then(
      () => { if (current) setChecked(true); },
      (error) => {
        if (!current) return;
        setForbidden(error instanceof ApiError && error.code === "forbidden");
        setChecked(true);
      },
    );
    return () => { current = false; };
  }, [token]);

  const sections: {id: AdminSection; label: string; icon: typeof House}[] = [
    {id: "overview", label: text("Overview", "概览"), icon: House},
    {id: "sign-in", label: text("Sign-in", "登录方式"), icon: ShieldCheck},
    {id: "accounts", label: text("Accounts", "账号"), icon: Persons},
    {id: "general", label: text("General", "常规"), icon: Gear},
  ];

  const groups: SidebarGroup[] = [{id: "console", items: sections.map(({id, label, icon}) => ({id, label, icon}))}];
  // The Identity page is a second level under sign-in, so the sign-in entry stays highlighted there.
  const active = section.startsWith("sign-in") ? "sign-in" : section;

  const go = (next: AdminSection) => {
    const href = adminHref(next, locale);
    if (window.location.pathname === href) return;
    window.history.pushState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  if (!checked) return <main className="niltavi-container py-12"><Loading /></main>;

  if (forbidden) {
    return (
      <main className="niltavi-container grid max-w-xl gap-5 py-12 md:py-16">
        <h1 className="text-balance text-3xl font-semibold tracking-tight">{text("Instance console", "实例管理台")}</h1>
        <Card>
          <Card.Content className="grid gap-4">
            <p className="text-sm leading-6 text-muted">{text("Only administrators can open this page.", "只有管理员可以打开这个页面。")}</p>
            <a className={buttonVariants({variant: "secondary"})} href={pageHref("app", locale)}>{text("Back to Easel", "返回 Easel")}</a>
          </Card.Content>
        </Card>
      </main>
    );
  }

  // Fills the window below the 61px product header, so the sidebar and the content both reach the bottom.
  return (
    <div className="grid min-h-[calc(100dvh-61px)] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[auto_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
      <aside className="hidden md:flex md:min-h-0">
        <AppSidebar
          label={text("Instance console navigation", "实例管理台导航")}
          groups={groups}
          active={active}
          onNavigate={(id) => go(id as AdminSection)}
          footer={<a className={buttonVariants({variant: "ghost", size: "sm"})} href={pageHref("app", locale)}>{text("Back to Easel", "返回 Easel")}</a>}
        />
      </aside>
      <nav aria-label={text("Instance console navigation", "实例管理台导航")} className="flex gap-1 overflow-x-auto border-b border-separator px-4 py-2 md:hidden">
        {sections.map(({id, label}) => (
          <a key={id} href={adminHref(id, locale)} aria-current={id === active ? "page" : undefined}
            className={buttonVariants({variant: id === active ? "secondary" : "ghost", size: "sm"})}>{label}</a>
        ))}
      </nav>
      <main className="min-h-0 min-w-0 overflow-y-auto">
        <div className="niltavi-container grid min-w-0 content-start gap-6 py-8 md:py-12">
          {section === "overview" && <OverviewPage token={token} locale={locale} />}
          {section === "sign-in" && <SignInPage token={token} />}
          {section === "sign-in/identity" && <IdentityPage token={token} />}
          {section === "accounts" && <AccountsPage token={token} me={session.user.id} />}
          {section === "general" && <GeneralPage token={token} />}
        </div>
      </main>
    </div>
  );
}
