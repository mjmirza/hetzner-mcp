/**
 * Offline checks for the map's first-run notice: what a new visitor is told about the sample,
 * about a project Hetzner could not read, and about an empty project. No network, no browser.
 */
import { sampleGraph } from "../src/map/sample.js";
import type { InfraGraph, ProjectTotal } from "../src/map/types.js";
import { firstRunNotice } from "../web/src/lib/first-run.js";

let passed = 0;
let total = 0;
function assert(label: string, cond: boolean): void {
  total++;
  if (cond) passed++;
  process.stdout.write(`${cond ? "OK  " : "FAIL"} ${label}\n`);
}

const live = (byProject: ProjectTotal[]): InfraGraph => {
  const g = sampleGraph();
  return { ...g, source: "live", totals: { ...g.totals, byProject } };
};

const sample = firstRunNotice(sampleGraph());
assert("the sample says it is made up and how to map your own account", sample?.id === "sample" && /made up/.test(sample.body) && sample.command === "npx hetzner-mcp setup");
assert("the sample notice can be dismissed for good", sample?.remember === true);

const broken = firstRunNotice(live([{ project: "default", account: "a", monthly: 0, resources: 0, error: "the token you have provided is invalid" }]));
assert("an unreadable project is a problem, named, with the fix", broken?.tone === "problem" && broken.title.includes("default") && broken.command === "npx hetzner-mcp setup");
assert("Hetzner's message is shown as a proper sentence", broken?.body.startsWith("The token you have provided is invalid.") === true);
assert("a problem comes back until it is fixed", broken?.remember === false);

const twoBroken = firstRunNotice(live([
  { project: "a", account: "x", monthly: 0, resources: 0, error: "bad" },
  { project: "b", account: "x", monthly: 0, resources: 0, error: "bad" },
]));
assert("several unreadable projects are counted", twoBroken?.title.includes("2 projects") === true);

const partly = firstRunNotice(live([
  { project: "a", account: "x", monthly: 5, resources: 3 },
  { project: "b", account: "x", monthly: 0, resources: 0, error: "bad" },
]));
assert("one bad project among good ones does not cover the map", partly === null);

const empty = firstRunNotice(live([{ project: "default", account: "a", monthly: 0, resources: 0 }]));
assert("an empty project says so and points at Create", empty?.id === "empty" && empty.title === "default is empty" && /Create/.test(empty.body));

assert("a map with real resources shows no notice", firstRunNotice(live([{ project: "p", account: "a", monthly: 9, resources: 4 }])) === null);
assert("no projects at all shows no notice", firstRunNotice(live([])) === null);

process.stdout.write(`\n${passed}/${total} first-run checks passed\n`);
if (passed !== total) process.exitCode = 1;
