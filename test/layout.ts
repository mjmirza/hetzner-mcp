// Layout gate: opens the sample map in a real browser at every common size and fails on any
// wrapped header text, card content spilling out of its card, or overlapping cards.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleGraph } from "../src/map/sample.js";
import { chromium, type Browser, type Page } from "playwright";
import { loadConfig } from "../src/config.js";
import { startMapServer } from "../src/map/server.js";

const probe = readFileSync(new URL("./layout-probe.js", import.meta.url), "utf8");
const SIZES = [375, 768, 1024, 1280, 1440, 1920].flatMap((width) => [500, 900].map((height) => ({ width, height })));

interface Result {
  layouts: number;
  cards: number;
  failures: string[];
}

async function probePage(page: Page, label: string, out: Result): Promise<void> {
  await page.waitForTimeout(700);
  const { cards, problems } = JSON.parse(await page.evaluate(probe)) as { cards: number; problems: string[] };
  out.layouts++;
  out.cards += cards;
  out.failures.push(...problems.map((p) => `${label}: ${p}`));
}

// One size: the default layout, then top-to-bottom, then the connections view, in that order.
async function checkSize(browser: Browser, url: string, width: number, height: number): Promise<Result> {
  const out: Result = { layouts: 0, cards: 0, failures: [] };
  const tag = `${width}x${height}`;
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url);
  await page.waitForSelector("header");
  await probePage(page, `${tag} hierarchy LR`, out);
  const toTB = page.locator("button[aria-label='Lay out top to bottom']");
  if (await toTB.isVisible()) {
    await toTB.click();
    await probePage(page, `${tag} hierarchy TB`, out);
  }
  const conn = page.locator("[role=tab][aria-label=Connections]");
  if (await conn.isVisible()) {
    await conn.click();
    await probePage(page, `${tag} connections`, out);
  }
  const list = page.locator("[role=tab][aria-label=List]");
  if (await list.isVisible()) {
    await list.click();
    await probePage(page, `${tag} list`, out);
  }
  const auditTab = page.locator("[role=tab][aria-label=Audit]");
  if (await auditTab.isVisible()) {
    await auditTab.click();
    await probePage(page, `${tag} audit`, out);
    const summary = page.locator("[aria-label='Audit summary']");
    if (!(await summary.isVisible()) || !/Grade [A-E]/.test(await summary.innerText())) out.failures.push(`${tag} audit: the audit report did not render`);
  }
  await page.close();
  return out;
}

// Drag a card, hide a project, press Reset: every card must be back where the layout put it.
async function checkReset(browser: Browser, url: string): Promise<string[]> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url);
  await page.waitForSelector(".react-flow__node");
  await page.waitForTimeout(900);
  const snap = () =>
    page.evaluate(() =>
      Object.fromEntries([...document.querySelectorAll<HTMLElement>(".react-flow__node")].map((n) => [n.dataset.id, n.style.transform])),
    );
  const before = await snap();
  const reset = page.locator("button[aria-label='Reset the map']");
  const out: string[] = [];
  if (!(await reset.isDisabled())) out.push("reset is enabled before anything changed");
  if (await page.locator("button[aria-label^='Workspace ']").count()) out.push("a single-workspace setup shows a workspace switcher");
  const card = page.locator(".react-flow__node").nth(3);
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 180, { steps: 8 });
  await page.mouse.up();
  await page.locator("button[aria-label^='Hide items inside']").first().click();
  await page.waitForTimeout(600);
  const changed = await snap();
  if (Object.keys(changed).length === Object.keys(before).length && JSON.stringify(changed) === JSON.stringify(before)) out.push("drag and hide did not change the map, test is not testing anything");
  await reset.click();
  await page.waitForTimeout(900);
  const after = await snap();
  if (JSON.stringify(after) !== JSON.stringify(before)) out.push(`reset did not restore the layout (${Object.keys(after).length} cards vs ${Object.keys(before).length})`);
  if (!(await reset.isDisabled())) out.push("reset still enabled after resetting");
  const reload = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("hzmap-pos:")).length);
  if (reload) out.push("dragged positions still stored after reset");
  await page.close();
  return out.map((p) => `reset: ${p}`);
}

// Twelve client workspaces: the switcher appears, searches, switches, and only the chosen one loads.
async function checkWorkspaces(browser: Browser): Promise<string[]> {
  const env: NodeJS.ProcessEnv = { HETZNER_CLOUD_TOKEN: "t".repeat(64), XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "hz-ws-")) };
  for (let i = 1; i <= 12; i++) {
    const k = `C${String(i).padStart(2, "0")}`;
    env[`HETZNER_CLOUD_TOKEN_${k}`] = `${k}`.repeat(32);
    env[`HETZNER_WORKSPACE_${k}`] = `Client ${String(i).padStart(2, "0")}`;
  }
  const asked: Array<string | undefined> = [];
  const handle = await startMapServer(loadConfig(env), { env, port: 43481, collect: async (ws) => (asked.push(ws), { ...sampleGraph(), workspace: ws }) });
  const out: string[] = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(handle.url);
    const trigger = page.locator("button[aria-label^='Workspace ']");
    await trigger.waitFor({ timeout: 8000 });
    if (page.url().includes("#k=")) out.push("the launch key stays visible in the address bar");
    await page.reload();
    await trigger.waitFor({ timeout: 8000 }).catch(() => out.push("the map does not load again after a reload"));
    if (!(await trigger.innerText()).includes("Personal")) out.push("default workspace is not selected first");
    await trigger.click();
    const find = page.locator("input[aria-label='Find a workspace']");
    if (!(await find.isVisible())) out.push("no search box with 13 workspaces");
    await find.fill("07");
    const items = page.locator("[role=menuitem]");
    if ((await items.count()) !== 1) out.push(`search for 07 shows ${await items.count()} workspaces, expected 1`);
    await items.first().click();
    await page.waitForTimeout(900);
    if (!(await trigger.innerText()).includes("Client 07")) out.push("switcher did not change to Client 07");
    if (!asked.includes("Client 07")) out.push(`map did not load Client 07 (loaded: ${asked.join(", ")})`);
    if (asked.length > 3) out.push(`loaded ${asked.length} workspaces, expected only the ones shown`);
    const { problems } = JSON.parse(await page.evaluate(probe)) as { problems: string[] };
    out.push(...problems);
    await page.reload();
    await trigger.waitFor();
    if (!(await trigger.innerText()).includes("Client 07")) out.push("chosen workspace not remembered after reload");
  } finally {
    await page.close();
    await handle.close();
  }
  return out.map((p) => `workspaces: ${p}`);
}

async function main(): Promise<void> {
  const handle = await startMapServer(loadConfig(), { demo: true, port: 43480 });
  const browser = await chromium.launch();
  let results: Result[] = [];
  try {
    results = await Promise.all(SIZES.map((s) => checkSize(browser, handle.url, s.width, s.height)));
    results.push({ layouts: 1, cards: 0, failures: await checkReset(browser, handle.url) });
  } finally {
    await handle.close();
  }
  try {
    results.push({ layouts: 1, cards: 0, failures: await checkWorkspaces(browser) });
  } finally {
    await browser.close();
  }
  const failures = results.flatMap((r) => r.failures);
  const layouts = results.reduce((s, r) => s + r.layouts, 0);
  const cards = results.reduce((s, r) => s + r.cards, 0);
  if (cards === 0) failures.push("no cards rendered in any layout, the gate saw nothing");
  if (failures.length) {
    console.error(`layout: ${failures.length} problem(s)\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`layout: ${layouts} layouts checked, ${cards} cards, 0 problems`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
