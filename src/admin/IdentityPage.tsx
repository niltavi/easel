import {Button, Description, FieldError, Form, Input, Label, TextField} from "@heroui/react";
import {buttonVariants} from "@heroui/styles";
import {Copy} from "@gravity-ui/icons";
import {useState, type FormEvent} from "react";
import type {AdminSignIn} from "../../shared/api.ts";
import {api} from "../lib/api.ts";
import {adminHref, type Locale} from "../site/routes.ts";
import {useLocale, useText} from "../vendor/niltavi-ui/site/Locale.tsx";
import {Loading, Notice, Panel, State, errorText, useLoad} from "./ui.tsx";

/** Second-level page: the Identity connection. Only reachable while Identity is turned on. */
export function IdentityPage({token}: {token: string}) {
  const text = useText();
  const locale = useLocale();
  const signIn = useLoad(token, api.admin.signIn);
  const [savedAt, setSavedAt] = useState(0);

  const back = (
    <nav aria-label={text("Breadcrumb", "路径")} className="flex items-center gap-2 text-sm text-muted">
      <a className="underline underline-offset-4 hover:text-foreground" href={adminHref("sign-in", locale)}>{text("Sign-in", "登录方式")}</a>
      <span aria-hidden="true">/</span>
      <span className="text-foreground">Niltavi Identity</span>
    </nav>
  );

  if (signIn.error) {
    return <Notice status="danger" action={<Button size="sm" variant="secondary" onPress={signIn.reload}>{text("Try again", "重试")}</Button>}>
      {errorText(signIn.error, text)}
    </Notice>;
  }
  if (!signIn.data) return <Loading />;

  if (!signIn.data.identityLogin) {
    return (
      <>
        {back}
        <h1 className="text-balance text-3xl font-semibold tracking-tight">Niltavi Identity</h1>
        <Notice status="default" action={<a className={buttonVariants({variant: "secondary", size: "sm"})} href={adminHref("sign-in", locale)}>{text("Go to sign-in", "前往登录方式")}</a>}>
          {text("Turn on Niltavi Identity in sign-in methods first. Its settings are available once it is on.", "请先在登录方式中开启 Niltavi Identity，开启后才能进行配置。")}
        </Notice>
      </>
    );
  }

  return (
    <>
      {back}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-balance text-3xl font-semibold tracking-tight">Niltavi Identity</h1>
        <State color={signIn.data.identity.ready ? "success" : "warning"}>
          {signIn.data.identity.ready ? text("Ready", "已就绪") : text("Not set up", "未设置完成")}
        </State>
      </div>
      {savedAt > 0 && <Notice status="success">{text("Saved.", "已保存。")}</Notice>}
      <IdentityForm
        key={JSON.stringify(signIn.data)}
        token={token}
        initial={signIn.data}
        onSaved={() => { setSavedAt(Date.now()); signIn.reload(); }}
      />
    </>
  );
}

function IdentityForm({token, initial, onSaved}: {token: string; initial: AdminSignIn; onSaved: () => void}) {
  const text = useText();
  const identity = initial.identity;
  const [issuer, setIssuer] = useState(identity.issuer);
  const [appId, setAppId] = useState(identity.appId);
  const [appSecret, setAppSecret] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ok: boolean; message: string}>();

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api.admin.saveSignIn(token, {
        localLogin: initial.localLogin,
        identityLogin: initial.identityLogin,
        identity: {issuer: issuer.trim(), appId: appId.trim(), appSecret: appSecret.trim() || undefined},
      });
      setAppSecret("");
      onSaved();
    } catch (cause) {
      setError(errorText(cause, text));
    } finally {
      setPending(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(undefined);
    try {
      const result = await api.admin.testIdentity(token, issuer.trim() || undefined);
      setTest({ok: true, message: text(`Connected to ${result.issuer}.`, `已连接到 ${result.issuer}。`)});
    } catch (cause) {
      setTest({ok: false, message: errorText(cause, text)});
    } finally {
      setTesting(false);
    }
  };

  return (
    <Form className="grid gap-6" onSubmit={save} validationBehavior="native">
      {error && <Notice status="danger">{error}</Notice>}

      <Panel title={text("Connection", "连接")} description={text("Register Easel as an application in Niltavi Identity, then fill in the details.", "先在 Niltavi Identity 中把 Easel 注册为应用，再填写以下信息。")}>
        <TextField name="issuer" type="url" value={issuer} onChange={setIssuer} isRequired className="grid gap-2">
          <Label>{text("Identity address", "Identity 地址")}</Label>
          <Input placeholder="https://identity.niltavi.com" autoComplete="off" />
          <Description>{text("The address where Identity is hosted.", "Identity 所在的地址。")}</Description>
          <FieldError />
        </TextField>
        <TextField name="appId" value={appId} onChange={setAppId} isRequired className="grid gap-2">
          <Label>{text("App ID", "应用 ID")}</Label>
          <Input autoComplete="off" />
          <FieldError />
        </TextField>
        <TextField name="appSecret" type="password" value={appSecret} onChange={setAppSecret} isRequired={!identity.appSecretSaved} className="grid gap-2">
          <Label>{text("App secret", "应用密钥")}</Label>
          <Input autoComplete="new-password" />
          <Description>
            {identity.appSecretSaved ? text("Saved. Leave empty to keep it.", "已保存。留空则保持不变。") : text("Stored on the server and never shown again.", "保存在服务器上，之后不再显示。")}
          </Description>
          <FieldError />
        </TextField>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" isPending={testing} isDisabled={!issuer.trim()} onPress={() => void runTest()}>
            {text("Test connection", "测试连接")}
          </Button>
        </div>
        {test && <Notice status={test.ok ? "success" : "danger"}>{test.message}</Notice>}
      </Panel>

      <Panel title={text("Callback address", "回调地址")} description={text("Add this address to the application in Niltavi Identity.", "把这个地址填到 Niltavi Identity 的应用设置中。")}>
        {identity.callbackUrl ? (
          <div className="flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-secondary px-3 py-2 text-sm">{identity.callbackUrl}</code>
            <Button size="sm" variant="ghost" isIconOnly aria-label={text("Copy callback address", "复制回调地址")}
              onPress={() => void navigator.clipboard?.writeText(identity.callbackUrl!)}>
              <Copy aria-hidden="true" width={16} height={16} />
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">{text("Set the public address in General to get the callback address.", "在「常规」里设置公开地址后，这里会显示回调地址。")}</p>
        )}
      </Panel>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" isPending={pending}>{text("Save", "保存")}</Button>
      </div>
    </Form>
  );
}
