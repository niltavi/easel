import {Sparkles, Xmark} from "@gravity-ui/icons";
import {Button, Label, Sheet, TextArea, TextField} from "@heroui/react";
import {useEffect, useState} from "react";
import type {Quota} from "../../shared/api.ts";
import {MAX_AI_OBJECTS, MAX_PROMPT_LENGTH} from "../../shared/diagram.ts";
import {locale, t} from "../lib/i18n.ts";

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

const SUGGESTIONS = [t("ai.suggestDraw"), t("ai.suggestBranch"), t("ai.suggestStep")];

/** When the quota resets: the local time, and whether that is tomorrow. */
function resetTime(quota: Quota): {time: string; tomorrow: boolean} {
  const time = new Date(quota.resetAt).toLocaleTimeString(locale, {hour: "2-digit", minute: "2-digit"});
  const tomorrow = new Date(quota.resetAt).getDate() !== new Date().getDate();
  return {time, tomorrow};
}

function exhaustedText(quota: Quota): string {
  const {time, tomorrow} = resetTime(quota);
  return t(tomorrow ? "ai.exhaustedTomorrow" : "ai.exhausted", {limit: quota.limit, time});
}

function remainingText(quota: Quota): string {
  const {time, tomorrow} = resetTime(quota);
  return t(tomorrow ? "ai.remainingTomorrow" : "ai.remaining", {count: quota.remaining, time});
}

export function AiPanel(props: Props) {
  if (props.isMobile) {
    return (
      <Sheet isOpen={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
        <Sheet.Backdrop>
          <Sheet.Content>
            <Sheet.Dialog aria-label={t("ai.title")}>
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
    <section className="easel-ai nt-fade-up" aria-label={t("ai.title")}>
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
        <h2 className="text-sm font-medium">{objectCount > 0 ? t("ai.headingEdit") : t("ai.headingDraw")}</h2>
        {!isMobile && (
          <Button isIconOnly size="sm" variant="ghost" aria-label={t("common.close")} className="ms-auto" onPress={onClose}>
            <Xmark aria-hidden />
          </Button>
        )}
      </div>
      <TextField aria-label={t("ai.prompt")} value={prompt} onChange={setPrompt} isDisabled={pending || blocked} autoFocus>
        <Label className="sr-only">{t("ai.prompt")}</Label>
        <TextArea
          rows={3}
          maxLength={MAX_PROMPT_LENGTH}
          placeholder={objectCount > 0 ? t("ai.placeholderEdit") : t("ai.placeholderDraw")}
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
          {t("ai.overLimit", {count: objectCount, max: MAX_AI_OBJECTS})}
        </p>
      ) : exhausted ? (
        <p className="text-sm leading-6 text-warning-soft-foreground" role="status">
          {exhaustedText(quota)}
        </p>
      ) : error ? (
        <p className="text-sm leading-6 text-danger" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-xs leading-5 text-muted">{t("ai.privacy")}</p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">{quota && !exhausted ? remainingText(quota) : ""}</span>
        <span className="ms-auto" />
        {pending ? (
          <Button size="sm" variant="tertiary" onPress={onClose}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button type="submit" size="sm" variant="primary" isPending={pending} isDisabled={!text || blocked}>
          {pending ? t("ai.generating") : t("ai.generate")}
        </Button>
      </div>
    </form>
  );
}
