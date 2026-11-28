import {Alert, Card, Chip, Spinner} from "@heroui/react";
import {useEffect, useState, type ReactNode} from "react";
import {ApiError} from "../lib/api.ts";
import {useText} from "../vendor/niltavi-ui/site/Locale.tsx";

export {useText};

/** The message to show for a failed request, in the console's language. */
export function errorText(error: unknown, text: (en: string, zh: string) => string): string {
  if (error instanceof ApiError) return error.code === "network" ? text("No connection. Check your network and try again", "网络不可用，请检查连接后再试") : error.message;
  return text("Something went wrong. Try again", "出了点问题，请再试一次");
}

/** Loads through the API with the administrator's session. Calling reload() fetches again. */
export function useLoad<T>(token: string, load: (token: string) => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{data?: T; error?: unknown}>({});
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setState({});
    load(token).then(
      (data) => { if (current) setState({data}); },
      (error) => { if (current) setState({error}); },
    );
    return () => { current = false; };
    // The loader is re-created on each render; the explicit dependencies decide when to fetch again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, version, ...deps]);
  return {data: state.data, error: state.error, reload: () => setVersion((value) => value + 1)};
}

export function Notice({status, children, action}: {status: "danger" | "success" | "warning" | "accent" | "default"; children: ReactNode; action?: ReactNode}) {
  return (
    <Alert status={status} role={status === "danger" ? "alert" : "status"}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{children}</Alert.Title>
        {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
      </Alert.Content>
    </Alert>
  );
}

export function State({color, children}: {color?: "success" | "warning" | "danger" | "accent" | "default"; children: ReactNode}) {
  return <Chip size="sm" variant="soft" color={color ?? "default"}><Chip.Label>{children}</Chip.Label></Chip>;
}

export function Panel({title, description, aside, children}: {title: string; description?: ReactNode; aside?: ReactNode; children: ReactNode}) {
  return (
    <Card className="min-w-0">
      <Card.Header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-1">
          <Card.Title className="text-base font-semibold" render={(props) => <h2 {...props} />}>{title}</Card.Title>
          {description && <Card.Description>{description}</Card.Description>}
        </div>
        {aside}
      </Card.Header>
      <Card.Content className="grid gap-5">{children}</Card.Content>
    </Card>
  );
}

export function Empty({children}: {children: ReactNode}) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function Loading() {
  const text = useText();
  return (
    <div className="grid place-items-center py-16" role="status" aria-label={text("Loading", "正在加载")}>
      <Spinner />
    </div>
  );
}
