/** Terminal prompts for setup: plain questions, and hidden ones for secrets that must not echo. */
import { createInterface, type Interface } from "node:readline/promises";
import { stderr } from "node:process";
import { Writable } from "node:stream";

export interface Prompter {
  ask: (question: string) => Promise<string>;
  /** Asks without echoing what is typed, so a token never lands on screen or in a recording. */
  askHidden: (question: string) => Promise<string>;
  close: () => void;
}

export function createPrompter(input: NodeJS.ReadableStream, output: NodeJS.WritableStream & { columns?: number }, terminal: boolean): Prompter {
  let muted = false;
  const sink = new Writable({
    write(chunk, encoding, done) {
      if (!muted) output.write(chunk, encoding);
      done();
    },
  }) as Writable & { columns?: number };
  Object.defineProperty(sink, "columns", { get: () => output.columns });
  const rl: Interface = createInterface({ input, output: sink, terminal });
  return {
    ask: (q) => rl.question(q),
    askHidden: async (q) => {
      output.write(q);
      muted = true;
      try {
        return await rl.question("");
      } finally {
        muted = false;
        output.write("\n");
      }
    },
    close: () => rl.close(),
  };
}

/** Reads everything piped in, for --token-stdin. Only the first line counts. */
export async function readStdinLine(input: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of input) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0]!.trim();
}

/** Arguments show up in the process list for every local user, so say so once. */
export function warnVisibleSecrets(flags: string[]): void {
  for (const f of flags) stderr.write(`  Warning: ${f} on the command line is visible to other local users. Prefer --token-stdin, an environment variable, or the prompt.\n`);
}
