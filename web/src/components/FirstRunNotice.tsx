import { useState } from "react";
import { Alert02Icon, Cancel02Icon, Copy02Icon, InformationCircleIcon, Tick02Icon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import type { FirstRunNotice as Notice } from "@/lib/first-run";

const storeKey = (id: string) => `hzmap-notice:${id}`;

function wasDismissed(id: string): boolean {
  try {
    return localStorage.getItem(storeKey(id)) === "1";
  } catch {
    return false;
  }
}

// A short card over the canvas that says what the user is looking at and the one next step.
export function FirstRunNotice({ notice, placement }: { notice: Notice; placement: "top" | "bottom" }) {
  const [hidden, setHidden] = useState(() => notice.remember && wasDismissed(notice.id));
  const [copied, setCopied] = useState(false);
  if (hidden) return null;

  const dismiss = () => {
    setHidden(true);
    if (!notice.remember) return;
    try {
      localStorage.setItem(storeKey(notice.id), "1");
    } catch {
      // Private windows can refuse storage; the notice then simply returns next time.
    }
  };
  const copy = async () => {
    if (!notice.command) return;
    try {
      await navigator.clipboard.writeText(notice.command);
      setCopied(true);
    } catch {
      // Clipboard access can be blocked; the command stays visible to copy by hand.
    }
  };
  const problem = notice.tone === "problem";
  const Icon = problem ? Alert02Icon : InformationCircleIcon;

  return (
    <section
      role={problem ? "alert" : "status"}
      aria-label={notice.title}
      className={`absolute ${placement === "top" ? "top-2" : "bottom-2"} left-1/2 z-10 w-[calc(100%-1rem)] max-w-lg -translate-x-1/2 rounded-xl border bg-card p-3 text-[13px] shadow-[var(--shadow)]`}
    >
      <div className="flex items-start gap-2.5">
        <Icon size={18} aria-hidden="true" className={problem ? "mt-0.5 shrink-0 text-destructive" : "mt-0.5 shrink-0 text-muted-foreground"} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">{notice.title}</h2>
          <p className="mt-0.5 leading-5 text-muted-foreground">{notice.body}</p>
          {notice.command && (
            <Button variant="secondary" size="sm" className="mt-2 max-w-full rounded-md font-mono text-[12px]" onClick={copy} aria-label={`Copy ${notice.command}`}>
              <span className="truncate">{notice.command}</span>
              {copied ? <Tick02Icon size={14} aria-hidden="true" /> : <Copy02Icon size={14} aria-hidden="true" />}
            </Button>
          )}
        </div>
        <Button variant="ghost" size="icon-xs" className="shrink-0 rounded-md" onClick={dismiss} aria-label="Hide this message">
          <Cancel02Icon size={14} aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
