import {Button, Description, Form, Input, InputOTP, Label, Modal, Spinner, TextField} from "@heroui/react";
import {useEffect, useState} from "react";
import {api, ApiError} from "../lib/api.ts";
import {t} from "../lib/i18n.ts";
import {register, requestCode, signInWithPassword, verifyCode} from "../lib/sync.ts";
import {pageHref, type Locale} from "../site/routes.ts";

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

const RESEND_SECONDS = 60;

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
  const [mode, setMode] = useState<"code" | "password">();
  const [configError, setConfigError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(defaultEmail);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [wait, setWait] = useState(0);

  useEffect(() => {
    let current = true;
    setConfigError(false);
    void api.authConfig().then(({signIn}) => {
      if (current) setMode(signIn);
    }, () => {
      if (current) setConfigError(true);
    });
    return () => { current = false; };
  }, [attempt]);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const send = async () => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await requestCode(email.trim());
      setStep("code");
      setCode("");
      setWait(RESEND_SECONDS);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "rate_limited") {
        setStep("code");
        setWait(RESEND_SECONDS);
      } else setError(describe(cause));
    } finally {
      setPending(false);
    }
  };

  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setError("");
  };

  const submitPassword = async () => {
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

  const verify = async (value: string) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await verifyCode(email.trim(), value);
      onSignedIn();
    } catch (cause) {
      setError(describe(cause));
      setCode("");
    } finally {
      setPending(false);
    }
  };

  const link = (toRegister: boolean) => {
    const label = toRegister ? t("auth.toRegister") : t("auth.toSignIn");
    if (locale) return <a className="self-start text-sm underline underline-offset-4" href={pageHref(toRegister ? "register" : "login", locale)}>{label}</a>;
    if (onSwitch) return <Button size="sm" variant="ghost" className="self-start" isDisabled={pending} onPress={() => {
      setPassword("");
      setError("");
      onSwitch();
    }}>{label}</Button>;
  };

  const heading = creating ? t("auth.registerTitle") : step === "code" ? t("auth.codeTitle") : t("auth.title");
  const description = creating
    ? mode === "code" ? t("auth.hostedRegistration") : t("auth.introRegister")
    : step === "code" ? t("auth.codeSent", {email: email.trim()})
      : reason ?? (mode === "password" ? t("auth.introPassword") : t("auth.intro"));

  return (
    <section className="flex min-w-0 flex-col gap-4">
      {locale ? <h1 className="text-2xl font-medium">{heading}</h1> : <h2 className="text-xl font-medium">{heading}</h2>}
      {mode && <p className="text-sm leading-6 wrap-anywhere text-muted">{description}</p>}
      {!mode ? (
        configError
          ? <div role="alert" className="flex flex-col items-start gap-2">{t("auth.errorNetwork")} <Button size="sm" onPress={() => setAttempt(attempt + 1)}>{t("common.retry")}</Button></div>
          : <div role="status" aria-label={t("app.opening")}><Spinner /></div>
      ) : creating && mode === "code" ? link(false) : mode === "password" || step === "email" ? (
        <Form className="flex flex-col gap-4" onSubmit={(event) => {
          event.preventDefault();
          void (mode === "password" ? submitPassword() : send());
        }}>
          <TextField isRequired name="email" type="email" value={email} onChange={edit(setEmail)} autoFocus>
            <Label>{t("auth.email")}</Label>
            <Input autoComplete="email" inputMode="email" />
          </TextField>
          {mode === "password" && (
            <TextField isRequired name="password" type="password" value={password} onChange={edit(setPassword)} minLength={creating ? 8 : undefined} maxLength={128}>
              <Label>{t("auth.password")}</Label>
              <Input autoComplete={creating ? "new-password" : "current-password"} />
              {creating && !error && <Description>{t("auth.passwordHint")}</Description>}
            </TextField>
          )}
          {error && <p className="field-error" data-visible role="alert">{error}</p>}
          <Button type="submit" variant="primary" isPending={pending} className="w-full">
            {mode === "code" ? t("auth.getCode") : creating ? t("auth.createAccount") : t("common.signIn")}
          </Button>
          {(mode === "password" || locale) && link(!creating)}
        </Form>
      ) : (
        <Form className="flex flex-col gap-4" onSubmit={(event) => {
          event.preventDefault();
          if (code.length === 6) void verify(code);
        }}>
          <div className="flex min-w-0 flex-col gap-2">
            <Label>{t("auth.codeLabel")}</Label>
            <InputOTP maxLength={6} value={code} onChange={setCode} onComplete={(value) => void verify(value)} isInvalid={Boolean(error)} autoFocus aria-label={t("auth.codeLabel")}>
              <InputOTP.Group>{[0, 1, 2].map((index) => <InputOTP.Slot key={index} index={index} />)}</InputOTP.Group>
              <InputOTP.Separator />
              <InputOTP.Group>{[3, 4, 5].map((index) => <InputOTP.Slot key={index} index={index} />)}</InputOTP.Group>
            </InputOTP>
            {error ? <p className="text-xs text-danger" role="alert">{error}</p> : <Description>{t("auth.noCode")}</Description>}
          </div>
          <Button type="submit" variant="primary" isPending={pending} isDisabled={code.length !== 6} className="w-full">{t("common.signIn")}</Button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" variant="ghost" isDisabled={pending} onPress={() => { setStep("email"); setError(""); }}>{t("auth.changeEmail")}</Button>
            <Button size="sm" variant="ghost" className="tabular-nums" isDisabled={wait > 0 || pending} onPress={() => void send()}>
              {wait > 0 ? t("auth.resendIn", {seconds: wait}) : t("auth.resend")}
            </Button>
          </div>
        </Form>
      )}
    </section>
  );
}
