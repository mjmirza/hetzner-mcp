import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight02Icon, Loading03Icon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

const CONSOLE = "https://console.hetzner.com/projects";

/**
 * Hetzner has no API to create a project, so "add a project" is a guided connect.
 * The person creates it in the Console, pastes a token, and we verify it live before saving.
 */
export function AddProjectDialog({ open, onOpenChange, accounts, demo, onAdded }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: string[];
  demo: boolean;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [account, setAccount] = useState(accounts[0] ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setToken("");
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.addProject({ name: name.trim(), account: account.trim(), token: token.trim() });
      toast.success(res.message);
      reset();
      onOpenChange(false);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a project</DialogTitle>
          <DialogDescription>Each Hetzner project has its own API token. Connect one and it appears on the map.</DialogDescription>
        </DialogHeader>

        <ol className="flex flex-col gap-2 rounded-xl bg-secondary p-3 text-[13px]">
          <li>
            <span className="font-medium">1.</span> Open the Hetzner Console and create the project, or pick an existing one.{" "}
            <a href={CONSOLE} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-4 hover:underline">
              Open Console <ArrowRight02Icon size={13} />
            </a>
          </li>
          <li>
            <span className="font-medium">2.</span> In the project, go to Security, then API tokens, and generate a token. Choose Read and Write if you want to create resources from here.
          </li>
          <li>
            <span className="font-medium">3.</span> Paste it below. It is checked against Hetzner, then saved only on this computer.
          </li>
        </ol>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="proj-name">Project name</Label>
            <Input id="proj-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="for example staging" required maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9 _.\-]*" autoComplete="off" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="proj-account">Account</Label>
            <Input id="proj-account" list="proj-accounts" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Hetzner account" maxLength={60} autoComplete="off" />
            <datalist id="proj-accounts">
              {accounts.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="proj-token">API token</Label>
            <Input id="proj-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} required minLength={20} autoComplete="off" spellCheck={false} />
            <p className="text-[12px] text-muted-foreground">Stored in your config folder with owner-only permissions. It is never sent back to this page.</p>
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-risk-soft px-3 py-2 text-[13px] text-risk">
              {error}
            </p>
          )}
          {demo && <p className="text-[12px] text-muted-foreground">You are viewing sample data. Connecting a project switches nothing until you run the live map.</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || demo}>
              {busy && <Loading03Icon size={16} className="animate-spin" />}
              {busy ? "Checking token" : "Verify and add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
