import { useEffect, useState } from "react";
import { STATE_LABEL, type LiveState } from "../../../src/map/status";
import { cn } from "@/lib/utils";

const DOT: Record<LiveState, string> = {
  live: "bg-ok",
  changing: "bg-warn",
  off: "bg-muted-foreground/60",
  interrupted: "bg-risk",
  unknown: "bg-risk",
  stale: "bg-muted-foreground/40",
};
const TEXT: Record<LiveState, string> = {
  live: "text-foreground",
  changing: "text-foreground",
  off: "text-muted-foreground",
  interrupted: "text-risk",
  unknown: "text-risk",
  stale: "text-muted-foreground",
};

/** A coloured dot plus a short word. Only the live dot pulses, and only when motion is allowed. */
export function StatusDot({ state, label, title, className }: { state: LiveState; label?: string; title: string; className?: string }) {
  return (
    <span role="status" aria-label={title} title={title} className={cn("inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium tracking-normal normal-case", TEXT[state], className)}>
      <span aria-hidden className="relative flex size-2 shrink-0">
        {state === "live" && <span className="absolute inset-0 rounded-full bg-ok motion-safe:animate-[hz-live_2.4s_ease-out_infinite]" />}
        <span className={cn("relative size-2 rounded-full", DOT[state])} />
      </span>
      <span className="truncate">{label ?? STATE_LABEL[state]}</span>
    </span>
  );
}

/** "Status checked 12s ago", ticking on its own so the canvas never re-renders for it. */
export function CheckedAgo({ at, failed }: { at: string; failed: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  const age = !at ? "" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
  if (failed) return <div className="text-[12px] text-risk">Status check failed, last known {age}</div>;
  return <div className="text-[12px] text-muted-foreground">Status checked {age}</div>;
}
