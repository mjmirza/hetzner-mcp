/** Runs fn over items with at most `limit` in flight. One failure never stops the rest. */
export async function settleWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]!, i) }; // worker pool: the bound on in-flight calls is the point
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}
