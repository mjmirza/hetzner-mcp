/** Workspace choice and load ordering for the map, kept pure so the offline suite can test it. */

/** Numbers each load; only the newest one may write its result, so a slow old response is dropped. */
export function loadSequencer(): { begin: () => number; isCurrent: (n: number) => boolean } {
  let latest = 0;
  return { begin: () => ++latest, isCurrent: (n) => n === latest };
}

/** The workspace to load. A remembered name that no longer exists falls back to the default. */
export function pickWorkspace(remembered: string | null, available: ReadonlyArray<{ name: string }>): { target: string | undefined; stale: boolean } {
  const known = remembered !== null && available.some((w) => w.name === remembered);
  return { target: known ? remembered : undefined, stale: remembered !== null && !known };
}

/** Where a write (like Add project) lands: the workspace the person selected, not the one last drawn. */
export function activeWorkspace(selected: string | null, available: ReadonlyArray<{ name: string }>): string | undefined {
  if (selected !== null && available.some((w) => w.name === selected)) return selected;
  return available[0]?.name;
}
