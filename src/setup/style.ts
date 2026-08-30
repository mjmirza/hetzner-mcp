// Dependency-free terminal color for the wizard and doctor. Goes plain when output
// is piped, or NO_COLOR / a dumb TERM is set, so CI and redirected output stay clean.
import { stdout } from "node:process";

const ESC = String.fromCharCode(27);
const ON = Boolean(stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== "dumb";

function wrap(code: string): (s: string) => string {
  return (s: string) => (ON ? `${ESC}[${code}m${s}${ESC}[0m` : s);
}

export const bold = wrap("1");
export const dim = wrap("2");
export const green = wrap("32");
export const red = wrap("31");
export const cyan = wrap("36");
