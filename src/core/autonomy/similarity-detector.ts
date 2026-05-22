export function isOscillating(prevChecksums: string[], currChecksums: string[]): boolean {
  if (prevChecksums.length === 0 && currChecksums.length === 0) return false;
  if (prevChecksums.length !== currChecksums.length) return false;
  const prev = new Set(prevChecksums);
  const curr = new Set(currChecksums);
  if (prev.size !== curr.size) return false;
  for (const c of curr) if (!prev.has(c)) return false;
  return true;
}
