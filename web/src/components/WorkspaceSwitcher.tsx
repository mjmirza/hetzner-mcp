import { useMemo, useState } from "react";
import { Briefcase02Icon, Search02Icon, Tick02Icon, UnfoldMoreIcon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { WorkspaceSummary } from "@/lib/types";

// One workspace per client. Only the active one is loaded, so 100+ clients stay fast.
// The search box appears once the list is long enough to need it.
export function WorkspaceSwitcher({ workspaces, active, onChange }: { workspaces: WorkspaceSummary[]; active: string; onChange: (name: string) => void }) {
  const [q, setQ] = useState("");
  const current = workspaces.find((w) => w.name === active) ?? workspaces[0];
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? workspaces.filter((w) => w.name.toLowerCase().includes(t)) : workspaces;
  }, [q, workspaces]);
  if (!current) return null;

  return (
    <DropdownMenu onOpenChange={(o) => !o && setQ("")}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="h-auto w-full justify-between gap-2 rounded-lg px-3 py-2" aria-label={`Workspace ${current.name}. Change workspace`}>
          <span className="flex min-w-0 items-center gap-2.5">
            <Briefcase02Icon size={17} className="shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-col items-start">
              <span className="truncate text-[14px] font-medium">{current.name}</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                {current.accounts} account{current.accounts === 1 ? "" : "s"} · {current.projects} project{current.projects === 1 ? "" : "s"}
              </span>
            </span>
          </span>
          <UnfoldMoreIcon size={16} className="shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-64 rounded-xl">
        <DropdownMenuLabel className="text-[12px] text-muted-foreground">
          {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}
        </DropdownMenuLabel>
        {workspaces.length > 6 && (
          <div className="relative px-1 pb-1">
            <Search02Icon size={14} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Find a client"
              aria-label="Find a workspace"
              className="h-8 rounded-md pl-8"
            />
          </div>
        )}
        <DropdownMenuSeparator />
        <div className="max-h-80 overflow-y-auto">
          {shown.length === 0 && <p className="px-2 py-3 text-[13px] text-muted-foreground">No workspace called “{q.trim()}”.</p>}
          {shown.map((w) => (
            <DropdownMenuItem key={w.name} className="gap-2.5 rounded-lg py-2" onSelect={() => onChange(w.name)}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px]">{w.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {w.accounts} account{w.accounts === 1 ? "" : "s"} · {w.projects} project{w.projects === 1 ? "" : "s"}
                </span>
              </span>
              {w.name === current.name && <Tick02Icon size={16} className="shrink-0" aria-label="Current workspace" />}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
