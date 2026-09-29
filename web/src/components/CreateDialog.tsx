import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert02Icon, Loading03Icon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { KIND_LABEL, money } from "@/lib/format";
import type { Catalog, Meta, NodeKind, Plan } from "@/lib/types";

type Params = Record<string, string | number | boolean | string[] | undefined>;
const NONE = "__none";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Pick({ id, value, onChange, options, placeholder }: { id: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; placeholder: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Two steps, always. Review shows the real Hetzner price, then Create runs the same guards as
// the MCP tools. Nothing is created without the second click.
export function CreateDialog({ open, onOpenChange, kind, project, projectLabel, meta, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: NodeKind | null;
  project: string | null;
  projectLabel: string;
  meta: Meta | null;
  onCreated: () => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [p, setP] = useState<Params>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Params) => {
    setP((old) => ({ ...old, ...patch }));
    setPlan(null);
    setAccept(false);
  };

  useEffect(() => {
    if (!open || !project) return;
    setCatalog(null);
    setLoadError(null);
    setP(kind === "volume" ? { size: 10 } : kind === "network" ? { ip_range: "10.0.0.0/16" } : kind === "firewall" ? { preset: "web" } : {});
    setPlan(null);
    setAccept(false);
    setError(null);
    api.catalog(project).then(setCatalog, (e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [open, project, kind]);

  const location = String(p.location ?? "");
  const types = useMemo(() => (catalog?.serverTypes ?? []).filter((t) => !location || t.location === location), [catalog, location]);
  const chosenType = types.find((t) => t.type === p.server_type);
  const images = useMemo(() => (catalog?.images ?? []).filter((i) => !chosenType || i.architecture === chosenType.architecture), [catalog, chosenType]);

  const review = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !kind) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await api.plan({ project, kind, params: p }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!project || !kind) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.apply({ project, kind, params: p, confirm: true });
      toast.success(res.message);
      onOpenChange(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const locs = (catalog?.locations ?? []).map((l) => ({ value: l.name, label: `${l.city} (${l.name})` }));
  const optionalOf = (list: Array<{ id: number; name: string }>, none: string) => [{ value: NONE, label: none }, ...list.map((x) => ({ value: String(x.id), label: x.name }))];
  const opt = (v: string) => (v === NONE ? undefined : v);
  const title = kind ? `New ${KIND_LABEL[kind].toLowerCase()}` : "New resource";
  const blockedReason = meta?.readOnly
    ? "This map runs in read-only mode (HETZNER_MCP_READONLY=1). Nothing can be created."
    : meta?.mode === "demo"
      ? "You are viewing sample data. Start the live map to create real resources."
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>In project {projectLabel}. You see the price before anything is created.</DialogDescription>
        </DialogHeader>

        {loadError && (
          <p role="alert" className="rounded-lg bg-risk-soft px-3 py-2 text-[13px] text-risk">
            {loadError}
          </p>
        )}
        {!catalog && !loadError && (
          <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
            <Loading03Icon size={16} className="animate-spin" /> Loading locations, types and prices from Hetzner
          </div>
        )}

        {catalog && kind && (
          <form onSubmit={review} className="flex flex-col gap-4">
            <Field id="c-name" label="Name" hint="Letters, digits and dashes.">
              <Input id="c-name" value={String(p.name ?? "")} onChange={(e) => set({ name: e.target.value })} required maxLength={63} pattern="[A-Za-z0-9][A-Za-z0-9\-.]*" autoComplete="off" />
            </Field>

            {["server", "load_balancer", "primary_ip", "floating_ip", "volume"].includes(kind) && (
              <Field id="c-loc" label="Location" hint={kind === "volume" ? "Skip this if you attach it to a server below." : undefined}>
                <Pick id="c-loc" value={location} onChange={(v) => set({ location: v, server_type: undefined })} options={locs} placeholder="Choose a location" />
              </Field>
            )}

            {kind === "server" && (
              <>
                <Field id="c-type" label="Type" hint="Only types you can order in this location right now.">
                  <Pick
                    id="c-type"
                    value={String(p.server_type ?? "")}
                    onChange={(v) => set({ server_type: v, image: undefined })}
                    options={types.map((t) => ({
                      value: t.type,
                      label: `${t.type.toUpperCase()} · ${t.cores} vCPU · ${t.memory_gb} GB · ${money(t.monthly, catalog.currency)}/mo${t.retiring_after ? " · retiring" : ""}`,
                    }))}
                    placeholder={location ? "Choose a type" : "Choose a location first"}
                  />
                </Field>
                <Field id="c-img" label="Image">
                  <Pick id="c-img" value={String(p.image ?? "")} onChange={(v) => set({ image: v })} options={images.map((i) => ({ value: i.name, label: i.description || i.name }))} placeholder="Choose an image" />
                </Field>
                <Field id="c-key" label="SSH key" hint={catalog.sshKeys.length ? "Recommended. Without one, Hetzner emails a root password." : "No SSH keys in this project yet. Hetzner will email a root password."}>
                  <Pick id="c-key" value={String((p.ssh_keys as string[] | undefined)?.[0] ?? NONE)} onChange={(v) => set({ ssh_keys: v === NONE ? undefined : [v] })} options={optionalOf(catalog.sshKeys, "No key")} placeholder="No key" />
                </Field>
                <Field id="c-net" label="Private network">
                  <Pick id="c-net" value={String(p.network ?? NONE)} onChange={(v) => set({ network: opt(v) })} options={optionalOf(catalog.networks, "None")} placeholder="None" />
                </Field>
                <Field id="c-fw" label="Firewall">
                  <Pick id="c-fw" value={String(p.firewall ?? NONE)} onChange={(v) => set({ firewall: opt(v) })} options={optionalOf(catalog.firewalls, "None")} placeholder="None" />
                </Field>
              </>
            )}

            {kind === "volume" && (
              <>
                <Field id="c-size" label="Size in GB" hint={catalog.volumePerGb != null ? `${money(catalog.volumePerGb, catalog.currency)} per GB a month.` : undefined}>
                  <Input id="c-size" type="number" min={10} max={10240} value={String(p.size ?? 10)} onChange={(e) => set({ size: Number(e.target.value) })} required />
                </Field>
                <Field id="c-srv" label="Attach to server">
                  <Pick id="c-srv" value={String(p.server ?? NONE)} onChange={(v) => set({ server: opt(v) })} options={optionalOf(catalog.servers, "Do not attach")} placeholder="Do not attach" />
                </Field>
              </>
            )}

            {kind === "network" && (
              <Field id="c-range" label="IP range" hint="A subnet in eu-central is added so servers can join right away.">
                <Input id="c-range" value={String(p.ip_range ?? "")} onChange={(e) => set({ ip_range: e.target.value })} required pattern="\d+\.\d+\.\d+\.\d+/\d+" />
              </Field>
            )}

            {kind === "firewall" && (
              <Field id="c-rules" label="Starting rules">
                <Pick
                  id="c-rules"
                  value={String(p.preset ?? "web")}
                  onChange={(v) => set({ preset: v })}
                  options={[
                    { value: "web", label: "Web. Allow HTTP and HTTPS from anywhere" },
                    { value: "web-ssh", label: "Web and SSH. Also allow port 22" },
                    { value: "none", label: "Empty. Block all inbound traffic" },
                  ]}
                  placeholder="Web"
                />
              </Field>
            )}

            {kind === "load_balancer" && (
              <Field id="c-lbt" label="Type">
                <Pick
                  id="c-lbt"
                  value={String(p.load_balancer_type ?? "")}
                  onChange={(v) => set({ load_balancer_type: v })}
                  options={catalog.loadBalancerTypes.map((t) => ({ value: t.name, label: `${t.name.toUpperCase()} · ${money(t.monthly, catalog.currency)}/mo` }))}
                  placeholder="Choose a type"
                />
              </Field>
            )}

            {(kind === "firewall" || kind === "load_balancer" || kind === "floating_ip") && (
              <Field id="c-target" label={kind === "firewall" ? "Apply to server" : kind === "load_balancer" ? "Send traffic to server" : "Assign to server"}>
                <Pick id="c-target" value={String(p.server ?? NONE)} onChange={(v) => set({ server: opt(v) })} options={optionalOf(catalog.servers, "Not yet")} placeholder="Not yet" />
              </Field>
            )}

            {error && (
              <p role="alert" className="rounded-lg bg-risk-soft px-3 py-2 text-[13px] text-risk">
                {error}
              </p>
            )}

            {plan && (
              <Card className="gap-2 rounded-xl py-3 shadow-none" aria-live="polite">
                <CardContent className="flex flex-col gap-2 px-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-medium">{plan.label}</span>
                    <span className="text-[15px] font-semibold tabular-nums">{plan.billed ? `${money(plan.monthly, plan.currency)}/mo` : "Free"}</span>
                  </div>
                  {plan.notes.map((n) => (
                    <p key={n} className="text-[12px] text-muted-foreground">
                      {n}
                    </p>
                  ))}
                  {plan.blocked && (
                    <p className="flex items-start gap-1.5 text-[12px] text-risk">
                      <Alert02Icon size={14} className="mt-px shrink-0" /> {plan.blocked}
                    </p>
                  )}
                  {plan.billed && !plan.blocked && (
                    <div className="flex items-start gap-2 text-[13px]">
                      <Checkbox id="c-accept" checked={accept} onCheckedChange={(v) => setAccept(v === true)} className="mt-0.5" />
                      <Label htmlFor="c-accept" className="leading-snug font-normal">
                        I understand this is billed to the Hetzner account, up to {money(plan.monthly, plan.currency)} a month.
                      </Label>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {blockedReason && <p className="text-[12px] text-muted-foreground">{blockedReason}</p>}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {!plan ? (
                <Button type="submit" disabled={busy}>
                  {busy && <Loading03Icon size={16} className="animate-spin" />}
                  Review price
                </Button>
              ) : (
                <Button type="button" onClick={create} disabled={busy || !!plan.blocked || !!blockedReason || (plan.billed && !accept)}>
                  {busy && <Loading03Icon size={16} className="animate-spin" />}
                  {busy ? "Creating" : "Create"}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
