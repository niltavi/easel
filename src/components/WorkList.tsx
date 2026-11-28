import {BarsDescendingAlignLeft, ArrowRightFromSquare, Cloud, CloudArrowUpIn, CloudCheck, Display, Ellipsis, FileArrowUp, Person, Plus} from "@gravity-ui/icons";
import {Button, Dropdown, Label, SearchField, Separator} from "@heroui/react";
import {useMemo, useState, type ReactNode} from "react";
import {locale, t, type MessageKey} from "../lib/i18n.ts";
import {workStatus, type Session, type WorkMeta, type WorkStatus} from "../lib/types.ts";

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
  const label = t(`status.${status}`);
  if (compact) {
    return (
      <span className="easel-status easel-status--icon" data-status={status} role="img" aria-label={label} title={label}>
        {STATUS_ICON[status]}
      </span>
    );
  }
  return (
    <span className="easel-status" data-status={status}>
      {STATUS_ICON[status]}
      {label}
    </span>
  );
}

type SortKey = "updated" | "opened" | "name" | "created";

const SORTS: {key: SortKey; label: MessageKey}[] = [
  {key: "updated", label: "sort.updated"},
  {key: "opened", label: "sort.opened"},
  {key: "name", label: "sort.name"},
  {key: "created", label: "sort.created"},
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

const collators = {
  en: new Intl.Collator("en", {numeric: true, sensitivity: "base"}),
  "zh-CN": new Intl.Collator("zh-CN", {numeric: true, sensitivity: "base"}),
};

function sortWorks(works: WorkMeta[], key: SortKey, language: typeof locale): WorkMeta[] {
  // The incoming list is already sorted by most recently modified.
  if (key === "updated") return works;
  const sorted = [...works];
  if (key === "name") sorted.sort((a, b) => collators[language].compare(a.name, b.name));
  else if (key === "created") sorted.sort((a, b) => b.createdAt - a.createdAt);
  else sorted.sort((a, b) => b.openedAt - a.openedAt);
  return sorted;
}

export function WorkMenuItems({work}: {work: WorkMeta}) {
  const status = workStatus(work);
  if (status === "remote") {
    return (
      <Dropdown.Item key="delete" id="delete" textValue={t("common.delete")} variant="danger">
        <Label>{t("common.delete")}</Label>
      </Dropdown.Item>
    );
  }
  return (
    <>
      <Dropdown.Item key="rename" id="rename" textValue={t("common.rename")}>
        <Label>{t("common.rename")}</Label>
      </Dropdown.Item>
      <Dropdown.Item key="duplicate" id="duplicate" textValue={t("menu.duplicate")}>
        <Label>{t("menu.duplicate")}</Label>
      </Dropdown.Item>
      <Dropdown.Item key="export" id="export" textValue={t("common.exportFile")}>
        <Label>{t("common.exportFile")}</Label>
      </Dropdown.Item>
      {work.cloud ? (
        <Dropdown.Item key="sync-off" id="sync-off" textValue={t("menu.syncOff")}>
          <Label>{t("menu.syncOff")}</Label>
        </Dropdown.Item>
      ) : (
        <Dropdown.Item key="sync-on" id="sync-on" textValue={t("menu.syncOn")}>
          <Label>{t("menu.syncOn")}</Label>
        </Dropdown.Item>
      )}
      <Dropdown.Item key="delete" id="delete" textValue={t("common.delete")} variant="danger">
        <Label>{t("common.delete")}</Label>
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
    return sortWorks(needle ? works.filter((work) => work.name.toLowerCase().includes(needle)) : works, sort, locale);
  }, [works, query, sort, locale]);
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
        <h2 className="easel-works__title">{t("works.workspace")}</h2>
        <Dropdown>
          <Button isIconOnly size="sm" variant="ghost" aria-label={t("sort.current", {label: t(SORTS.find((item) => item.key === sort)?.label ?? "sort.updated")})}>
            <BarsDescendingAlignLeft aria-hidden />
          </Button>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu
              aria-label={t("sort.label")}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[sort]}
              onSelectionChange={(keys) => {
                const next = [...(keys as Set<string>)][0] as SortKey | undefined;
                if (next) chooseSort(next);
              }}
            >
              {SORTS.map((item) => (
                <Dropdown.Item key={item.key} id={item.key} textValue={t(item.label)}>
                  <Dropdown.ItemIndicator />
                  <Label>{t(item.label)}</Label>
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t("common.importFile")} onPress={onImport}>
          <FileArrowUp aria-hidden />
        </Button>
        <Button isIconOnly size="sm" variant="secondary" aria-label={t("works.new")} onPress={onNew}>
          <Plus aria-hidden />
        </Button>
      </div>
      <SearchField aria-label={t("works.searchLabel")} value={query} onChange={setQuery} className="easel-works__search">
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder={t("works.search")} />
          <SearchField.ClearButton aria-label={t("works.clearSearch")} />
        </SearchField.Group>
      </SearchField>
      <nav aria-label={t("works.nav")} className="easel-works__list">
        {filtered.length === 0 && <p className="easel-works__empty">{t("works.empty", {query: query.trim()})}</p>}
        {filtered.map((work) => (
          <div key={work.id} className="easel-work" data-current={work.id === currentId ? "" : undefined}>
            <button type="button" className="easel-work__open" aria-current={work.id === currentId ? "page" : undefined} onClick={() => onOpen(work.id)}>
              <span className="easel-work__name">{work.name}</span>
              <StatusLine work={work} />
            </button>
            <Dropdown>
              <Button isIconOnly size="sm" variant="ghost" aria-label={t("works.more", {name: work.name})} className="easel-work__more">
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
              {session.expired && <span className="easel-works__hint">{t("session.expired")}</span>}
            </div>
            {session.expired && (
              <Button size="sm" variant="secondary" onPress={onSignIn}>
                {t("common.signInAgain")}
              </Button>
            )}
            <Button isIconOnly size="sm" variant="ghost" aria-label={t("common.signOut")} onPress={onSignOut}>
              <ArrowRightFromSquare aria-hidden />
            </Button>
          </>
        ) : (
          <>
            <p className="easel-works__hint">{t("works.guestHint")}</p>
            <Button size="sm" variant="secondary" onPress={onSignIn}>
              {t("common.signIn")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
