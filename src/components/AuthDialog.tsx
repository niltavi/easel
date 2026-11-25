import {Button, Description, Form, Input, InputOTP, Label, Modal, TextField} from "@heroui/react";
import {useEffect, useState} from "react";
import {ApiError} from "../lib/api.ts";
import {t} from "../lib/i18n.ts";
import {authMode, register, requestCode, signInWithPassword, verifyCode} from "../lib/sync.ts";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Why sign-in was opened; shown below the heading. */
  reason?: string;
  defaultEmail?: string;
  onSignedIn: () => void;
}

const RESEND_SECONDS = 60;

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.code === "network" ? t("auth.errorNetwork") : error.message;
  return t("auth.errorGeneric");
}

export function AuthDialog({isOpen, onOpenChange, reason, defaultEmail = "", onSignedIn}: Props) {
  // "code" is the default flow; a self-hosted server reports "password" and the dialog switches to it.
  const [mode, setMode] = useState<"code" | "password" | "identity">("code");
  const [creating, setCreating] = useState(false);
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(defaultEmail);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setStep("email");
    setEmail(defaultEmail);
    setCode("");
    setError("");
    setPassword("");
    setCreating(false);
    let current = true;
    void authMode().then((value) => {
      if (!current) return;
      if (value === "identity") {
        onOpenChange(false);
        return;
      }
      setMode(value);
    });
    return () => {
      current = false;
    };
  }, [isOpen, defaultEmail]);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const send = async () => {
    setPending(true);
    setError("");
    try {
      await requestCode(email.trim());
      setStep("code");
      setCode("");
      setWait(RESEND_SECONDS);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "rate_limited") {
        // A code was already sent within the last minute: let the user go straight to entering it.
        setStep("code");
        setWait(RESEND_SECONDS);
      } else setError(describe(cause));
    } finally {
      setPending(false);
    }
  };

  // Editing a field clears the message from the last attempt.
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setError("");
  };

  const submitPassword = async () => {
    setPending(true);
    setError("");
    try {
      await (creating ? register : signInWithPassword)(email.trim(), password);
      onOpenChange(false);
      onSignedIn();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setPending(false);
    }
  };

  const verify = async (value: string) => {
    setPending(true);
    setError("");
    try {
      await verifyCode(email.trim(), value);
      onOpenChange(false);
      onSignedIn();
    } catch (cause) {
      setError(describe(cause));
      setCode("");
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container placement="auto">
        <Modal.Dialog className="sm:max-w-sm">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              {mode === "password" ? (creating ? t("auth.registerTitle") : t("auth.title")) : step === "email" ? t("auth.title") : t("auth.codeTitle")}
            </Modal.Heading>
            {/* A long address has no break opportunities of its own; without this it runs past the dialog and is cut off. */}
            <p className="mt-1.5 text-sm leading-6 wrap-anywhere text-muted">
              {mode === "password"
                ? creating
                  ? t("auth.introRegister")
                  : (reason ?? t("auth.introPassword"))
                : step === "email"
                  ? (reason ?? t("auth.intro"))
                  : t("auth.codeSent", {email: email.trim()})}
            </p>
          </Modal.Header>
          <Modal.Body>
            {mode === "password" ? (
              <Form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitPassword();
                }}
              >
                <TextField isRequired name="email" type="email" value={email} onChange={edit(setEmail)} autoFocus>
                  <Label>{t("auth.email")}</Label>
                  <Input placeholder="name@example.com" autoComplete="email" inputMode="email" />
                </TextField>
                <TextField isRequired name="password" type="password" value={password} onChange={edit(setPassword)} minLength={creating ? 8 : undefined} maxLength={128}>
                  <Label>{t("auth.password")}</Label>
                  <Input autoComplete={creating ? "new-password" : "current-password"} />
                  {error ? <p className="field-error" data-visible role="alert">{error}</p> : creating ? <Description>{t("auth.passwordHint")}</Description> : null}
                </TextField>
                <Button type="submit" variant="primary" isPending={pending} className="w-full">
                  {creating ? t("auth.createAccount") : t("common.signIn")}
                </Button>
                <Button size="sm" variant="ghost" className="self-start" onPress={() => { setCreating(!creating); setError(""); }}>
                  {creating ? t("auth.toSignIn") : t("auth.toRegister")}
                </Button>
              </Form>
            ) : step === "email" ? (
              <Form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                {/* A failed send is not an invalid email: marking the field invalid would fail the browser's own validation and block every retry. */}
                <TextField isRequired name="email" type="email" value={email} onChange={edit(setEmail)} autoFocus>
                  <Label>{t("auth.email")}</Label>
                  <Input placeholder="name@example.com" autoComplete="email" inputMode="email" />
                  {error ? <p className="field-error" data-visible role="alert">{error}</p> : null}
                </TextField>
                <Button type="submit" variant="primary" isPending={pending} className="w-full">
                  {t("auth.getCode")}
                </Button>
              </Form>
            ) : (
              <Form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (code.length === 6) void verify(code);
                }}
              >
                <div className="flex flex-col gap-2">
                  <Label>{t("auth.codeLabel")}</Label>
                  <InputOTP maxLength={6} value={code} onChange={setCode} onComplete={(value) => void verify(value)} isInvalid={error !== ""} autoFocus aria-label={t("auth.codeLabel")}>
                    <InputOTP.Group>
                      {[0, 1, 2].map((index) => (
                        <InputOTP.Slot key={index} index={index} />
                      ))}
                    </InputOTP.Group>
                    <InputOTP.Separator />
                    <InputOTP.Group>
                      {[3, 4, 5].map((index) => (
                        <InputOTP.Slot key={index} index={index} />
                      ))}
                    </InputOTP.Group>
                  </InputOTP>
                  {/* Same type size as the hint it replaces, so the dialog keeps its height when a code is rejected. */}
                  {error ? <p className="text-xs text-danger" role="alert">{error}</p> : <Description>{t("auth.noCode")}</Description>}
                </div>
                <Button type="submit" variant="primary" isPending={pending} isDisabled={code.length !== 6} className="w-full">
                  {t("common.signIn")}
                </Button>
                {/* No negative margins here: the dialog body is a scroll container, so anything past its edge shows a horizontal scrollbar. */}
                <div className="flex items-center justify-between gap-2">
                  <Button size="sm" variant="ghost" onPress={() => { setStep("email"); setError(""); }}>
                    {t("auth.changeEmail")}
                  </Button>
                  <Button size="sm" variant="ghost" className="tabular-nums" isDisabled={wait > 0 || pending} onPress={() => void send()}>
                    {wait > 0 ? t("auth.resendIn", {seconds: wait}) : t("auth.resend")}
                  </Button>
                </div>
              </Form>
            )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
