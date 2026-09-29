import { Alert02Icon, Cancel02Icon, CoinsEuroIcon, Delete02Icon, InformationCircleIcon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { KIND_ICON } from "@/components/InfraNode";
import { KIND_LABEL, money } from "@/lib/format";
import { explainLocation, explainType, placeName } from "@/lib/glossary";
import type { Relation } from "@/lib/relations";
import type { MapNode } from "@/lib/types";

const DELETABLE = new Set(["server", "volume", "network", "firewall", "load_balancer", "floating_ip", "primary_ip", "placement_group", "snapshot", "certificate"]);
const FLAG = {
  risk: { icon: Alert02Icon, word: "Risk", cls: "text-risk" },
  waste: { icon: CoinsEuroIcon, word: "Saving", cls: "text-foreground" },
  info: { icon: InformationCircleIcon, word: "Note", cls: "text-muted-foreground" },
} as const;

// Details read as words, not API keys: "Memory 8 GB", not "memory_gb 8".
const DETAIL: Record<string, [string, string?]> = {
  type: ["Type"], cores: ["vCPU"], memory_gb: ["Memory", "GB"], disk_gb: ["Disk", "GB"], size_gb: ["Size", "GB"],
  image: ["Image"], ipv4: ["IPv4"], ipv6: ["IPv6"], ip: ["IP"], backups: ["Automatic backups"], firewalls: ["Firewalls"],
  traffic_used_pct: ["Traffic used this month", "%"], created: ["Created"], ip_range: ["IP range"], zone: ["Network zone"],
  servers: ["Servers"], targets: ["Targets"], services: ["Services"], size: ["Size", "GB"], expires: ["Expires"],
};
function label(k: string): string {
  const d = DETAIL[k];
  if (d) return d[0];
  const t = k.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function value(k: string, v: unknown): string {
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (k === "created" && typeof v === "string") return v.slice(0, 10);
  const unit = DETAIL[k]?.[1];
  return unit ? `${String(v)}${unit === "%" ? "%" : ` ${unit}`}` : String(v);
}

export function Inspector({ node, parts, relations, byId, currency, canDelete, onSelect, onDelete, onClose }: {
  node: MapNode;
  parts: MapNode[];
  relations: Relation[];
  byId: Map<string, MapNode>;
  currency: string;
  canDelete: boolean;
  onSelect: (id: string) => void;
  onDelete: (n: MapNode) => void;
  onClose?: () => void;
}) {
  const Icon = KIND_ICON[node.kind];
  // The hourly price feeds the Spend tab; the card already shows the monthly one.
  const details = Object.entries(node.details).filter(([k, v]) => v !== null && v !== "" && k !== "hourly");
  const parent = node.parent ? byId.get(node.parent) : undefined;
  const loc = node.location ?? (node.kind === "location" ? node.label : null);
  const codes = [node.kind === "server" ? explainType(node) : null, explainLocation(loc)].filter((x): x is string => !!x);
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-secondary">
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{KIND_LABEL[node.kind]}</div>
          <h2 className="truncate text-[17px] leading-6 font-semibold">{node.kind === "location" ? placeName(node.label) ?? node.label : node.label}</h2>
          <div className="text-[12px] text-muted-foreground">{[node.project, loc ? placeName(loc) ?? loc : null, node.status].filter(Boolean).join(" · ")}</div>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon-sm" className="rounded-lg" onClick={onClose} aria-label="Close details">
            <Cancel02Icon size={16} />
          </Button>
        )}
      </div>

      {codes.length > 0 && (
        <section aria-label="What the codes mean" className="rounded-xl border px-3 py-2.5">
          <div className="mb-1 text-[12px] font-medium">What the codes mean</div>
          <ul className="flex flex-col gap-1 text-[12px] leading-5 text-muted-foreground">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      {node.monthly != null && (
        <div className="rounded-xl bg-secondary px-3 py-2.5">
          <div className="text-[12px] text-muted-foreground">Monthly, gross</div>
          <div className="text-[22px] font-semibold tabular-nums">{money(node.monthly, currency)}</div>
          {node.costNote && <div className="text-[12px] text-muted-foreground">{node.costNote}</div>}
        </div>
      )}

      {node.flags.length > 0 && (
        <section aria-label="Worth a look" className="flex flex-col gap-2">
          {node.flags.map((f) => {
            const F = FLAG[f.kind];
            return (
              <div key={f.text} className="flex items-start gap-2 text-[13px]">
                <F.icon size={15} className={`mt-0.5 shrink-0 ${F.cls}`} />
                <p>
                  <span className={`font-medium ${F.cls}`}>{F.word}. </span>
                  {f.text}
                  {f.monthly ? <span className="text-muted-foreground"> ({money(f.monthly, currency)}/mo)</span> : null}
                </p>
              </div>
            );
          })}
        </section>
      )}

      {relations.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-[12px] font-medium text-muted-foreground">Connections</h3>
          {relations.map((r) => (
            <Button key={r.text + r.otherId} variant="ghost" size="sm" className="h-auto justify-start rounded-lg py-1.5 text-left text-[13px] font-normal whitespace-normal" onClick={() => onSelect(r.otherId)}>
              {r.text}
            </Button>
          ))}
        </section>
      )}

      {parts.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-[12px] font-medium text-muted-foreground">Includes</h3>
          {parts.map((p) => (
            <Button key={p.id} variant="ghost" size="sm" className="h-auto justify-between gap-2 rounded-lg py-1.5 text-[13px] font-normal" onClick={() => onSelect(p.id)}>
              <span className="truncate">
                <span className="text-muted-foreground">{KIND_LABEL[p.kind]} </span>
                {p.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{money(p.monthly, currency)}</span>
            </Button>
          ))}
        </section>
      )}

      {details.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-[12px] font-medium text-muted-foreground">Details</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            {details.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{label(k)}</dt>
                <dd className="min-w-0 truncate text-right" title={value(k, v)}>{value(k, v)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {parent && (
        <p className="text-[12px] text-muted-foreground">
          Inside{" "}
          <Button variant="link" size="xs" className="h-auto rounded-md p-0 text-[12px] text-foreground" onClick={() => onSelect(parent.id)}>
            {parent.label}
          </Button>
        </p>
      )}

      {canDelete && DELETABLE.has(node.kind) && (
        <>
          <Separator />
          <Button variant="outline" className="justify-start rounded-lg text-risk hover:text-risk" onClick={() => onDelete(node)}>
            <Delete02Icon size={16} /> Delete {KIND_LABEL[node.kind].toLowerCase()}
          </Button>
        </>
      )}
    </div>
  );
}
