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
  await page.close();
  return out;
}

async function main(): Promise<void> {
  const handle = await startMapServer(loadConfig(), { demo: true, port: 43480 });
  const browser = await chromium.launch();
  let results: Result[] = [];
  try {
    results = await Promise.all(SIZES.map((s) => checkSize(browser, handle.url, s.width, s.height)));
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
