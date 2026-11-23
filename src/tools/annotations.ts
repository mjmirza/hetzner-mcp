/**
 * Hint objects for registerTool. Not a guard. The cost guard, confirm requirement,
 * and read-only mode in src/cost.ts and src/security.ts still decide what runs.
 * See docs/SECURITY.md.
 *
 * openWorldHint is true for every tool that calls the Hetzner API, because the account
 * is an external world this server does not define, and false only for contribute_or_report,
 * which builds a link in process and does not call out.
 *
 * idempotentHint is true for reads, because a repeat does not change the account. Writes
 * leave it false. A second create is another resource or an error, and a second delete is
 * not a guaranteed no-op.
 *
 * destructiveHint is set on reads too, to false. The spec default is true, and that default
 * is what made an unannotated list look like a destructive write.
 *
 * Spec: https://modelcontextprotocol.io/specification/2025-11-25/schema#toolannotations
 */
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/** List, get, audit, map, spend, and capacity. Nothing in the account changes. */
export const readOnly: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** contribute_or_report. A link built in process, no Hetzner call. */
export const closedRead: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Creates, attaches, and assigns. Additive. A repeat is not a no-op. */
export const additive: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

/**
 * Deletes, detaches, unassigns, and the raw request tools. The request tools can send
 * any method, including power-off, rebuild, and DELETE, so they take the cautious hint.
 */
export const destructive: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};
