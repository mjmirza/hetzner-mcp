/** Package version, read once from package.json (npm always ships it). */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const VERSION = (require("../package.json") as { version: string }).version;
export const USER_AGENT = `hetzner-mcp/${VERSION} (+https://github.com/mjmirza/hetzner-mcp)`;
