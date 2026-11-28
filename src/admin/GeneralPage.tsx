import {Button, Description, FieldError, Form, Input, Label, TextField} from "@heroui/react";
import {useEffect, useState, type FormEvent} from "react";
import {api} from "../lib/api.ts";
import {useText} from "../vendor/niltavi-ui/site/Locale.tsx";
import {Notice, Panel, State, errorText, useLoad, Loading} from "./ui.tsx";

export function GeneralPage({token}: {token: string}) {
  const text = useText();
  const general = useLoad(token, api.admin.general);
  const [savedAt, setSavedAt] = useState(0);

  if (general.error) {
    return <Notice status="danger" action={<Button size="sm" variant="secondary" onPress={general.reload}>{text("Try again", "重试")}</Button>}>
      {errorText(general.error, text)}
    </Notice>;
  }
  if (!general.data) return <Loading />;
  return (
    <>
      <h1 className="text-balance text-3xl font-semibold tracking-tight">{text("General", "常规")}</h1>
      {savedAt > 0 && <Notice status="success">{text("Saved.", "已保存。")}</Notice>}
      <GeneralForm key={JSON.stringify(general.data)} token={token} initial={general.data} onSaved={() => { setSavedAt(Date.now()); general.reload(); }} />
    </>
  );
}

function GeneralForm({token, initial, onSaved}: {token: string; initial: {publicOrigin: string; aiDailyQuota: number; aiConfigured: boolean}; onSaved: () => void}) {
  const text = useText();
  const [publicOrigin, setPublicOrigin] = useState(initial.publicOrigin);
  const [quota, setQuota] = useState(String(initial.aiDailyQuota));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [quotaError, setQuotaError] = useState("");

  useEffect(() => setQuotaError(""), [quota]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const value = Number(quota);
    if (!Number.isInteger(value) || value < 0 || value > 1000) {
      setQuotaError(text("Enter a whole number from 0 to 1000", "请填写 0 到 1000 之间的整数"));
      return;
    }
    setPending(true);
    try {
      await api.admin.saveGeneral(token, {publicOrigin: publicOrigin.trim(), aiDailyQuota: value});
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

      <Panel title={text("Public address", "公开地址")} description={text("The address people open Easel at. Niltavi Identity sends them back here after they sign in.", "用户打开 Easel 的地址。登录完成后，Niltavi Identity 会把用户带回这里。")}>
        <TextField name="publicOrigin" type="url" value={publicOrigin} onChange={setPublicOrigin} className="grid gap-2">
          <Label>{text("Address", "地址")}</Label>
          <Input placeholder="https://easel.example.com" autoComplete="off" />
          <Description>{text("Leave empty to use the value set on the server.", "留空则使用服务器上的设置。")}</Description>
          <FieldError />
        </TextField>
      </Panel>

      <Panel title="AI" description={text("How many AI drawing requests each account can make per day.", "每个账号每天可以使用 AI 画图的次数。")}
        aside={initial.aiConfigured ? <State color="success">{text("Connected", "已连接")}</State> : <State color="warning">{text("Not connected", "未连接")}</State>}>
        <TextField name="aiDailyQuota" type="number" value={quota} onChange={setQuota} isInvalid={Boolean(quotaError)} className="grid max-w-48 gap-2">
          <Label>{text("Requests per day", "每天次数")}</Label>
          <Input inputMode="numeric" min={0} max={1000} />
          {quotaError ? <FieldError>{quotaError}</FieldError> : <Description>{text("Use 0 to turn AI off for everyone.", "填 0 即可对所有人关闭 AI。")}</Description>}
        </TextField>
      </Panel>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" isPending={pending}>{text("Save", "保存")}</Button>
      </div>
    </Form>
  );
}
