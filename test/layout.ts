// Layout gate: opens the sample map in a real browser at every common size and fails on any
// wrapped header text, card content spilling out of its card, or overlapping cards.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleGraph } from "../src/map/sample.js";
import { chromium, type Browser, type Page } from "playwright";
import { loadConfig } from "../src/config.js";
import { startMapServer } from "../src/map/server.js";
import { invoicePdf } from "./invoice-pdf.js";

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
  const spendTab = page.locator("[role=tab][aria-label=Spend]");
  if (await spendTab.isVisible()) {
    await spendTab.click();
    const summary = page.locator("[aria-label='Spend summary']");
    await summary.waitFor({ timeout: 5000 }).catch(() => undefined);
    await probePage(page, `${tag} spend`, out);
    const text = (await summary.isVisible()) ? await summary.innerText() : "";
    if (!/This month so far/.test(text) || !/12 invoices, all totals check out/.test(text)) out.failures.push(`${tag} spend: the spend summary did not render`);
    const month = page.locator("[aria-label=Months] li button[aria-expanded]").nth(1);
    await month.click();
    await probePage(page, `${tag} spend month open`, out);
    for (const s of ["Matches", "Invoice higher", "Invoice missing"]) {
      if (!(await page.getByText(s, { exact: true }).first().isVisible())) out.failures.push(`${tag} spend: no "${s}" month shown`);
    }
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

// After the map restarts it has a new key. Pasting the new link into an open tab must work.
async function checkNewKey(browser: Browser): Promise<string[]> {
  const out: string[] = [];
  let handle = await startMapServer(loadConfig(), { demo: true, port: 43482 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(handle.url);
    await page.waitForSelector(".react-flow__node", { timeout: 8000 });
    const oldKey = handle.token;
    await handle.close();
    handle = await startMapServer(loadConfig(), { demo: true, port: 43482 });
    if (handle.token === oldKey) out.push("a restarted map kept the same key");
    const stale = await page.evaluate(async (k) => (await fetch("/api/meta", { headers: { "X-Hzmap": k } })).text(), oldKey);
    if (!/out of date/.test(stale)) out.push(`an old key does not say the link is out of date (got: ${stale.slice(0, 60)})`);
    const missing = await page.evaluate(async () => (await fetch("/api/meta", { headers: { "X-Hzmap": "" } })).text());
    if (!/without its access key/.test(missing)) out.push(`a missing key does not say the key is missing (got: ${missing.slice(0, 60)})`);
    await page.goto(handle.url);
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 0 && !location.hash, null, { timeout: 8000 })
      .catch(() => out.push("pasting the new link into an open tab does not load the map"));
  } finally {
    await page.close();
    await handle.close();
  }
  return out.map((p) => `new key: ${p}`);
}

// With storage blocked the key cannot be saved, so it must stay in the link for a reload.
async function checkBlockedStorage(browser: Browser): Promise<string[]> {
  const out: string[] = [];
  const handle = await startMapServer(loadConfig(), { demo: true, port: 43492 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("blocked", "SecurityError");
      };
    });
    await page.goto(handle.url);
    await page.waitForSelector(".react-flow__node", { timeout: 8000 });
    if (!page.url().includes("#k=")) out.push("the key was removed from the address bar although it could not be saved");
    await page.reload();
    await page.waitForSelector(".react-flow__node", { timeout: 8000 }).catch(() => out.push("the map does not load again after a reload"));
  } finally {
    await page.close();
    await handle.close();
  }
  return out.map((p) => `blocked storage: ${p}`);
}

// Opened without its key, the page asks for it and opens once a pasted link is accepted.
async function checkKeyEntry(browser: Browser): Promise<string[]> {
  const out: string[] = [];
  const handle = await startMapServer(loadConfig(), { demo: true, port: 43483 });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(handle.url.split("#")[0]!);
    const input = page.locator("#map-key");
    const shown = await input.waitFor({ timeout: 8000 }).then(() => true, () => false);
    if (!shown) return ["key entry: no key box when the page has no key"];
    await input.fill("not a key");
    await page.getByRole("button", { name: "Open the map" }).click();
    if (!/not the map link or key/.test(await page.locator("#map-key-problem").innerText())) out.push("a wrong value is not explained");
    await input.fill(handle.url);
    await page.getByRole("button", { name: "Open the map" }).click();
    // Phones open on the List view, so check that the box is gone and the estate loaded.
    await page
      .waitForFunction(() => !document.querySelector("#map-key") && /production/.test(document.querySelector("main")?.textContent ?? ""), null, { timeout: 8000 })
      .catch(() => out.push("a pasted link does not open the map"));
  } finally {
    await page.close();
    await handle.close();
  }
  return out.map((p) => `key entry: ${p}`);
}

// Adding an invoice PDF runs the real reader in the browser: parse, checks, save, duplicate, remove.
async function checkInvoiceImport(browser: Browser): Promise<string[]> {
  const out: string[] = [];
  const env: NodeJS.ProcessEnv = { HETZNER_CLOUD_TOKEN: "t".repeat(64), XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "hz-layout-spend-")) };
  const handle = await startMapServer(loadConfig(env), { env, port: 0, collect: async (ws) => ({ ...sampleGraph(), workspace: ws }) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const file = (name: string, buffer: Buffer) => ({ name, mimeType: "application/pdf", buffer });
  const status = () => page.locator("[role=status] li").first().innerText({ timeout: 20000 }).catch(() => "");
  try {
    await page.goto(handle.url);
    await page.locator("[role=tab][aria-label=Spend]").click();
    await page.locator("[aria-label='Spend summary']").waitFor({ timeout: 8000 });
    await page.setInputFiles("input[type=file]", file("broken.pdf", invoicePdf({ itemNet: "70,0000 €" })));
    if (!/do not add up.*line items add up to €80\.00, but the subtotal is €90\.00/.test(await status())) out.push("an invoice whose items do not add up is not refused with its numbers");
    await page.setInputFiles("input[type=file]", file("good.pdf", invoicePdf()));
    await page.getByText("Invoice 900000000042 added.").waitFor({ timeout: 20000 }).catch(() => out.push("a valid synthetic invoice was not added"));
    await page.getByText(/^1 invoice, all totals check out/).waitFor({ timeout: 8000 }).catch(() => out.push("the validation summary does not count the added invoice"));
    await page.setInputFiles("input[type=file]", file("again.pdf", invoicePdf()));
    await page.getByText(/was already added/).waitFor({ timeout: 20000 }).catch(() => out.push("adding the same invoice twice is not refused"));
    await page.getByRole("button", { name: "Remove invoice 900000000042" }).click();
    await page.getByText(/^No invoices added yet/).waitFor({ timeout: 8000 }).catch(() => out.push("removing an invoice does not update the page"));
  } finally {
    await page.close();
    await handle.close();
  }
  return out.map((p) => `invoice import: ${p}`);
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
    results.push({ layouts: 1, cards: 0, failures: await checkNewKey(browser) });
    results.push({ layouts: 1, cards: 0, failures: await checkKeyEntry(browser) });
    results.push({ layouts: 1, cards: 0, failures: await checkBlockedStorage(browser) });
    results.push({ layouts: 1, cards: 0, failures: await checkInvoiceImport(browser) });
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
