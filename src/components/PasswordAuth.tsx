// Password sign-in and registration ported from niltavi-identity (web/src/auth.tsx and web/src/ui.tsx).
// Keep the markup and class names in step with that source; only the API calls and copy keys differ.
import {Button, FieldError, Form, InputGroup, Label, Link, TextField} from "@heroui/react";
import Envelope from "@gravity-ui/icons/Envelope";
import Eye from "@gravity-ui/icons/Eye";
import EyeSlash from "@gravity-ui/icons/EyeSlash";
import Lock from "@gravity-ui/icons/Lock";
import {useRef, useState, type FormEvent, type MouseEvent, type ReactNode} from "react";
import {t} from "../lib/i18n.ts";

type Rule = {minimum: number; maximum: number};
type Errors = {email?: string; password?: string; message?: string};
export type AuthLink = {href: string; onClick?: (event: MouseEvent<Element>) => void};

const REGISTER_RULE: Rule = {minimum: 8, maximum: 128};
const SIGN_IN_RULE: Rule = {minimum: 1, maximum: 256};

function readForm(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  return (name: string) => String(data.get(name) ?? "");
}

function passwordLength(value: string) { return [...value].length; }

function PageLink({to, children}: {to: AuthLink; children: ReactNode}) {
  return <Link href={to.href} onClick={to.onClick}>{children}</Link>;
}

function PasswordField({label, error, rule, onInput, submitted, autoComplete = "new-password"}:
  {label: string; error?: string; rule: Rule; onInput?: () => void; submitted?: boolean; autoComplete?: string}) {
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const length = passwordLength(value);
  const missing = rule.minimum - length;
  const lengthError = submitted && (missing > 0 ? t("auth.passwordMinimum", {minimum: rule.minimum})
    : length > rule.maximum ? t("auth.passwordMaximum", {maximum: rule.maximum}) : undefined);
  const message = lengthError || error;
  return <TextField name="password" type={visible ? "text" : "password"} autoComplete={autoComplete} isRequired isInvalid={Boolean(message)}
    value={value} onChange={(next) => { setValue(next); onInput?.(); }}>
    <Label>{label}</Label>
    <InputGroup>
      <InputGroup.Prefix><Lock aria-hidden="true" width={14} height={14} /></InputGroup.Prefix>
      <InputGroup.Input placeholder="••••••••" />
      <InputGroup.Suffix className="pe-0">
        <Button isIconOnly size="sm" variant="ghost" aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")} onPress={() => setVisible((v) => !v)}>
          {visible ? <EyeSlash aria-hidden="true" width={14} height={14} /> : <Eye aria-hidden="true" width={14} height={14} />}
        </Button>
      </InputGroup.Suffix>
    </InputGroup>
    <FieldError>{message}</FieldError>
  </TextField>;
}

function EmailField({error, defaultEmail, autoComplete, onInput}: {error?: string; defaultEmail?: string; autoComplete: string; onInput: () => void}) {
  return <TextField name="email" type="email" autoComplete={autoComplete} isRequired isInvalid={Boolean(error)}
    {...(defaultEmail ? {defaultValue: defaultEmail} : {})} onChange={onInput}>
    <Label>{t("auth.email")}</Label>
    <InputGroup>
      <InputGroup.Prefix><Envelope aria-hidden="true" width={14} height={14} /></InputGroup.Prefix>
      <InputGroup.Input placeholder="you@example.com" />
    </InputGroup>
    <FieldError>{error}</FieldError>
  </TextField>;
}

export function PasswordSignIn({title, defaultEmail, register, children, alternative, onSubmit}: {
  title: ReactNode; defaultEmail?: string; register?: AuthLink; children?: ReactNode; alternative?: ReactNode;
  onSubmit: (email: string, password: string) => Promise<string | void>;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const busy = useRef(false);
  return <div className="nt-auth nt-auth--signin nt-fade-up">
    {title}
    {children}
    <Form className="nt-auth__form" validationBehavior="native" onSubmit={(event) => {
      const field = readForm(event);
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      setMessage(undefined);
      void (async () => {
        try {
          setMessage(await onSubmit(field("email").trim(), field("password")) ?? undefined);
        } finally {
          busy.current = false;
          setPending(false);
        }
      })();
    }}>
      <EmailField defaultEmail={defaultEmail} autoComplete="username" onInput={() => setMessage(undefined)} />
      <PasswordField label={t("auth.password")} rule={SIGN_IN_RULE} error={message}
        onInput={() => setMessage(undefined)} autoComplete="current-password" />
      <Button type="submit" isPending={pending} className="w-full">{t("common.signIn")}</Button>
    </Form>
    {alternative}
    {register && <div className="nt-auth__alt">
      <p className="nt-auth__links">{t("auth.newHere")}<PageLink to={register}>{t("auth.toRegister")}</PageLink></p>
    </div>}
  </div>;
}

export function PasswordRegister({title, defaultEmail, signIn, children, alternative, onSubmit}: {
  title: ReactNode; defaultEmail?: string; signIn: AuthLink; children?: ReactNode; alternative?: ReactNode;
  onSubmit: (email: string, password: string) => Promise<Errors | void>;
}) {
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const busy = useRef(false);
  async function send(event: FormEvent<HTMLFormElement>) {
    const field = readForm(event);
    if (busy.current) return;
    setSubmitted(true);
    const password = field("password");
    if (passwordLength(password) < REGISTER_RULE.minimum || passwordLength(password) > REGISTER_RULE.maximum) return;
    busy.current = true;
    setPending(true);
    setErrors({});
    try { setErrors(await onSubmit(field("email").trim(), password) ?? {}); }
    finally {
      busy.current = false;
      setPending(false);
    }
  }
  const clear = (name: "email" | "password") => setErrors(({[name]: _removed, ...rest}) => rest);
  return <div className="nt-auth nt-fade-up">
    <div className="nt-auth__head">{title}</div>
    {children}
    <Form className="nt-auth__form" method="post" onSubmit={(event) => void send(event)} validationBehavior="native">
      <EmailField error={errors.email} defaultEmail={defaultEmail} autoComplete="email" onInput={() => clear("email")} />
      <PasswordField label={t("auth.password")} rule={REGISTER_RULE} error={errors.password} onInput={() => clear("password")} submitted={submitted} />
      <Button type="submit" isPending={pending} className="w-full">{t("auth.createAccount")}</Button>
      {errors.message && <p role="alert" className="text-danger">{errors.message}</p>}
    </Form>
    {alternative}
    <p className="nt-auth__links nt-auth__foot"><PageLink to={signIn}>{t("auth.signInInstead")}</PageLink></p>
  </div>;
}
