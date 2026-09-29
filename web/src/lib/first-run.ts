import type { InfraGraph } from "./types";

/** The one thing a first-time visitor needs to know about what they are looking at. */
export interface FirstRunNotice {
  /** Stable per situation, so a dismissal only hides this exact notice. */
  id: "sample" | "unreadable" | "empty";
  tone: "info" | "problem";
  title: string;
  body: string;
  /** A terminal command that moves the user forward, shown so it can be copied. */
  command?: string;
  /** Problems come back until fixed, so only information can be dismissed for good. */
  remember: boolean;
}

/** Hetzner's own messages arrive lower case and unpunctuated. */
function sentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const cap = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}

/** Decides the first-run notice for a graph, or none once the map shows real resources. */
export function firstRunNotice(graph: InfraGraph): FirstRunNotice | null {
  if (graph.source === "sample") {
    return {
      id: "sample",
      tone: "info",
      title: "You are looking at a sample",
      body: "These projects are made up, so look around freely. Nothing here is real and nothing can change. To map your own account, run this in a terminal:",
      command: "npx hetzner-mcp setup",
      remember: true,
    };
  }
  const projects = graph.totals.byProject;
  if (!projects.length) return null;
  const failed = projects.filter((p) => p.error);
  if (failed.length === projects.length) {
    const one = failed.length === 1;
    return {
      id: "unreadable",
      tone: "problem",
      title: one ? `Hetzner could not read ${failed[0]!.project}` : `Hetzner could not read any of your ${failed.length} projects`,
      body: `${sentence(failed[0]!.error ?? "The token was not accepted")} Usually the token was deleted or copied only in part. Make a new one in the Hetzner Console under your project, Security, API tokens, then run:`,
      command: "npx hetzner-mcp setup",
      remember: false,
    };
  }
  if (!failed.length && projects.every((p) => p.resources === 0)) {
    const one = projects.length === 1;
    return {
      id: "empty",
      tone: "info",
      title: one ? `${projects[0]!.project} is empty` : "Your projects are empty",
      body: "Nothing is running yet, so there is nothing to draw. Press Create to add a server or a network, or ask your assistant to set one up. It shows the price before anything costs money.",
      remember: true,
    };
  }
  return null;
}
