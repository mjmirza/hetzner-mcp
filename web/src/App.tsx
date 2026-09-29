import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  getNodesBounds,
  getViewportForBounds,
  useReactFlow,
  useStore,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import {
  Add02Icon,
  ArrowDataTransferHorizontalIcon,
  ArrowDataTransferVerticalIcon,
  ChartRelationshipIcon,
  HierarchySquare02Icon,
  ListViewIcon,
  Loading03Icon,
  Menu02Icon,
  PauseCircleIcon,
  PlayCircle02Icon,
  Moon02Icon,
  MoreHorizontalCircle02Icon,
  Refresh03Icon,
  Search02Icon,
  Undo02Icon,
  SecurityCheckIcon,
  Sun02Icon,
} from "hugeicons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CardContext, InfraNode, KIND_ICON } from "@/components/InfraNode";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { RelationEdge } from "@/components/RelationEdge";
import { Inspector } from "@/components/Inspector";
import { ListView } from "@/components/ListView";
import { AuditView } from "@/components/AuditView";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import { CreateDialog } from "@/components/CreateDialog";
import { DeleteDialog } from "@/components/DeleteDialog";
import { api } from "@/lib/api";
import { planFlow, type BuildResult, type CardData, type Direction } from "@/lib/layout";
import { runDagre } from "@/lib/dagre-run";
import { useLiveStatus, type LiveLookup } from "@/lib/live";
import { CheckedAgo } from "@/components/LiveStatus";
import { relationsByNode } from "@/lib/relations";
import { activeWorkspace, loadSequencer, pickWorkspace } from "@/lib/workspace";
import { CREATABLE, KIND_LABEL } from "@/lib/format";
import type { InfraGraph, MapNode, Meta, NodeKind, WorkspaceSummary } from "@/lib/types";

type ViewMode = "hierarchy" | "connections" | "list" | "audit";
/** Above this many resources the canvas opens with every project folded, so it stays responsive. */
const LARGE_ESTATE = 400;
const isLarge = (g: InfraGraph | null) => (g?.nodes.length ?? 0) > LARGE_ESTATE;
const initialFold = (g: InfraGraph | null): Set<string> => (isLarge(g) ? new Set(g!.nodes.filter((n) => n.kind === "project").map((n) => n.id)) : new Set());
/** Layouts with more cards than this run in a Web Worker. */
const WORKER_LAYOUT_CARDS = 400;
let layoutWorker: Worker | null | undefined;
function getLayoutWorker(): Worker | null {
  if (layoutWorker === undefined) {
    try {
      layoutWorker = new Worker(new URL("./lib/dagre.worker.ts", import.meta.url), { type: "module" });
    } catch {
      layoutWorker = null;
    }
  }
  return layoutWorker;
}
let layoutSeq = 0;
const EMPTY_BUILD: BuildResult = { nodes: [], edges: [], hostOf: new Map() };
type Pos = { x: number; y: number };
const nodeTypes = { card: InfraNode };
const edgeTypes = { relation: RelationEdge };

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked. The layout still works, it just is not remembered.
  }
}

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

function MapBoard({ graph, view, direction, collapsed, focus, selected, onSelect, onToggle, positions, setPositions, fitKey, animate, live }: {
  animate: boolean;
  live: LiveLookup;
  graph: InfraGraph;
  view: "hierarchy" | "connections";
  direction: Direction;
  collapsed: Set<string>;
  focus: string | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onToggle: (id: string) => void;
  positions: Map<string, Pos>;
  setPositions: (m: Map<string, Pos>) => void;
  fitKey: string;
}) {
  const flow = useReactFlow();
  const width = useStore((st) => st.width);
  const height = useStore((st) => st.height);
  // Fit the whole map only while the text stays readable. Past that, stop at 75% zoom and start
  // at the top-left of the tree, so a large estate scrolls instead of shrinking to specks.
  const fitReadable = useCallback(
    (duration: number) => {
      const ns = flow.getNodes();
      if (!ns.length || !width || !height) return;
      const b = getNodesBounds(ns);
      const vp = getViewportForBounds(b, width, height, 0.15, 1.1, 0.12);
      const MIN = 0.75;
      if (vp.zoom >= MIN) flow.setViewport(vp, { duration });
      else flow.setViewport({ zoom: MIN, x: 32 - b.x * MIN, y: 32 - b.y * MIN }, { duration });
    },
    [flow, width, height],
  );
  // Cards grow to fit their content. Once the browser measures them, the layout reruns with
  // the real heights, so a long card never spills into the next one.
  const [heights, setHeights] = useState<Map<string, number>>(new Map());
  // Large layouts keep the estimated heights: every pan measures new cards and would relayout.
  const [large, setLarge] = useState(false);
  const planned = useMemo(
    () => planFlow(graph, { view, direction, collapsed, focusProject: focus, selected, positions, heights: large ? undefined : heights, animate }),
    [graph, view, direction, collapsed, focus, selected, positions, heights, animate, large],
  );
  const offThread = planned.plan.nodes.length > WORKER_LAYOUT_CARDS;
  useEffect(() => setLarge(offThread), [offThread]);
  const onThread = useMemo(() => (offThread ? null : planned.finish(runDagre(planned.plan))), [planned, offThread]);
  const [fromWorker, setFromWorker] = useState<{ result: BuildResult; fitKey: string; graph: InfraGraph } | null>(null);
  useEffect(() => {
    if (!offThread) return;
    const seq = ++layoutSeq;
    const worker = getLayoutWorker();
    const done = (centres: Map<string, { x: number; y: number }>) => setFromWorker({ result: planned.finish(centres), fitKey, graph });
    if (!worker) {
      const t = setTimeout(() => done(runDagre(planned.plan)), 0);
      return () => clearTimeout(t);
    }
    const onMessage = (e: MessageEvent<{ seq: number; centres: Array<[string, { x: number; y: number }]> }>) => {
      if (e.data.seq === seq) done(new Map(e.data.centres));
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({ seq, plan: planned.plan });
    return () => worker.removeEventListener("message", onMessage);
    // fitKey travels with the result so the view refits once the new layout lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planned, offThread]);
  // A layout from another workspace never shows, even for the moment before the new one lands.
  const built = onThread ?? (fromWorker?.graph === graph ? fromWorker.result : EMPTY_BUILD);
  const [nodes, setNodes] = useState<Node<CardData>[]>(built.nodes);
  useEffect(() => setNodes(built.nodes), [built]);

  useEffect(() => {
    const t = setTimeout(() => fitReadable(280), 30);
    return () => clearTimeout(t);
  }, [fitKey, fitReadable]);
  const fittedWorker = useRef("");
  useEffect(() => {
    if (!fromWorker || fittedWorker.current === fromWorker.fitKey) return;
    fittedWorker.current = fromWorker.fitKey;
    const t = setTimeout(() => fitReadable(280), 30);
    return () => clearTimeout(t);
  }, [fromWorker, fitReadable]);

  // Bring the selected card and everything connected to it into view.
  const builtRef = useRef(built);
  builtRef.current = built;
  useEffect(() => {
    if (!selected) return;
    const t = setTimeout(() => {
      const ids = builtRef.current.nodes.filter((n) => n.selected || n.data.related).map((n) => ({ id: n.id }));
      if (ids.length) flow.fitView({ nodes: ids, padding: 0.25, duration: 320, maxZoom: 1, minZoom: 0.6 });
    }, 80);
    return () => clearTimeout(t);
  }, [selected, flow]);

  const measuredOnce = heights.size > 0;
  useEffect(() => {
    if (!measuredOnce || selected) return;
    const t = setTimeout(() => fitReadable(200), 30);
    return () => clearTimeout(t);
    // Refit once, when the first real measurements arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuredOnce]);

  const onNodesChange = useCallback((changes: NodeChange<Node<CardData>>[]) => {
    setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type === "position" || c.type === "dimensions"), ns));
    const measured = changes.filter((c) => c.type === "dimensions" && c.dimensions);
    if (!measured.length) return;
    setHeights((old) => {
      let next: Map<string, number> | null = null;
      for (const c of measured) {
        if (c.type !== "dimensions" || !c.dimensions) continue;
        const h = Math.ceil(c.dimensions.height);
        if (Math.abs((old.get(c.id) ?? 0) - h) > 1) {
          next ??= new Map(old);
          next.set(c.id, h);
        }
      }
      return next ?? old;
    });
  }, []);

  const ctx = useMemo(() => ({ select: (id: string) => onSelect(id), toggle: onToggle, currency: graph.currency, live }), [onSelect, onToggle, graph.currency, live]);

  return (
    <CardContext.Provider value={ctx}>
      <ReactFlow
        nodes={nodes}
        edges={built.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
        onNodeDragStop={(_, n) => {
          const next = new Map(positions);
          next.set(n.id, n.position);
          setPositions(next);
        }}
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        elementsSelectable
        minZoom={0.15}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        // Only very large estates skip drawing off-screen cards; small ones draw everything.
        onlyRenderVisibleElements={large}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--stage-dot)" />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          pannable
          zoomable
          position="bottom-left"
          className="!hidden [@media(min-width:768px)_and_(min-height:700px)]:!block"
          style={{ width: 168, height: 112 }}
          nodeColor={(n) => ((n.data as CardData).node.flags.some((f) => f.kind === "risk") ? "var(--risk)" : "var(--edge)")}
          nodeBorderRadius={6}
          bgColor="var(--card)"
          maskColor="color-mix(in oklch, var(--stage) 72%, transparent)"
          maskStrokeColor="var(--edge)"
        />
      </ReactFlow>
    </CardContext.Provider>
  );
}

export function App() {
  const desktop = useMedia("(min-width: 1024px)");
  const phone = useMedia("(max-width: 639px)");
  const [graph, setGraph] = useState<InfraGraph | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<ViewMode>(() => (window.matchMedia("(max-width: 639px)").matches ? "list" : stored<ViewMode>("hzmap-view", "hierarchy")));
  const [direction, setDirection] = useState<Direction>(() => stored<Direction>("hzmap-dir", "LR"));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const reduceMotion = useMedia("(prefers-reduced-motion: reduce)");
  const [flowOn, setFlowOn] = useState(() => stored<boolean>("hzmap-flow", false));
  const animate = flowOn && !reduceMotion;
  useEffect(() => store("hzmap-flow", flowOn), [flowOn]);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(0);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspace, setWorkspace] = useState<string | null>(() => stored<string | null>("hzmap-ws", null));
  useEffect(() => store("hzmap-ws", workspace), [workspace]);
  const [addProject, setAddProject] = useState(false);
  const [creating, setCreating] = useState<NodeKind | null>(null);
  const [deleting, setDeleting] = useState<MapNode | null>(null);
  const live = useLiveStatus(graph);

  const layoutKey = `hzmap-pos:${view}:${direction}:${focus ?? "all"}`;
  const [positions, setPositionsState] = useState<Map<string, Pos>>(() => new Map(stored<Array<[string, Pos]>>(layoutKey, [])));
  useEffect(() => setPositionsState(new Map(stored<Array<[string, Pos]>>(layoutKey, []))), [layoutKey]);
  const setPositions = (m: Map<string, Pos>) => {
    setPositionsState(m);
    store(layoutKey, [...m.entries()]);
  };

  // One reset for everything a person can change on the canvas, in every view, then refit.
  const [resets, setResets] = useState(0);
  const dirty = positions.size > 0 || collapsed.size > 0 || focus !== null || selected !== null;
  const resetView = () => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("hzmap-pos:")) localStorage.removeItem(k);
    } catch {
      // Private mode: nothing stored, nothing to clear.
    }
    setPositionsState(new Map());
    setCollapsed(initialFold(graph));
    setFocus(null);
    setSelected(null);
    setResets((n) => n + 1);
    toast.success("Map reset to its original layout");
  };

  const [sequencer] = useState(loadSequencer);
  const foldedFor = useRef<string | null>(null);
  const skipReload = useRef(false);
  const load = useCallback(async (refresh = false) => {
    const seq = sequencer.begin();
    setRefreshing(true);
    try {
      const ws = await api.workspaces().catch(() => ({ default: "", workspaces: [] as WorkspaceSummary[] }));
      if (!sequencer.isCurrent(seq)) return;
      setWorkspaces(ws.workspaces);
      // A remembered workspace that no longer exists falls back to the default, loaded right here.
      const picked = pickWorkspace(workspace, ws.workspaces);
      const target = picked.target;
      if (picked.stale) {
        skipReload.current = true;
        setWorkspace(null);
      }
      const [g, m] = await Promise.all([api.graph(refresh, target), api.meta()]);
      // A newer load started (a quick workspace switch), so this older answer must not win.
      if (!sequencer.isCurrent(seq)) return;
      setGraph(g);
      // A new workspace on a large estate opens folded; a refresh keeps what the person opened.
      if (foldedFor.current !== (g.workspace ?? "")) {
        foldedFor.current = g.workspace ?? "";
        if (isLarge(g)) setCollapsed(initialFold(g));
      }
      setMeta(m);
      setError(null);
    } catch (err) {
      if (sequencer.isCurrent(seq)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (sequencer.isCurrent(seq)) setRefreshing(false);
    }
  }, [workspace, sequencer]);
  useEffect(() => {
    // Clearing a stale workspace changes `load`; that load already fetched the default.
    if (skipReload.current) {
      skipReload.current = false;
      return;
    }
    load();
  }, [load]);

  useEffect(() => store("hzmap-view", view === "hierarchy" || view === "connections" ? view : "hierarchy"), [view]);
  useEffect(() => store("hzmap-dir", direction), [direction]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("hzmap-theme", dark ? "dark" : "light");
    } catch {
      // Storage blocked. Theme still applies for this visit.
    }
  }, [dark]);

  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  const relations = useMemo(() => (graph ? relationsByNode(graph) : new Map()), [graph]);
  const selectedNode = selected ? byId.get(selected) ?? null : null;

  const toggle = useCallback((id: string) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      if (!id) return;
      // Reveal the card if it sits inside a collapsed parent or a different focused project.
      const n = byId.get(id);
      if (!n) return;
      const chain: string[] = [];
      let p = n.parent;
      while (p) {
        chain.push(p);
        p = byId.get(p)?.parent;
      }
      setCollapsed((s) => (chain.some((c) => s.has(c)) ? new Set([...s].filter((c) => !chain.includes(c))) : s));
      if (focus && !chain.includes(focus) && focus !== id) setFocus(null);
      if (!desktop) setPanelOpen(false);
    },
    [byId, focus, desktop],
  );

  const projects = graph?.nodes.filter((n) => n.kind === "project") ?? [];
  const accounts = [...new Set(projects.map((p) => p.account))];
  const targetProject = focus ?? (selectedNode ? projects.find((p) => p.label === selectedNode.project && p.account === selectedNode.account)?.id : undefined) ?? projects[0]?.id ?? null;
  const targetLabel = projects.find((p) => p.id === targetProject)?.label ?? "";
  const canWrite = meta?.mode === "live" && !meta.readOnly;
  const partsOf = (n: MapNode) => graph!.nodes.filter((x) => x.parent === n.id && (x.kind === "volume" || x.kind === "primary_ip"));

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q || !graph) return;
    const hit = graph.nodes.find((n) => n.label.toLowerCase().includes(q) || ["ip", "ipv4", "ipv6"].some((k) => String(n.details[k] ?? "").toLowerCase().includes(q)));
    if (hit) {
      if (view === "list" || view === "audit") setView("hierarchy");
      select(hit.id);
      setSearchOpen(false);
    }
    else toast(`Nothing called “${query.trim()}”.`);
  };

  const panel = graph && (
    <ProjectsPanel
      graph={graph}
      focus={focus}
      onFocus={(p) => {
        setFocus(p);
        setSelected(null);
        if (!desktop) setPanelOpen(false);
      }}
      onAddProject={() => setAddProject(true)}
      liveNote={<CheckedAgo at={live.checkedAt} failed={live.failed} />}
      onOpenAudit={(i) => {
        setAuditOpen(i);
        setView("audit");
        if (!desktop) setPanelOpen(false);
      }}
      updated={ago(graph.generatedAt)}
      header={
        workspaces.length > 1 ? (
          <WorkspaceSwitcher
            workspaces={workspaces}
            active={graph.workspace ?? workspaces[0]!.name}
            onChange={(name) => {
              setWorkspace(name);
              setFocus(null);
              setSelected(null);
              setCollapsed(initialFold(graph));
              if (!desktop) setPanelOpen(false);
            }}
          />
        ) : undefined
      }
    />
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-dvh flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 overflow-hidden px-3 whitespace-nowrap sm:px-4">
          {!desktop && (
            <Button variant="ghost" size="icon-sm" className="rounded-lg" onClick={() => setPanelOpen(true)} aria-label="Projects and insights">
              <Menu02Icon size={18} />
            </Button>
          )}
          <div className="flex shrink-0 items-center gap-2">
            <h1 className="hidden text-[15px] font-semibold lg:block">Infrastructure</h1>
            {meta && (
              <Badge variant={meta.mode === "demo" ? "secondary" : "outline"} className="rounded-md">
                {meta.mode === "demo" ? "Sample" : "Live"}
              </Badge>
            )}
            {graph && <span className="hidden text-[12px] text-muted-foreground 2xl:inline">Updated {ago(graph.generatedAt)}</span>}
          </div>

          <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)} className="mx-auto shrink-0">
            <TabsList className="rounded-lg">
              <TabsTrigger value="hierarchy" className="rounded-md" aria-label="Hierarchy">
                <HierarchySquare02Icon size={15} /> <span className="hidden lg:inline">Hierarchy</span>
              </TabsTrigger>
              <TabsTrigger value="connections" className="rounded-md" aria-label="Connections">
                <ChartRelationshipIcon size={15} /> <span className="hidden lg:inline">Connections</span>
              </TabsTrigger>
              <TabsTrigger value="list" className="rounded-md" aria-label="List">
                <ListViewIcon size={15} /> <span className="hidden lg:inline">List</span>
              </TabsTrigger>
              <TabsTrigger value="audit" className="rounded-md" aria-label="Audit">
                <SecurityCheckIcon size={15} /> <span className="hidden lg:inline">Audit</span>
                {graph?.audit && graph.audit.counts.critical + graph.audit.counts.high > 0 && (
                  <span aria-label={`${graph.audit.counts.critical + graph.audit.counts.high} urgent findings`} className="hidden rounded-full bg-risk px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums sm:inline">{graph.audit.counts.critical + graph.audit.counts.high}</span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex shrink-0 items-center gap-1">
            <form onSubmit={runSearch} className="relative hidden 2xl:block" role="search">
              <Search02Icon size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find by name or IP" aria-label="Find a resource" className="h-8 w-48 rounded-lg pl-8" />
            </form>
            <Button variant="ghost" size="icon-sm" className="hidden rounded-lg sm:inline-flex 2xl:hidden" onClick={() => setSearchOpen(true)} aria-label="Find a resource">
              <Search02Icon size={17} />
            </Button>
            {(view === "hierarchy" || view === "connections") && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="hidden rounded-lg sm:inline-flex"
                      onClick={() => setDirection((d) => (d === "LR" ? "TB" : "LR"))}
                      aria-label={direction === "LR" ? "Lay out top to bottom" : "Lay out left to right"}
                    >
                      {direction === "LR" ? <ArrowDataTransferVerticalIcon size={17} /> : <ArrowDataTransferHorizontalIcon size={17} />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{direction === "LR" ? "Top to bottom" : "Left to right"}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="hidden rounded-lg sm:inline-flex" onClick={resetView} disabled={!dirty} aria-label="Reset the map">
                      <Undo02Icon size={16} /> <span className="hidden xl:inline">Reset</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{dirty ? "Put every card back, show everything, and center the map" : "Nothing to reset"}</TooltipContent>
                </Tooltip>
              </>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="hidden rounded-lg sm:inline-flex" onClick={() => load(true)} disabled={refreshing} aria-label="Refresh from Hetzner">
                  {refreshing ? <Loading03Icon size={17} className="animate-spin" /> : <Refresh03Icon size={17} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{graph ? `Updated ${ago(graph.generatedAt)}. Refresh from Hetzner` : "Refresh from Hetzner"}</TooltipContent>
            </Tooltip>
            {(view === "hierarchy" || view === "connections") && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={animate ? "secondary" : "ghost"}
                    size="sm"
                    className="hidden rounded-lg sm:inline-flex"
                    onClick={() => setFlowOn((v) => !v)}
                    disabled={reduceMotion}
                    aria-pressed={animate}
                    aria-label={animate ? "Stop the flow animation" : "Animate the flow along the lines"}
                  >
                    {animate ? <PauseCircleIcon size={17} /> : <PlayCircle02Icon size={17} />}
                    <span className="hidden xl:inline">Flow</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{reduceMotion ? "Off because Reduce motion is on in your system" : animate ? "Stop the running dots" : "Run dots along the lines, like a workflow executing"}</TooltipContent>
              </Tooltip>
            )}
            <Button variant="ghost" size="icon-sm" className="hidden rounded-lg sm:inline-flex" onClick={() => setDark((d) => !d)} aria-label={dark ? "Use light mode" : "Use dark mode"}>
              {dark ? <Sun02Icon size={17} /> : <Moon02Icon size={17} />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="rounded-lg sm:hidden" aria-label="More options">
                  <MoreHorizontalCircle02Icon size={18} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-xl">
                {(view === "hierarchy" || view === "connections") && (
                  <>
                    <DropdownMenuItem className="rounded-lg" onSelect={() => setDirection((d) => (d === "LR" ? "TB" : "LR"))}>
                      {direction === "LR" ? <ArrowDataTransferVerticalIcon size={16} /> : <ArrowDataTransferHorizontalIcon size={16} />}
                      {direction === "LR" ? "Lay out top to bottom" : "Lay out left to right"}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="rounded-lg" disabled={!dirty} onSelect={resetView}>
                      <Undo02Icon size={16} />
                      Reset the map
                    </DropdownMenuItem>
                    <DropdownMenuItem className="rounded-lg" disabled={reduceMotion} onSelect={() => setFlowOn((v) => !v)}>
                      {animate ? <PauseCircleIcon size={16} /> : <PlayCircle02Icon size={16} />}
                      {animate ? "Stop the flow animation" : "Animate the flow"}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem className="rounded-lg" onSelect={() => setSearchOpen(true)}>
                  <Search02Icon size={16} />
                  Find a resource
                </DropdownMenuItem>
                <DropdownMenuItem className="rounded-lg" disabled={refreshing} onSelect={() => load(true)}>
                  <Refresh03Icon size={16} />
                  Refresh from Hetzner
                </DropdownMenuItem>
                <DropdownMenuItem className="rounded-lg" onSelect={() => setDark((d) => !d)}>
                  {dark ? <Sun02Icon size={16} /> : <Moon02Icon size={16} />}
                  {dark ? "Use light mode" : "Use dark mode"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="rounded-lg" disabled={!graph || projects.length === 0}>
                  <Add02Icon size={16} /> <span className="hidden sm:inline">Create</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 rounded-xl">
                <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">In project {targetLabel}</DropdownMenuLabel>
                {CREATABLE.map((c) => {
                  const Icon = KIND_ICON[c.kind];
                  return (
                    <DropdownMenuItem key={c.kind} className="items-start gap-2.5 rounded-lg py-2" onSelect={() => setCreating(c.kind)}>
                      <Icon size={17} className="mt-0.5" />
                      <span className="flex flex-col">
                        <span className="text-[13px] font-medium">{KIND_LABEL[c.kind]}</span>
                        <span className="text-[12px] text-muted-foreground">{c.hint}</span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="rounded-lg" onSelect={() => setAddProject(true)}>
                  Connect another project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
          {desktop && <aside className="w-72 shrink-0 overflow-hidden rounded-2xl bg-card shadow-[var(--shadow)]">{panel}</aside>}

          <main className="relative min-w-0 flex-1 overflow-hidden rounded-2xl bg-stage">
            {!graph && !error && (
              <div className="flex h-full items-center justify-center gap-2 rounded-2xl text-[13px] text-muted-foreground">
                <Loading03Icon size={18} className="animate-spin" /> Reading your Hetzner projects
              </div>
            )}
            {error && !graph && (
              <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl p-6 text-center">
                <p className="max-w-md text-[14px]">{error}</p>
                <Button className="rounded-lg" onClick={() => load(true)}>
                  Try again
                </Button>
              </div>
            )}
            {graph && view === "list" && <ListView graph={graph} focus={focus} selected={selected} onSelect={select} />}
            {graph && view === "audit" && (
              <AuditView
                key={auditOpen}
                initialOpen={auditOpen}
                graph={graph}
                onShow={(id) => {
                  setView("hierarchy");
                  select(id);
                }}
              />
            )}
            {graph && isLarge(graph) && (view === "hierarchy" || view === "connections") && (
              <p role="status" className="pointer-events-none absolute top-2 left-1/2 z-10 max-w-[calc(100%-1rem)] -translate-x-1/2 truncate rounded-full bg-card px-3 py-1 text-[12px] text-muted-foreground shadow-[var(--shadow)]">
                Large estate, {graph.nodes.length.toLocaleString()} resources. Projects open folded, use + on a project to show it.
              </p>
            )}
            {graph && (view === "hierarchy" || view === "connections") && (
              <ReactFlowProvider>
                <MapBoard
                  graph={graph}
                  view={view}
                  direction={direction}
                  collapsed={collapsed}
                  focus={focus}
                  selected={selected}
                  onSelect={select}
                  onToggle={toggle}
                  positions={positions}
                  setPositions={setPositions}
                  fitKey={`${view}:${direction}:${focus}:${collapsed.size}:${graph.generatedAt}:${positions.size === 0}:${resets}`}
                  animate={animate}
                  live={live}
                />
              </ReactFlowProvider>
            )}
          </main>

          {desktop && selectedNode && graph && (
            <aside className="w-[340px] shrink-0 overflow-y-auto rounded-2xl bg-card shadow-[var(--shadow)]">
              <Inspector
                node={selectedNode}
                parts={partsOf(selectedNode)}
                relations={relations.get(selectedNode.id) ?? []}
                byId={byId}
                currency={graph.currency}
                canDelete={canWrite}
                onSelect={select}
                onDelete={setDeleting}
                onClose={() => setSelected(null)}
              />
            </aside>
          )}
        </div>

        {!desktop && (
          <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
            <SheetContent side="left" className="w-[88vw] max-w-sm p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Projects and insights</SheetTitle>
                <SheetDescription>Costs, projects and findings</SheetDescription>
              </SheetHeader>
              {panel}
            </SheetContent>
          </Sheet>
        )}
        {!desktop && (
          <Sheet open={!!selectedNode} onOpenChange={(v) => !v && setSelected(null)}>
            <SheetContent side={phone ? "bottom" : "right"} className={phone ? "max-h-[80dvh] overflow-y-auto rounded-t-2xl p-0" : "w-[380px] overflow-y-auto p-0"}>
              <SheetHeader className="sr-only">
                <SheetTitle>{selectedNode?.label ?? "Details"}</SheetTitle>
                <SheetDescription>Details for the selected resource</SheetDescription>
              </SheetHeader>
              {selectedNode && graph && (
                <Inspector
                  node={selectedNode}
                  parts={partsOf(selectedNode)}
                  relations={relations.get(selectedNode.id) ?? []}
                  byId={byId}
                  currency={graph.currency}
                  canDelete={canWrite}
                  onSelect={select}
                  onDelete={setDeleting}
                />
              )}
            </SheetContent>
          </Sheet>
        )}

        <AddProjectDialog open={addProject} onOpenChange={setAddProject} accounts={accounts} demo={meta?.mode === "demo"} onAdded={() => load(true)} workspace={workspaces.length > 1 ? activeWorkspace(workspace, workspaces) : undefined} />
        <CreateDialog open={!!creating} onOpenChange={(v) => !v && setCreating(null)} kind={creating} project={targetProject} projectLabel={targetLabel} meta={meta} onCreated={() => load(true)} />
        <DeleteDialog
          node={deleting}
          onOpenChange={(v) => !v && setDeleting(null)}
          onDeleted={() => {
            setSelected(null);
            load(true);
          }}
        />
        <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="rounded-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Find a resource</DialogTitle>
            <DialogDescription>Type a name or an IP address. It opens on the map.</DialogDescription>
          </DialogHeader>
          <form onSubmit={runSearch} role="search" className="flex gap-2">
            <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="web-1 or 203.0.113.51" aria-label="Name or IP" className="rounded-lg" />
            <Button type="submit" className="rounded-lg">
              Find
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Toaster position="bottom-center" />
      </div>
    </TooltipProvider>
  );
}
