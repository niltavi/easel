import {ArrowsExpand, Bars, CloudSlash, Ellipsis, LayoutSideContentLeft} from "@gravity-ui/icons";
import {AlertDialog, Button, Drawer, Dropdown, Input, Label, Modal, Spinner, TextField, Toast, toast, Tooltip} from "@heroui/react";
import {useCallback, useEffect, useRef, useState} from "react";
import {countObjects, MAX_AI_OBJECTS, validateOps} from "../../shared/diagram.ts";
import {sanitizeScene} from "../editor/adapter.ts";
import {downloadBlob, easelFileName, pickFile} from "../editor/download.ts";
import {Editor, type EditorHandle, type EditorUi} from "../editor/Editor.tsx";
import {DEFAULT_INK} from "../editor/tools.ts";
import {api, ApiError} from "../lib/api.ts";
import {EASEL_EXTENSION, EaselFileError} from "../lib/file.ts";
import {useAppState, useIsMobile, useTheme} from "../lib/hooks.ts";
import {localeName, otherLocale, setLocale, t} from "../lib/i18n.ts";
import {currentWork, getState, notify, onNotice, setState, ui as uiBridge, visibleWorks} from "../lib/state.ts";
import {activeSession, authConfig, disableSync, enableSync, expireSession, handleAuthCallback, openWork, refreshQuota, signOut, syncNow} from "../lib/sync.ts";
import {workStatus, type WorkMeta} from "../lib/types.ts";
import {createWork, duplicateWork, exportDocument, importDocument, loadWorkspace, removeWork, renameWork} from "../lib/works.ts";
import {AiPanel} from "./AiPanel.tsx";
import {AuthDialog} from "./AuthDialog.tsx";
import {EditorToolbar, PreviewBar} from "./Toolbar.tsx";
import {StatusLine, WorkList, WorkMenuItems, type WorkAction} from "./WorkList.tsx";

const SIDEBAR_KEY = "easel:sidebar";
const INITIAL_UI: EditorUi = {tool: "select", selected: 0, strokeColor: DEFAULT_INK, strokeWidth: 2, preview: null};

let started = false;

function start() {
  if (started) return;
  started = true;
  void handleAuthCallback().then(() =>
    loadWorkspace().then(() => {
      void syncNow();
      void refreshQuota();
    }),
  );
  window.addEventListener("online", () => {
    setState({online: true});
    void syncNow();
  });
  window.addEventListener("offline", () => setState({online: false}));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") void syncNow();
  }, 60_000);
}

type Confirm = {kind: "delete" | "sync-off"; work: WorkMeta} | null;

export function App() {
  const state = useAppState();
  const isMobile = useIsMobile();
  const theme = useTheme();
  const editorRef = useRef<EditorHandle>(null);
  const [editorUi, setEditorUi] = useState<EditorUi>(INITIAL_UI);
  const [sidebar, setSidebar] = useState(() => localStorage.getItem(SIDEBAR_KEY) !== "closed");
  const [drawer, setDrawer] = useState(false);
  const [auth, setAuth] = useState<{open: boolean; reason?: string; then?: () => void}>({open: false});
  const [renaming, setRenaming] = useState<WorkMeta | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [ai, setAi] = useState<{open: boolean; pending: boolean; error: string; count: number}>({open: false, pending: false, error: "", count: 0});
  const aiRequest = useRef<AbortController | null>(null);

  const work = currentWork(state);
  const works = visibleWorks(state);
  const getEditor = useCallback(() => editorRef.current, []);

  const signIn = useCallback(async () => {
    const config = await authConfig();
    if (config.signIn === "identity") {
      window.location.href = config.signInUrl ?? "/api/auth/signin";
    } else {
      setAuth({open: true});
    }
  }, []);

  useEffect(start, []);

  useEffect(
    () =>
      onNotice((notice) => {
        const show = notice.kind === "info" ? toast.info : notice.kind === "success" ? toast.success : notice.kind === "warning" ? toast.warning : toast.danger;
        const id = show(notice.title, {
          description: notice.description,
          timeout: notice.sticky ? 0 : 5000,
          actionProps: notice.action
            ? {
                children: notice.action.label,
                variant: "secondary",
                onPress: () => {
                  notice.action?.run();
                  toast.close(id);
                },
              }
            : undefined,
        });
      }),
    [],
  );

  useEffect(() => {
    uiBridge.openAuth = () => void signIn();
    return () => {
      uiBridge.openAuth = () => {};
    };
  }, [signIn]);

  useEffect(() => {
    document.title = work ? `${work.name} · Easel` : "Easel";
  }, [work?.name]);

  // Switched to another work: the AI panel and any in-flight request no longer apply.
  useEffect(() => {
    aiRequest.current?.abort();
    setAi((value) => (value.open || value.pending ? {...value, open: false, pending: false, error: ""} : value));
  }, [state.currentId]);

  const toggleSidebar = () => {
    if (isMobile) return setDrawer(true);
    setSidebar((open) => {
      localStorage.setItem(SIDEBAR_KEY, open ? "closed" : "open");
      return !open;
    });
  };

  const open = async (id: string) => {
    if (await openWork(id)) setDrawer(false);
  };

  const exportFile = async (target: WorkMeta) => {
    const exported = await exportDocument(target.id);
    if (exported) downloadBlob(new Blob([exported.text], {type: "application/json"}), easelFileName(exported.name));
  };

  const importFile = async () => {
    const file = await pickFile(`${EASEL_EXTENSION},application/json`);
    if (!file) return;
    try {
      await importDocument(await file.text(), sanitizeScene);
      setDrawer(false);
      notify({kind: "success", title: t("import.done")});
    } catch (error) {
      notify({
        kind: "danger",
        title: t("import.failed"),
        description: error instanceof EaselFileError ? error.message : t("import.unrecognized"),
      });
    }
  };

  const turnOnSync = (target: WorkMeta) => {
    const run = () => void enableSync(target.id);
    if (activeSession()) run();
    else void signIn();
  };

  const onAction = (action: WorkAction, target: WorkMeta) => {
    if (action === "rename") setRenaming(target);
    else if (action === "duplicate") void duplicateWork(target.id).then(() => setDrawer(false));
    else if (action === "export") void exportFile(target);
    else if (action === "sync-on") turnOnSync(target);
    else setConfirm({kind: action, work: target});
  };

  const openAi = () => {
    if (!state.online) return notify({kind: "info", title: t("ai.offlineTitle"), description: t("ai.offlineBody")});
    const openPanel = () => {
      void refreshQuota();
      setAi({open: true, pending: false, error: "", count: countObjects(editorRef.current?.diagram().diagram ?? {nodes: [], edges: []})});
    };
    if (activeSession()) openPanel();
    else void signIn();
  };

  const closeAi = () => {
    aiRequest.current?.abort();
    setAi((value) => ({...value, open: false, pending: false, error: ""}));
  };

  const submitAi = async (prompt: string) => {
    const editor = editorRef.current;
    const session = activeSession();
    if (!editor || !session) return;
    const workId = state.currentId;
    const {diagram, version} = editor.diagram();
    if (countObjects(diagram) > MAX_AI_OBJECTS) return;
    const controller = new AbortController();
    aiRequest.current = controller;
    setAi((value) => ({...value, pending: true, error: ""}));
    try {
      const response = await api.aiPreview(session.token, {prompt, diagram}, controller.signal);
      if (controller.signal.aborted) return;
      setState({quota: response.quota});
      // The work was edited or switched while waiting: this result no longer matches the current canvas.
      if (getState().currentId !== workId || editor.contentVersion() !== version) {
        setAi((value) => ({...value, pending: false, error: t("ai.stale")}));
        return;
      }
      const checked = validateOps(diagram, response.ops);
      if (!checked.ok) {
        setAi((value) => ({...value, pending: false, error: t("ai.invalid")}));
        return;
      }
      editor.startPreview(diagram, checked.result);
      setAi((value) => ({...value, open: false, pending: false, error: ""}));
    } catch (error) {
      if (controller.signal.aborted) return;
      let message = t("error.generic");
      if (error instanceof ApiError) {
        if (error.code === "unauthorized") {
          await expireSession();
          message = t("ai.sessionExpired");
        } else if (error.code === "network") message = t("error.network");
        else message = error.message;
        if (error.code === "quota_exhausted") void refreshQuota();
      }
      setAi((value) => ({...value, pending: false, error: message}));
    }
  };

  if (state.phase === "loading" || !work) {
    return (
      <div className="easel-loading" role="status" aria-label={t("app.opening")}>
        <Spinner />
      </div>
    );
  }

  const list = (
    <WorkList
      works={works}
      currentId={state.currentId}
      session={state.session}
      onOpen={(id) => void open(id)}
      onAction={onAction}
      onNew={() => void createWork().then(() => setDrawer(false))}
      onImport={() => void importFile()}
      onSignIn={() => void signIn()}
      onSignOut={() => void signOut()}
    />
  );

  return (
    <div className="easel" data-sidebar={!isMobile && sidebar ? "open" : "closed"}>
      {!isMobile && sidebar && <aside className="easel-side">{list}</aside>}
      <main className="easel-main">
        <header className="easel-top">
          <Tooltip delay={500}>
            <Button isIconOnly size="sm" variant="ghost" aria-label={isMobile ? t("app.openWorkList") : sidebar ? t("app.collapseWorkList") : t("app.expandWorkList")} aria-expanded={isMobile ? drawer : sidebar} onPress={toggleSidebar}>
              {isMobile ? <Bars aria-hidden /> : <LayoutSideContentLeft aria-hidden />}
            </Button>
            <Tooltip.Content placement="bottom">{t("app.workList")}</Tooltip.Content>
          </Tooltip>
          <WorkName key={work.id} work={work} />
          <div className="easel-top__state" aria-live="polite">
            {state.save === "failed" ? (
              <span className="easel-status" data-status="failed">{t("status.saveFailed")}</span>
            ) : state.save === "saving" ? (
              <span className="easel-status">{t("status.saving")}</span>
            ) : (
              <StatusLine work={work} compact />
            )}
            {!state.online && (
              <span className="easel-status" title={t("status.offline")}>
                <CloudSlash aria-hidden width={12} height={12} />
                <span className="easel-top__wide">{t("status.offline")}</span>
              </span>
            )}
          </div>
          <span className="ms-auto" />
          <Tooltip delay={500}>
            <Button isIconOnly size="sm" variant="ghost" aria-label={t("app.fitLabel")} onPress={() => editorRef.current?.fit()}>
              <ArrowsExpand aria-hidden />
            </Button>
            <Tooltip.Content placement="bottom">{t("app.fit")}</Tooltip.Content>
          </Tooltip>
          <Dropdown>
            <Button isIconOnly size="sm" variant="ghost" aria-label={t("app.workMenu")}>
              <Ellipsis aria-hidden />
            </Button>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu
                onAction={(key) => {
                  if (key === "ai") openAi();
                  else if (key === "png") void editorRef.current?.exportPng();
                  else if (key === "import") void importFile();
                  else if (key === "language") setLocale(otherLocale);
                  else onAction(key as WorkAction, work);
                }}
              >
                <Dropdown.Item id="ai" textValue={t("ai.title")}>
                  <Label>{t("ai.title")}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="png" textValue={t("common.exportPng")}>
                  <Label>{t("common.exportPng")}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="import" textValue={t("common.importFile")}>
                  <Label>{t("common.importFile")}</Label>
                </Dropdown.Item>
                <WorkMenuItems work={work} />
                <Dropdown.Item id="language" textValue={localeName(otherLocale)}>
                  <Label lang={otherLocale}>{localeName(otherLocale)}</Label>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </header>
        <div className="easel-stage">
          <Editor ref={editorRef} workId={work.id} nonce={state.loadNonce} theme={theme} onUi={setEditorUi} />
          <div className="easel-dock">
            {editorUi.preview ? (
              <PreviewBar summary={editorUi.preview} onApply={() => void editorRef.current?.applyPreview()} onCancel={() => editorRef.current?.cancelPreview()} />
            ) : (
              <>
                <AiPanel isOpen={ai.open} isMobile={isMobile} pending={ai.pending} error={ai.error} quota={state.quota} objectCount={ai.count} onSubmit={(prompt) => void submitAi(prompt)} onClose={closeAi} />
                {!(ai.open && !isMobile) && <EditorToolbar ui={editorUi} editor={getEditor} onAi={openAi} />}
              </>
            )}
          </div>
        </div>
      </main>

      <Drawer.Backdrop isOpen={isMobile && drawer} onOpenChange={setDrawer}>
        <Drawer.Content placement="left">
          <Drawer.Dialog aria-label={t("app.workList")} className="easel-drawer">
            {list}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>

      <AuthDialog
        isOpen={auth.open}
        onOpenChange={(isOpen) => setAuth((value) => (isOpen ? {...value, open: true} : {open: false}))}
        reason={auth.reason}
        defaultEmail={state.session?.expired ? state.session.user.email : ""}
        onSignedIn={() => {
          const then = auth.then;
          void refreshQuota();
          then?.();
        }}
      />
      <RenameDialog work={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
      <Toast.Provider placement={isMobile ? "top" : "top end"} />
    </div>
  );
}

/** The work name in the top bar; click it to rename. */
function WorkName({work}: {work: WorkMeta}) {
  const [value, setValue] = useState(work.name);
  useEffect(() => setValue(work.name), [work.name]);
  const commit = () => {
    if (value.trim() && value.trim() !== work.name) void renameWork(work.id, value);
    else setValue(work.name);
  };
  return (
    <input
      className="easel-name"
      aria-label={t("app.workName")}
      value={value}
      maxLength={120}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setValue(work.name);
          requestAnimationFrame(() => (document.activeElement as HTMLElement | null)?.blur());
        }
      }}
    />
  );
}

function RenameDialog({work, onClose}: {work: WorkMeta | null; onClose: () => void}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (work) setName(work.name);
  }, [work]);
  return (
    <Modal.Backdrop isOpen={work !== null} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Modal.Container placement="auto">
        <Modal.Dialog className="sm:max-w-sm">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (work && name.trim()) void renameWork(work.id, name);
              onClose();
            }}
          >
            <Modal.Header>
              <Modal.Heading>{t("common.rename")}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <TextField aria-label={t("app.workName")} value={name} onChange={setName} autoFocus>
                <Label className="sr-only">{t("app.workName")}</Label>
                <Input maxLength={120} />
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" isDisabled={!name.trim()}>
                {t("common.save")}
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function ConfirmDialog({confirm, onClose}: {confirm: Confirm; onClose: () => void}) {
  const [pending, setPending] = useState(false);
  // Keep the last content while the closing animation plays.
  const last = useRef(confirm);
  if (confirm) last.current = confirm;
  const shown = last.current;
  if (!shown) return null;
  const {kind, work} = shown;
  const status = workStatus(work);
  const run = async () => {
    setPending(true);
    try {
      if (kind === "delete") await removeWork(work.id);
      else await disableSync(work.id);
    } finally {
      setPending(false);
      onClose();
    }
  };
  const body =
    kind === "sync-off"
      ? t("confirm.syncOffBody")
      : status === "local"
        ? t("confirm.deleteLocal")
        : status === "remote"
          ? t("confirm.deleteRemote")
          : t("confirm.deleteBoth");
  return (
    <AlertDialog.Backdrop isOpen={confirm !== null} onOpenChange={(isOpen) => !isOpen && !pending && onClose()}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[400px]">
          <AlertDialog.Header>
            <AlertDialog.Icon status={kind === "delete" ? "danger" : "warning"} />
            <AlertDialog.Heading>{kind === "delete" ? t("confirm.deleteTitle", {name: work.name}) : t("confirm.syncOffTitle", {name: work.name})}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>{body}</p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button variant="tertiary" isDisabled={pending} onPress={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant={kind === "delete" ? "danger" : "primary"} isPending={pending} onPress={() => void run()}>
              {kind === "delete" ? t("common.delete") : t("confirm.syncOff")}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}

