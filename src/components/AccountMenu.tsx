import {ArrowRightFromSquare, ArrowRightToSquare, Check, CircleInfo, Gear, LogoGithub, Person} from "@gravity-ui/icons";
import {Button, Dropdown, Label, Separator} from "@heroui/react";
import {locale, t} from "../lib/i18n.ts";
import type {Session} from "../lib/types.ts";
import {pageHref, repository} from "../site/routes.ts";
import {useTheme} from "../site/theme.ts";
import {saveTheme} from "../vendor/niltavi-ui/theme.ts";

interface Props {
  session: Session | null;
  onSignIn: () => void;
  onSignOut: () => void;
}

const LANGUAGES = [
  {locale: "en", label: "English"},
  {locale: "zh-CN", label: "简体中文"},
] as const;

/** The account button at the bottom of the works list: About and Settings submenus, then sign in or sign out. */
export function AccountMenu({session, onSignIn, onSignOut}: Props) {
  const theme = useTheme();
  // Keep the current drawing and any hash when switching language, as the old header did.
  const suffix = location.search + location.hash;
  const home = pageHref("home", locale);

  const onAction = (key: string) => {
    if (key === "light" || key === "dark") saveTheme(key);
    else if (key === "signin") onSignIn();
    else if (key === "signout") onSignOut();
  };

  return (
    <Dropdown>
      <Button variant="ghost" className="easel-account__trigger">
        <span className="easel-account__avatar" aria-hidden>
          <Person />
        </span>
        <span className="easel-account__who">
          <span className="easel-account__name">{session ? session.user.email : t("account.guest")}</span>
          {session?.expired && <span className="easel-works__hint">{t("session.expired")}</span>}
        </span>
      </Button>
      <Dropdown.Popover placement="top start">
        <Dropdown.Menu aria-label={t("account.menu")} onAction={(key) => onAction(String(key))}>
          <Dropdown.SubmenuTrigger>
            <Dropdown.Item id="about" textValue={t("account.about")}>
              <CircleInfo aria-hidden focusable="false" width={16} height={16} />
              <Label>{t("account.about")}</Label>
              <Dropdown.SubmenuIndicator />
            </Dropdown.Item>
            <Dropdown.Popover>
              <Dropdown.Menu aria-label={t("account.about")}>
                <Dropdown.Item id="easel" href={home} textValue="Easel">
                  <Label>Easel</Label>
                </Dropdown.Item>
                <Dropdown.Item id="github" href={repository} target="_blank" rel="noopener noreferrer" textValue={t("account.github")}>
                  <LogoGithub aria-hidden focusable="false" width={16} height={16} />
                  <Label>{t("account.github")}</Label>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown.SubmenuTrigger>

          <Dropdown.SubmenuTrigger>
            <Dropdown.Item id="settings" textValue={t("account.settings")}>
              <Gear aria-hidden focusable="false" width={16} height={16} />
              <Label>{t("account.settings")}</Label>
              <Dropdown.SubmenuIndicator />
            </Dropdown.Item>
            <Dropdown.Popover>
              <Dropdown.Menu aria-label={t("account.settings")} onAction={(key) => onAction(String(key))}>
                <Dropdown.Item id="light" textValue={t("account.light")}>
                  <Label>{t("account.light")}</Label>
                  {theme === "light" && <Check aria-hidden focusable="false" width={16} height={16} />}
                </Dropdown.Item>
                <Dropdown.Item id="dark" textValue={t("account.dark")}>
                  <Label>{t("account.dark")}</Label>
                  {theme === "dark" && <Check aria-hidden focusable="false" width={16} height={16} />}
                </Dropdown.Item>
                <Separator />
                {LANGUAGES.map((item) => (
                  <Dropdown.Item key={item.locale} id={item.locale} href={pageHref("app", item.locale) + suffix} textValue={item.label}>
                    <Label lang={item.locale}>{item.label}</Label>
                    {item.locale === locale && <Check aria-hidden focusable="false" width={16} height={16} />}
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown.SubmenuTrigger>

          <Separator />
          {session ? (
            <Dropdown.Item id="signout" textValue={t("common.signOut")}>
              <ArrowRightFromSquare aria-hidden focusable="false" width={16} height={16} />
              <Label>{t("common.signOut")}</Label>
            </Dropdown.Item>
          ) : (
            <Dropdown.Item id="signin" textValue={t("common.signIn")}>
              <ArrowRightToSquare aria-hidden focusable="false" width={16} height={16} />
              <Label>{t("common.signIn")}</Label>
            </Dropdown.Item>
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
