import { createContext, memo, useContext } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  Alert02Icon,
  Archive02Icon,
  Camera02Icon,
  Certificate02Icon,
  CoinsEuroIcon,
  Database02Icon,
  DistributionIcon,
  FirewallIcon,
  Folder02Icon,
  Globe02Icon,
  GridViewIcon,
  HardDriveIcon,
  InternetAntenna02Icon,
  Location03Icon,
  Router02Icon,
  ServerStack02Icon,
  ServerStack03Icon,
} from "hugeicons-react";
import { cn } from "@/lib/utils";
import { KIND_LABEL, money } from "@/lib/format";
import type { CardData } from "@/lib/layout";
import type { MapNode, NodeKind } from "@/lib/types";

type IconType = typeof ServerStack02Icon;

export const KIND_ICON: Record<NodeKind, IconType> = {
  account: Folder02Icon,
  project: GridViewIcon,
  location: Location03Icon,
  network: Router02Icon,
  server: ServerStack02Icon,
  volume: HardDriveIcon,
  firewall: FirewallIcon,
  load_balancer: DistributionIcon,
  floating_ip: InternetAntenna02Icon,
  primary_ip: Globe02Icon,
  snapshot: Camera02Icon,
  backup: Archive02Icon,
  storage_box: Database02Icon,
  robot_server: ServerStack03Icon,
  certificate: Certificate02Icon,
  placement_group: GridViewIcon,
};

interface CardActions {
  select: (id: string) => void;
  toggle: (id: string) => void;
  currency: string;
}

export const CardContext = createContext<CardActions>({ select: () => {}, toggle: () => {}, currency: "EUR" });

function subtitle(n: MapNode): string {
  const d = n.details;
  const bits = [d.type, n.location, n.status].filter((x) => x != null && x !== "");
  if (n.kind === "network" && d.ip_range) return String(d.ip_range);
  if (n.kind === "project") return `${n.account}`;
  return bits.join(" · ");
}

function Row({ n }: { n: MapNode }) {
  const { select, currency } = useContext(CardContext);
  const Icon = KIND_ICON[n.kind];
  const risky = n.flags.some((f) => f.kind === "risk");
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        select(n.id);
      }}
      className={cn(
        "nodrag flex h-[30px] w-full items-center gap-2 rounded-lg bg-secondary px-2.5 text-left text-[12px] transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        risky && "bg-risk-soft text-accent-foreground",
      )}
    >
      <Icon size={14} className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground">{KIND_LABEL[n.kind]} </span>
        {n.label}
      </span>
      {risky && <Alert02Icon size={13} className="shrink-0 text-risk" aria-label="Needs attention" />}
      <span className="shrink-0 tabular-nums text-muted-foreground">{money(n.monthly, currency)}</span>
    </button>
  );
}

function InfraNodeImpl({ data, selected }: NodeProps<Node<CardData>>) {
  const { toggle, currency } = useContext(CardContext);
  const n = data.node;
  const shelf = n.id.endsWith("#shelf");
  const Icon = shelf ? FirewallIcon : KIND_ICON[n.kind];
  const risk = n.flags.filter((f) => f.kind === "risk").length;
  const waste = n.flags.filter((f) => f.kind === "waste").length;
  const container = n.kind === "account" || n.kind === "project" || n.kind === "location" || n.kind === "network";
  const lr = data.direction === "LR";
  const own = n.monthly ?? 0;
  const total = own + data.rows.reduce((s, r) => s + (shelf ? 0 : r.monthly ?? 0), 0);

  return (
    <div
      className={cn(
        "group relative h-full w-full rounded-[14px] border bg-card text-card-foreground shadow-[var(--shadow)] transition-[opacity,box-shadow,border-color] duration-200",
        container && "bg-secondary/70",
        n.kind === "account" && "bg-foreground text-background",
        selected && "border-primary ring-4 ring-primary/15",
        data.related && "border-primary/60",
        risk > 0 && !selected && "border-risk/50",
        data.dim && "opacity-35",
      )}
    >
      <Handle type="target" position={lr ? Position.Left : Position.Top} className="!opacity-0" isConnectable={false} />
      <Handle type="source" position={lr ? Position.Right : Position.Bottom} className="!opacity-0" isConnectable={false} />

      <div className={cn("flex items-start gap-3 p-3", container && "items-center")}>
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-secondary text-foreground",
            n.kind === "account" && "bg-background/15 text-background",
            risk > 0 && "bg-risk-soft text-risk",
          )}
        >
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("flex items-center gap-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase", n.kind === "account" && "text-background/70")}>
            <span className="truncate">{shelf ? "Project-wide" : KIND_LABEL[n.kind]}</span>
            {!container && n.monthly != null && <span className="ml-auto shrink-0 text-[12px] font-semibold tracking-normal text-foreground normal-case tabular-nums">{money(total, currency)}</span>}
          </div>
          <div className="truncate text-[15px] leading-5 font-semibold">{shelf ? `${data.rows.length} shared resources` : n.label}</div>
          {!shelf && subtitle(n) && <div className={cn("truncate text-[12px] text-muted-foreground", n.kind === "account" && "text-background/70")}>{subtitle(n)}</div>}
        </div>
      </div>

      {!container && !shelf && data.links.length > 0 && (
        <ul className="-mt-1 flex flex-col gap-0.5 px-3 pb-2 text-[12px] text-muted-foreground" aria-label="Connections">
          {data.links.map((l) => (
            <li key={l} className="flex h-[20px] items-center gap-1.5 truncate">
              <span aria-hidden className="size-1 shrink-0 rounded-full bg-edge" />
              <span className="truncate">{l}</span>
            </li>
          ))}
        </ul>
      )}

      {(risk > 0 || waste > 0) && !container && (
        <div className="-mt-1 flex gap-1.5 px-3 pb-2">
          {risk > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-risk-soft px-2 py-0.5 text-[11px] font-medium text-risk">
              <Alert02Icon size={12} /> {risk} risk{risk > 1 ? "s" : ""}
            </span>
          )}
          {waste > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <CoinsEuroIcon size={12} /> {waste} saving{waste > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {data.rows.length > 0 && (
        <div className="flex flex-col gap-1 px-3 pb-3">
          {data.rows.map((r) => (
            <Row key={r.id} n={r} />
          ))}
        </div>
      )}

      {data.childCount > 0 && (
        <button
          type="button"
          aria-label={data.collapsed ? `Show ${data.childCount} items inside ${n.label}` : `Hide items inside ${n.label}`}
          onClick={(e) => {
            e.stopPropagation();
            toggle(n.id);
          }}
          className={cn(
            "nodrag absolute z-10 flex h-6 min-w-6 items-center justify-center rounded-full border bg-card px-1.5 text-[11px] font-semibold text-foreground shadow-[var(--shadow)] hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            lr ? "top-1/2 -right-3 -translate-y-1/2" : "-bottom-3 left-1/2 -translate-x-1/2",
          )}
        >
          {data.collapsed ? `+${data.childCount}` : "−"}
        </button>
      )}
    </div>
  );
}

export const InfraNode = memo(InfraNodeImpl);
