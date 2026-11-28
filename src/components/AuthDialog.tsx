import {Button, Description, Form, Input, Label, Modal, Spinner, TextField} from "@heroui/react";
import {useEffect, useState} from "react";
import type {AuthConfig} from "../../shared/api.ts";
import {api, ApiError} from "../lib/api.ts";
import {t} from "../lib/i18n.ts";
import {register, signInWithPassword} from "../lib/sync.ts";
import {pageHref, type Locale} from "../site/routes.ts";
import {EmailPasswordForm} from "../vendor/niltavi-ui/EmailPasswordForm.tsx";

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

function AuthForm({reason, defaultEmail = "", creating, locale, onSwitch, onSignedIn}: AuthFormProps) {
  const [config, setConfig] = useState<AuthConfig>();
  const [configError, setConfigError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setConfigError(false);
    void api.authConfig().then((value) => {
      if (current) setConfig(value);
    }, () => {
      if (current) setConfigError(true);
    });
    return () => { current = false; };
  }, [attempt]);

  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setError("");
  };

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await (creating ? register : signInWithPassword)(email.trim(), password);
      onSignedIn();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setPending(false);
    }
  };

  const identityButton = config?.identityLogin && config.signInUrl ? (
    <Button variant="secondary" className="w-full" onPress={() => { window.location.href = config.signInUrl!; }}>
      {t("auth.identityButton")}
    </Button>
  ) : null;

  const heading = creating ? t("auth.registerTitle") : t("auth.title");
  const description = reason ?? (config?.localLogin ? (creating ? t("auth.introRegister") : t("auth.introPassword")) : t("auth.identityIntro"));

  // Local form for the public login and register pages, styled by the shared Niltavi form.
  if (config?.localLogin && locale) {
    return (
      <>
        <h1 className="sr-only">{heading}</h1>
        <EmailPasswordForm
          mode={creating ? "register" : "sign-in"}
          labels={{
            title: creating ? t("auth.createAccount") : t("common.signIn"),
            email: t("auth.email"),
            password: t("auth.password"),
            retry: t("auth.errorGeneric"),
          }}
          alternate={{href: pageHref(creating ? "login" : "register", locale), label: creating ? t("auth.toSignIn") : t("auth.toRegister")}}
          onSubmit={async ({email, password}) => {
            try {
              await (creating ? register : signInWithPassword)(email, password);
              onSignedIn();
            } catch (cause) {
              return {message: describe(cause)};
            }
          }}
        >
          <p className="text-sm leading-6 text-muted">{description}</p>
          {identityButton && <><p className="text-center text-sm text-muted">{t("auth.or")}</p>{identityButton}</>}
        </EmailPasswordForm>
      </>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      {locale ? <h1 className="text-2xl font-medium">{heading}</h1> : <h2 className="text-xl font-medium">{heading}</h2>}
      <p className="text-sm leading-6 wrap-anywhere text-muted">{description}</p>
      {!config ? (
        configError
          ? <div role="alert" className="flex flex-col items-start gap-2">{t("auth.errorNetwork")} <Button size="sm" onPress={() => setAttempt(attempt + 1)}>{t("common.retry")}</Button></div>
          : <div role="status" aria-label={t("app.opening")}><Spinner /></div>
      ) : (
        <>
          {config.localLogin && (
            <Form method="post" className="flex flex-col gap-4" onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}>
              <TextField isRequired name="email" type="email" value={email} onChange={edit(setEmail)} autoFocus>
                <Label>{t("auth.email")}</Label>
                <Input autoComplete="email" inputMode="email" />
              </TextField>
              <TextField isRequired name="password" type="password" value={password} onChange={edit(setPassword)} minLength={creating ? 8 : undefined} maxLength={128}>
                <Label>{t("auth.password")}</Label>
                <Input autoComplete={creating ? "new-password" : "current-password"} />
                {creating && !error && <Description>{t("auth.passwordHint")}</Description>}
              </TextField>
              {error && <p className="field-error" data-visible role="alert">{error}</p>}
              <Button type="submit" variant="primary" isPending={pending} className="w-full">
                {creating ? t("auth.createAccount") : t("common.signIn")}
              </Button>
              {onSwitch && (
                <Button size="sm" variant="ghost" className="self-start" isDisabled={pending} onPress={() => {
                  setPassword("");
                  setError("");
                  onSwitch();
                }}>{creating ? t("auth.toSignIn") : t("auth.toRegister")}</Button>
              )}
            </Form>
          )}
          {config.localLogin && identityButton && <p className="text-center text-sm text-muted">{t("auth.or")}</p>}
          {identityButton}
        </>
      )}
    </section>
  );
}
