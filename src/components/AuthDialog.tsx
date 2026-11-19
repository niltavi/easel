import {Button, Description, FieldError, Form, Input, InputOTP, Label, Modal, TextField} from "@heroui/react";
import {useEffect, useState} from "react";
import {ApiError} from "../lib/api.ts";
import {t} from "../lib/i18n.ts";
import {requestCode, verifyCode} from "../lib/sync.ts";

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
            <Modal.Heading>{step === "email" ? t("auth.title") : t("auth.codeTitle")}</Modal.Heading>
            <p className="mt-1.5 text-sm leading-6 text-muted">
              {step === "email" ? (reason ?? t("auth.intro")) : t("auth.codeSent", {email: email.trim()})}
            </p>
          </Modal.Header>
          <Modal.Body>
            {step === "email" ? (
              <Form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <TextField isRequired name="email" type="email" value={email} onChange={setEmail} isInvalid={error !== ""} autoFocus>
                  <Label>{t("auth.email")}</Label>
                  <Input placeholder="name@example.com" autoComplete="email" inputMode="email" />
                  {error ? <FieldError>{error}</FieldError> : null}
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
                  {error ? <p className="text-sm text-danger" role="alert">{error}</p> : <Description>{t("auth.noCode")}</Description>}
                </div>
                <Button type="submit" variant="primary" isPending={pending} isDisabled={code.length !== 6} className="w-full">
                  {t("common.signIn")}
                </Button>
                <div className="flex items-center justify-between gap-2">
                  <Button size="sm" variant="ghost" className="-ms-2.5" onPress={() => { setStep("email"); setError(""); }}>
                    {t("auth.changeEmail")}
                  </Button>
                  <Button size="sm" variant="ghost" className="-me-2.5" isDisabled={wait > 0 || pending} onPress={() => void send()}>
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
