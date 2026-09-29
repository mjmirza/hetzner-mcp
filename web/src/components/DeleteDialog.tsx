import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loading03Icon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { KIND_LABEL } from "@/lib/format";
import type { MapNode } from "@/lib/types";

// Deleting is permanent, so the person types the exact name. The server re-checks it too.
export function DeleteDialog({ node, onOpenChange, onDeleted }: { node: MapNode | null; onOpenChange: (v: boolean) => void; onDeleted: () => void }) {
  const [info, setInfo] = useState<{ name: string; notes: string[]; blocked?: string } | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInfo(null);
    setTyped("");
    setError(null);
    if (node) api.deletePlan(node.id).then(setInfo, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [node]);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!node) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.remove(node.id, typed);
      toast.success(res.message);
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!node} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {node ? KIND_LABEL[node.kind].toLowerCase() : ""}</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>
        {!info && !error && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loading03Icon size={16} className="animate-spin" /> Checking what else this affects
          </div>
        )}
        {info && (
          <form onSubmit={run} className="flex flex-col gap-4">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted-foreground">
              {info.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            {info.blocked ? (
              <p className="rounded-lg bg-risk-soft px-3 py-2 text-[13px] text-risk">{info.blocked}</p>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="d-name">
                  Type <span className="font-semibold">{info.name}</span> to confirm
                </Label>
                <Input id="d-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} autoFocus />
              </div>
            )}
            {error && <p role="alert" className="rounded-lg bg-risk-soft px-3 py-2 text-[13px] text-risk">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Keep it
              </Button>
              <Button type="submit" variant="destructive" disabled={busy || !!info.blocked || typed !== info.name}>
                {busy && <Loading03Icon size={16} className="animate-spin" />}
                Delete permanently
              </Button>
            </DialogFooter>
          </form>
        )}
        {error && !info && <p role="alert" className="rounded-lg bg-risk-soft px-3 py-2 text-[13px] text-risk">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
