import {BarsDescendingAlignLeft, ArrowRightFromSquare, Cloud, CloudArrowUpIn, CloudCheck, Display, Ellipsis, FileArrowUp, Person, Plus} from "@gravity-ui/icons";
import {Button, Dropdown, Label, SearchField, Separator} from "@heroui/react";
import {useMemo, useState, type ReactNode} from "react";
import {STATUS_LABEL, workStatus, type Session, type WorkMeta, type WorkStatus} from "../lib/types.ts";

export type WorkAction = "rename" | "duplicate" | "sync-on" | "sync-off" | "export" | "delete";

const STATUS_ICON: Record<WorkStatus, ReactNode> = {
  local: <Display aria-hidden width={12} height={12} />,
  pending: <CloudArrowUpIn aria-hidden width={12} height={12} />,
  synced: <CloudCheck aria-hidden width={12} height={12} />,
  remote: <Cloud aria-hidden width={12} height={12} />,
};

/** Where a work is stored and its sync status. In compact mode only the icon stays; the text moves into the tooltip and the screen-reader name. */
export function StatusLine({work, compact = false}: {work: WorkMeta; compact?: boolean}) {
  const status = workStatus(work);
  if (compact) {
    return (
      <span className="easel-status easel-status--icon" data-status={status} role="img" aria-label={STATUS_LABEL[status]} title={STATUS_LABEL[status]}>
        {STATUS_ICON[status]}
      </span>
    );
  }
  return (
    <span className="easel-status" data-status={status}>
      {STATUS_ICON[status]}
      {STATUS_LABEL[status]}
    </span>
  );
}

type SortKey = "updated" | "opened" | "name" | "created";

const SORTS: {key: SortKey; label: string}[] = [
  {key: "updated", label: "最近修改"},
  {key: "opened", label: "最近打开"},
  {key: "name", label: "名称"},
  {key: "created", label: "创建时间"},
];

const SORT_STORAGE = "easel.sort";

function readSort(): SortKey {
  try {
    const stored = localStorage.getItem(SORT_STORAGE);
    if (SORTS.some((sort) => sort.key === stored)) return stored as SortKey;
  } catch {
    // Fall back to the default sort if it can't be read
  }
  return "updated";
}

const collator = new Intl.Collator("zh-CN", {numeric: true, sensitivity: "base"});

function sortWorks(works: WorkMeta[], key: SortKey): WorkMeta[] {
  // The incoming list is already sorted by most recently modified.
  if (key === "updated") return works;
  const sorted = [...works];
  if (key === "name") sorted.sort((a, b) => collator.compare(a.name, b.name));
  else if (key === "created") sorted.sort((a, b) => b.createdAt - a.createdAt);
  else sorted.sort((a, b) => b.openedAt - a.openedAt);
  return sorted;
}

export function WorkMenuItems({work}: {work: WorkMeta}) {
  const status = workStatus(work);
  if (status === "remote") {
    return (
      <Dropdown.Item key="delete" id="delete" textValue="删除" variant="danger">
        <Label>删除</Label>
      </Dropdown.Item>
    );
  }
  return (
    <>
      <Dropdown.Item key="rename" id="rename" textValue="重命名">
        <Label>重命名</Label>
      </Dropdown.Item>
      <Dropdown.Item key="duplicate" id="duplicate" textValue="创建副本">
        <Label>创建副本</Label>
      </Dropdown.Item>
      <Dropdown.Item key="export" id="export" textValue="导出文件">
        <Label>导出文件</Label>
      </Dropdown.Item>
      {work.cloud ? (
        <Dropdown.Item key="sync-off" id="sync-off" textValue="关闭云同步">
          <Label>关闭云同步</Label>
        </Dropdown.Item>
      ) : (
        <Dropdown.Item key="sync-on" id="sync-on" textValue="开启云同步">
          <Label>开启云同步</Label>
        </Dropdown.Item>
      )}
      <Dropdown.Item key="delete" id="delete" textValue="删除" variant="danger">
        <Label>删除</Label>
      </Dropdown.Item>
    </>
  );
}

interface Props {
  works: WorkMeta[];
  currentId: string | null;
  session: Session | null;
  onOpen: (id: string) => void;
  onAction: (action: WorkAction, work: WorkMeta) => void;
  onNew: () => void;
  onImport: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function WorkList({works, currentId, session, onOpen, onAction, onNew, onImport, onSignIn, onSignOut}: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>(readSort);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sortWorks(needle ? works.filter((work) => work.name.toLowerCase().includes(needle)) : works, sort);
  }, [works, query, sort]);
  const chooseSort = (key: SortKey) => {
    setSort(key);
    try {
      localStorage.setItem(SORT_STORAGE, key);
    } catch {
      // Failing to remember it doesn't affect the sort this time
    }
  };

  return (
    <div className="easel-works">
      <div className="easel-works__head">
        <h2 className="easel-works__title">个人工作区</h2>
        <Dropdown>
          <Button isIconOnly size="sm" variant="ghost" aria-label={`排序方式：${SORTS.find((item) => item.key === sort)?.label}`}>
            <BarsDescendingAlignLeft aria-hidden />
          </Button>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu
              aria-label="排序方式"
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[sort]}
              onSelectionChange={(keys) => {
                const next = [...(keys as Set<string>)][0] as SortKey | undefined;
                if (next) chooseSort(next);
              }}
            >
              {SORTS.map((item) => (
                <Dropdown.Item key={item.key} id={item.key} textValue={item.label}>
                  <Dropdown.ItemIndicator />
                  <Label>{item.label}</Label>
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        <Button isIconOnly size="sm" variant="ghost" aria-label="导入文件" onPress={onImport}>
          <FileArrowUp aria-hidden />
        </Button>
        <Button isIconOnly size="sm" variant="secondary" aria-label="新建作品" onPress={onNew}>
          <Plus aria-hidden />
        </Button>
      </div>
      <SearchField aria-label="按名称搜索作品" value={query} onChange={setQuery} className="easel-works__search">
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="搜索作品" />
          <SearchField.ClearButton aria-label="清除搜索" />
        </SearchField.Group>
      </SearchField>
      <nav aria-label="作品" className="easel-works__list">
        {filtered.length === 0 && <p className="easel-works__empty">没有名称包含“{query.trim()}”的作品</p>}
        {filtered.map((work) => (
          <div key={work.id} className="easel-work" data-current={work.id === currentId ? "" : undefined}>
            <button type="button" className="easel-work__open" aria-current={work.id === currentId ? "page" : undefined} onClick={() => onOpen(work.id)}>
              <span className="easel-work__name">{work.name}</span>
              <StatusLine work={work} />
            </button>
            <Dropdown>
              <Button isIconOnly size="sm" variant="ghost" aria-label={`「${work.name}」的更多操作`} className="easel-work__more">
                <Ellipsis aria-hidden />
              </Button>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu onAction={(key) => onAction(key as WorkAction, work)}>
                  <WorkMenuItems work={work} />
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        ))}
      </nav>
      <Separator />
      <div className="easel-works__account">
        {session ? (
          <>
            <Person aria-hidden className="easel-works__avatar" />
            <div className="easel-works__who">
              <span className="easel-works__email">{session.user.email}</span>
              {session.expired && <span className="easel-works__hint">登录已过期</span>}
            </div>
            {session.expired && (
              <Button size="sm" variant="secondary" onPress={onSignIn}>
                重新登录
              </Button>
            )}
            <Button isIconOnly size="sm" variant="ghost" aria-label="退出登录" onPress={onSignOut}>
              <ArrowRightFromSquare aria-hidden />
            </Button>
          </>
        ) : (
          <>
            <p className="easel-works__hint">作品保存在这台设备上。登录后可以为单件作品开启云同步。</p>
            <Button size="sm" variant="secondary" onPress={onSignIn}>
              登录
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
