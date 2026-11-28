import {Button, Form, Switch} from "@heroui/react";
import {buttonVariants} from "@heroui/styles";
import {useState, type FormEvent} from "react";
import type {AdminSignIn} from "../../shared/api.ts";
import {api} from "../lib/api.ts";
import {adminHref, type Locale} from "../site/routes.ts";
import {useLocale, useText} from "../vendor/niltavi-ui/site/Locale.tsx";
import {Loading, Notice, Panel, State, errorText, useLoad} from "./ui.tsx";

export function SignInPage({token}: {token: string}) {
  const text = useText();
  const locale = useLocale();
  const signIn = useLoad(token, api.admin.signIn);
  // Saving reloads the settings and remounts the form, so the confirmation is kept here.
  const [savedAt, setSavedAt] = useState(0);

  if (signIn.error) {
    return <Notice status="danger" action={<Button size="sm" variant="secondary" onPress={signIn.reload}>{text("Try again", "重试")}</Button>}>
      {errorText(signIn.error, text)}
    </Notice>;
  }
  if (!signIn.data) return <Loading />;
  return (
    <>
      <h1 className="text-balance text-3xl font-semibold tracking-tight">{text("Sign-in", "登录方式")}</h1>
      {savedAt > 0 && <Notice status="success">{text("Saved.", "已保存。")}</Notice>}
      <MethodsForm
        key={JSON.stringify(signIn.data)}
        token={token}
        initial={signIn.data}
        locale={locale}
        onSaved={() => { setSavedAt(Date.now()); signIn.reload(); }}
      />
    </>
  );
}

function MethodsForm({token, initial, locale, onSaved}: {token: string; initial: AdminSignIn; locale: Locale; onSaved: () => void}) {
  const text = useText();
  const [localLogin, setLocalLogin] = useState(initial.localLogin);
  const [identityLogin, setIdentityLogin] = useState(initial.identityLogin);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const changed = localLogin !== initial.localLogin || identityLogin !== initial.identityLogin;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api.admin.saveSignIn(token, {localLogin, identityLogin});
      onSaved();
    } catch (cause) {
      setError(errorText(cause, text));
    } finally {
      setPending(false);
    }
  };

  return (
    <Form className="grid gap-6" onSubmit={save} validationBehavior="native">
      {error && <Notice status="danger">{error}</Notice>}

      <Panel title={text("Sign-in methods", "登录方式")} description={text("Keep at least one method on that works.", "至少保留一种可用的登录方式。")}>
        <div className="grid divide-y divide-separator">
          <div className="flex items-center justify-between gap-4 py-4 first:pt-0">
            <div className="grid gap-1">
              <span className="font-medium">{text("Email and password", "邮箱和密码")}</span>
              <span className="text-sm text-muted">{text("Accounts created on this server.", "在这台服务器上注册的账号。")}</span>
            </div>
            <Switch isSelected={localLogin} onChange={setLocalLogin} aria-label={text("Email and password", "邮箱和密码")}>
              <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content>
            </Switch>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 py-4 last:pb-0">
            <div className="grid min-w-0 gap-1">
              <span className="font-medium">Niltavi Identity</span>
              <span className="text-sm text-muted">{text("Users sign in with their Niltavi account.", "用户使用 Niltavi 账号登录。")}</span>
            </div>
            <div className="flex items-center gap-3">
              {identityLogin && (initial.identity.ready
                ? <State color="success">{text("Ready", "已就绪")}</State>
                : <State color="warning">{text("Not set up", "未设置完成")}</State>)}
              {identityLogin && (
                <a className={buttonVariants({variant: "secondary", size: "sm"})} href={adminHref("sign-in/identity", locale)}>
                  {text("Configure", "配置")}
                </a>
              )}
              <Switch isSelected={identityLogin} onChange={setIdentityLogin} aria-label="Niltavi Identity">
                <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content>
              </Switch>
            </div>
          </div>
        </div>
      </Panel>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" isPending={pending} isDisabled={!changed}>{text("Save", "保存")}</Button>
      </div>
    </Form>
  );
}
