// Layout gate: opens the sample map in a real browser at every common size and fails on any
// wrapped header text, card content spilling out of its card, or overlapping cards.
import { readFileSync } from "node:fs";
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

async function main(): Promise<void> {
  const handle = await startMapServer(loadConfig(), { demo: true, port: 43480 });
  const browser = await chromium.launch();
  let results: Result[] = [];
  try {
    results = await Promise.all(SIZES.map((s) => checkSize(browser, handle.url, s.width, s.height)));
    results.push({ layouts: 1, cards: 0, failures: await checkReset(browser, handle.url) });
  } finally {
    await browser.close();
    await handle.close();
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
