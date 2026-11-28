import {Button, Modal, Skeleton} from "@heroui/react";
import {useEffect, useState} from "react";
import type {AuthConfig} from "../../shared/api.ts";
import {api, ApiError} from "../lib/api.ts";
import {t} from "../lib/i18n.ts";
import {register, signInWithPassword} from "../lib/sync.ts";
import {pageHref, type Locale} from "../site/routes.ts";
import {PasswordRegister, PasswordSignIn, type AuthLink} from "./PasswordAuth.tsx";

interface AuthFormProps {
  reason?: string;
  defaultEmail?: string;
  creating: boolean;
  locale?: Locale;
  onSwitch?: () => void;
  onSignedIn: () => void;
}

interface DialogProps extends Pick<AuthFormProps, "reason" | "defaultEmail" | "onSignedIn"> {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const CONFIG_RETRY_MS = 3000;

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.code === "network" ? t("auth.errorNetwork") : error.message;
  return t("auth.errorGeneric");
}

export function AuthDialog({isOpen, onOpenChange, reason, defaultEmail, onSignedIn}: DialogProps) {
  const [creating, setCreating] = useState(false);
  const change = (open: boolean) => {
    if (!open) setCreating(false);
    onOpenChange(open);
  };
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={change}>
      <Modal.Container placement="auto">
        <Modal.Dialog className="sm:max-w-sm" aria-label={creating ? t("auth.registerTitle") : t("auth.title")}>
          <Modal.CloseTrigger />
          <Modal.Body className="pt-9">
            {isOpen && <AuthForm reason={reason} defaultEmail={defaultEmail} creating={creating}
              onSwitch={() => setCreating(!creating)} onSignedIn={() => { change(false); onSignedIn(); }} />}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export function AuthPage(props: AuthFormProps) {
  return <main className="site-auth"><AuthForm {...props} /></main>;
}

function AuthForm({reason, defaultEmail, creating, locale, onSwitch, onSignedIn}: AuthFormProps) {
  const [config, setConfig] = useState<AuthConfig>();

  // Keep the skeleton up and retry quietly until the server answers.
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => void api.authConfig().then((value) => {
      if (current) setConfig(value);
    }, () => {
      if (current) timer = setTimeout(load, CONFIG_RETRY_MS);
    });
    load();
    return () => { current = false; clearTimeout(timer); };
  }, []);

  if (!config) return <Lines />;

  const Heading = locale ? "h1" : "h2";
  const context = reason && <p className="text-sm text-muted wrap-anywhere">{reason}</p>;
  const identityButton = config.identityLogin && config.signInUrl ? (
    <Button variant="secondary" className="w-full" onPress={() => { window.location.href = config.signInUrl!; }}>
      {t("auth.identityButton")}
    </Button>
  ) : null;

  if (!config.localLogin) {
    return <div className="nt-auth nt-auth--signin nt-fade-up">
      <Heading className="nt-auth__title">{t("common.signIn")}</Heading>
      {context}
      {identityButton}
    </div>;
  }

  const alternative = identityButton && <>
    <p className="nt-auth__links">{t("auth.or")}</p>
    {identityButton}
  </>;
  const target = (page: "login" | "register"): AuthLink | undefined => locale
    ? {href: pageHref(page, locale)}
    : onSwitch && {href: "#", onClick: (event) => { event.preventDefault(); onSwitch(); }};

  if (creating) {
    return <PasswordRegister title={<Heading>{t("auth.createAnAccount")}</Heading>} defaultEmail={defaultEmail}
      signIn={target("login") ?? {href: "#"}} alternative={alternative}
      onSubmit={async (email, password) => {
        try {
          await register(email, password);
          onSignedIn();
        } catch (cause) {
          return {message: describe(cause)};
        }
      }}>{context}</PasswordRegister>;
  }
  return <PasswordSignIn title={<Heading className="nt-auth__title">{t("common.signIn")}</Heading>} defaultEmail={defaultEmail}
    register={target("register")} alternative={alternative}
    onSubmit={async (email, password) => {
      try {
        await signInWithPassword(email, password);
        onSignedIn();
      } catch (cause) {
        return describe(cause);
      }
    }}>{context}</PasswordSignIn>;
}

// Loading placeholder from niltavi-identity (web/src/auth.tsx).
function Lines() {
  return <div className="nt-auth" aria-busy="true">
    <Skeleton className="h-7 w-2/3 rounded" /><Skeleton className="h-10 w-full rounded" /><Skeleton className="h-10 w-full rounded" />
  </div>;
}
