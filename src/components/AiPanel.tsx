import {Sparkles, Xmark} from "@gravity-ui/icons";
import {Button, Label, Sheet, TextArea, TextField} from "@heroui/react";
import {useEffect, useState} from "react";
import type {Quota} from "../../shared/api.ts";
import {MAX_AI_OBJECTS, MAX_PROMPT_LENGTH} from "../../shared/diagram.ts";

interface Props {
  isOpen: boolean;
  isMobile: boolean;
  pending: boolean;
  error: string;
  quota: Quota | null;
  /** Number of structured objects in the current work that can take part in an AI request. */
  objectCount: number;
  onSubmit: (prompt: string) => void;
  /** Close the panel; if a request is in flight, cancel it too. */
  onClose: () => void;
}

const SUGGESTIONS = ["画一个请假审批流程，包含通过和驳回两个分支", "给审批流程加一个驳回分支", "在开头加一个“提交申请”步骤"];

function resetText(quota: Quota): string {
  const time = new Date(quota.resetAt).toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit"});
  const tomorrow = new Date(quota.resetAt).getDate() !== new Date().getDate();
  return `${tomorrow ? "明天 " : ""}${time} 重置`;
}

export function AiPanel(props: Props) {
  if (props.isMobile) {
    return (
      <Sheet isOpen={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
        <Sheet.Backdrop>
          <Sheet.Content>
            <Sheet.Dialog aria-label="用 AI 画图或改图">
              <Sheet.Handle />
              <Sheet.Body>
                <AiForm {...props} />
              </Sheet.Body>
            </Sheet.Dialog>
          </Sheet.Content>
        </Sheet.Backdrop>
      </Sheet>
    );
  }
  if (!props.isOpen) return null;
  return (
    <section className="easel-ai nt-fade-up" aria-label="用 AI 画图或改图">
      <AiForm {...props} />
    </section>
  );
}

function AiForm({isOpen, isMobile, pending, error, quota, objectCount, onSubmit, onClose}: Props) {
  const [prompt, setPrompt] = useState("");
  useEffect(() => {
    if (isOpen) setPrompt("");
  }, [isOpen]);

  const overLimit = objectCount > MAX_AI_OBJECTS;
  const exhausted = quota !== null && quota.remaining <= 0;
  const blocked = overLimit || exhausted;
  const text = prompt.trim();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (text && !blocked && !pending) onSubmit(text);
      }}
    >
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden className="text-accent-soft-foreground" />
        <h2 className="text-sm font-medium">{objectCount > 0 ? "让 AI 修改这张图" : "让 AI 画一张流程图"}</h2>
        {!isMobile && (
          <Button isIconOnly size="sm" variant="ghost" aria-label="关闭" className="ms-auto" onPress={onClose}>
            <Xmark aria-hidden />
          </Button>
        )}
      </div>
      <TextField aria-label="指令" value={prompt} onChange={setPrompt} isDisabled={pending || blocked} autoFocus>
        <Label className="sr-only">指令</Label>
        <TextArea
          rows={3}
          maxLength={MAX_PROMPT_LENGTH}
          placeholder={objectCount > 0 ? "例如：给审批流程加一个驳回分支" : "例如：画一个请假审批流程"}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit();
          }}
        />
      </TextField>
      {!text && !blocked && (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.slice(objectCount > 0 ? 1 : 0, objectCount > 0 ? 3 : 1).map((suggestion) => (
            <Button key={suggestion} size="sm" variant="tertiary" onPress={() => setPrompt(suggestion)}>
              {suggestion}
            </Button>
          ))}
        </div>
      )}
      {overLimit ? (
        <p className="text-sm leading-6 text-warning-soft-foreground" role="status">
          这件作品有 {objectCount} 个形状、文字和连线，超过了 AI 一次能处理的 {MAX_AI_OBJECTS} 个。你仍然可以手动编辑。
        </p>
      ) : exhausted ? (
        <p className="text-sm leading-6 text-warning-soft-foreground" role="status">
          今天的 {quota.limit} 次 AI 预览已用完，{resetText(quota)}。
        </p>
      ) : error ? (
        <p className="text-sm leading-6 text-danger" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-xs leading-5 text-muted">只发送这条指令和画布上的形状、文字、连线。手写笔迹和其他作品留在这台设备上。</p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">{quota && !exhausted ? `今天还可预览 ${quota.remaining} 次 · ${resetText(quota)}` : ""}</span>
        <span className="ms-auto" />
        {pending ? (
          <Button size="sm" variant="tertiary" onPress={onClose}>
            取消
          </Button>
        ) : null}
        <Button type="submit" size="sm" variant="primary" isPending={pending} isDisabled={!text || blocked}>
          {pending ? "正在生成" : "生成预览"}
        </Button>
      </div>
    </form>
  );
}
