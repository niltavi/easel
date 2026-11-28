import {Button, Card} from "@heroui/react";
import {buttonVariants} from "@heroui/styles";
import {api} from "../lib/api.ts";
import {useText} from "../vendor/niltavi-ui/site/Locale.tsx";
import {adminHref, type Locale} from "../site/routes.ts";
import {Notice, Panel, State, errorText, useLoad, Loading} from "./ui.tsx";

export function OverviewPage({token, locale}: {token: string; locale: Locale}) {
  const text = useText();
  const overview = useLoad(token, api.admin.overview);

  if (overview.error) {
    return <Notice status="danger" action={<Button size="sm" variant="secondary" onPress={overview.reload}>{text("Try again", "重试")}</Button>}>
      {errorText(overview.error, text)}
    </Notice>;
  }
  if (!overview.data) return <Loading />;
  const data = overview.data;

  const stats = [
    {label: text("Accounts", "账号"), value: data.counts.accounts},
    {label: text("Administrators", "管理员"), value: data.counts.admins},
    {label: text("Niltavi Identity accounts", "Niltavi Identity 账号"), value: data.counts.identityAccounts},
    {label: text("Works", "作品"), value: data.counts.works},
  ];

  const identityState = data.identityReady
    ? data.identityLogin ? {color: "success" as const, label: text("On", "已开启")} : {color: "default" as const, label: text("Off", "已关闭")}
    : {color: "warning" as const, label: text("Not set up", "未设置")};

  return (
    <>
      <h1 className="text-balance text-3xl font-semibold tracking-tight">{text("Overview", "概览")}</h1>

      {!data.publicOrigin && (
        <Notice status="warning" action={<a className={buttonVariants({variant: "secondary", size: "sm"})} href={adminHref("general", locale)}>{text("Set the public address", "设置公开地址")}</a>}>
          {text("No public address yet. Niltavi Identity can't send people back to Easel until one is set.", "还没有公开地址，Niltavi Identity 无法把用户带回 Easel。")}
        </Notice>
      )}
      {!data.aiConfigured && (
        <Notice status="default">{text("AI isn't connected. Drawing with AI is unavailable until the server is set up for it.", "尚未连接 AI 服务，服务器配置完成后才能用 AI 画图。")}</Notice>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="min-w-0">
            <Card.Content className="grid gap-2">
              <span className="text-sm text-muted">{stat.label}</span>
              <strong className="text-3xl font-semibold tabular-nums tracking-tight">{stat.value}</strong>
            </Card.Content>
          </Card>
        ))}
      </div>

      <Panel title={text("Sign-in", "登录方式")} aside={<a className={buttonVariants({variant: "tertiary", size: "sm"})} href={adminHref("sign-in", locale)}>{text("Manage", "管理")}</a>}>
        <div className="grid gap-4">
          <div className="flex items-center justify-between gap-4">
            <span className="font-medium">{text("Email and password", "邮箱和密码")}</span>
            <State color={data.localLogin ? "success" : "default"}>{data.localLogin ? text("On", "已开启") : text("Off", "已关闭")}</State>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-separator pt-4">
            <span className="font-medium">Niltavi Identity</span>
            <State color={identityState.color}>{identityState.label}</State>
          </div>
        </div>
      </Panel>
    </>
  );
}
