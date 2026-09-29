// Release gate: the release tag must name the version in package.json, so a release
// made from the wrong commit or with a typo never publishes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Returns an error message, or null when the tag matches. */
export function tagMismatch(tag, version) {
  if (!tag) return "No release tag was given.";
  if (!version) return "package.json has no version.";
  return tag === `v${version}` || tag === version ? null : `Release tag ${tag} does not match package.json version ${version}.`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const problem = tagMismatch(process.env.TAG ?? "", pkg.version);
  if (problem) {
    process.stderr.write(problem + "\n");
    process.exit(1);
  }
  process.stdout.write(`Release tag matches ${pkg.version}.\n`);
}
