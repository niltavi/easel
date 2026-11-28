import {Button, Dropdown, Input, Label, Table, TextField} from "@heroui/react";
import {useState} from "react";
import type {AdminAccount} from "../../shared/api.ts";
import {api} from "../lib/api.ts";
import {useLocale, useText} from "../vendor/niltavi-ui/site/Locale.tsx";
import {Empty, Loading, Notice, State, errorText, useLoad} from "./ui.tsx";

export function AccountsPage({token, me}: {token: string; me: string}) {
  const text = useText();
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<{status: "danger" | "success"; message: string}>();
  const [pending, setPending] = useState<string>();
  const accounts = useLoad(token, (value) => api.admin.accounts(value, query), [query]);

  const setRole = async (account: AdminAccount, role: "admin" | "user") => {
    setPending(account.id);
    setNotice(undefined);
    try {
      await api.admin.setRole(token, account.id, role);
      setNotice({
        status: "success",
        message: role === "admin"
          ? text(`${account.email} is now an administrator.`, `${account.email} 已成为管理员。`)
          : text(`${account.email} is no longer an administrator.`, `${account.email} 不再是管理员。`),
      });
      accounts.reload();
    } catch (cause) {
      setNotice({status: "danger", message: errorText(cause, text)});
    } finally {
      setPending(undefined);
    }
  };

  const locale = useLocale();
  const dateFormat = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {dateStyle: "medium"});

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-balance text-3xl font-semibold tracking-tight">{text("Accounts", "账号")}</h1>
        <TextField type="search" aria-label={text("Search by email", "按邮箱搜索")} value={query} onChange={setQuery} className="w-full max-w-72">
          <Input placeholder={text("Search by email", "按邮箱搜索")} />
        </TextField>
      </div>

      {notice && <Notice status={notice.status}>{notice.message}</Notice>}

      {accounts.error ? (
        <Notice status="danger" action={<Button size="sm" variant="secondary" onPress={accounts.reload}>{text("Try again", "重试")}</Button>}>
          {errorText(accounts.error, text)}
        </Notice>
      ) : !accounts.data ? <Loading />
        : accounts.data.accounts.length === 0 ? <Empty>{query ? text("No accounts match.", "没有匹配的账号。") : text("No accounts yet.", "还没有账号。")}</Empty>
        : (
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label={text("Accounts", "账号")} className="min-w-[26rem]">
                <Table.Header>
                  <Table.Column isRowHeader>{text("Account", "账号")}</Table.Column>
                  <Table.Column>{text("Role", "角色")}</Table.Column>
                  <Table.Column aria-label={text("Actions", "操作")} />
                </Table.Header>
                <Table.Body>
                  {accounts.data.accounts.map((account) => {
                    const self = account.id === me;
                    return (
                      <Table.Row key={account.id} id={account.id}>
                        <Table.Cell>
                          <div className="grid min-w-0 gap-0.5">
                            <span className="font-medium wrap-anywhere">{account.email}</span>
                            <span className="text-sm text-muted">
                              {[account.name, account.identity ? "Niltavi Identity" : text("Email and password", "邮箱和密码"), text(`${account.works} works`, `${account.works} 件作品`), dateFormat.format(new Date(account.createdAt))].filter(Boolean).join(" · ")}
                            </span>
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex gap-1.5">
                            {account.role === "admin"
                              ? <State color="accent">{text("Administrator", "管理员")}</State>
                              : <State>{text("Member", "成员")}</State>}
                            {self && <State color="success">{text("You", "你")}</State>}
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          {!self && (
                            <Dropdown>
                              <Button size="sm" variant="secondary" isPending={pending === account.id} aria-label={text(`Manage ${account.email}`, `管理 ${account.email}`)}>
                                {text("Manage", "管理")}
                              </Button>
                              <Dropdown.Popover placement="bottom end">
                                <Dropdown.Menu aria-label={text(`Manage ${account.email}`, `管理 ${account.email}`)}
                                  onAction={(key) => void setRole(account, String(key) === "make-admin" ? "admin" : "user")}>
                                  {account.role === "admin"
                                    ? <Dropdown.Item id="remove-admin" textValue={text("Remove administrator", "取消管理员")} variant="danger"><Label>{text("Remove administrator", "取消管理员")}</Label></Dropdown.Item>
                                    : <Dropdown.Item id="make-admin" textValue={text("Make administrator", "设为管理员")}><Label>{text("Make administrator", "设为管理员")}</Label></Dropdown.Item>}
                                </Dropdown.Menu>
                              </Dropdown.Popover>
                            </Dropdown>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}
    </>
  );
}
