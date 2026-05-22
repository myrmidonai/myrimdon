import type { ArtifactStore } from '../foundation/artifact-store.js';

export interface ArtifactStatusRow { id: string; status: string }
export interface ProcRow { session_id: string; pid: number }

export async function detectMissingArtifacts(
  artifacts: ArtifactStatusRow[],
  store: ArtifactStore,
): Promise<string[]> {
  const missing: string[] = [];
  for (const a of artifacts) {
    if (a.status !== 'valid') continue;
    if (!(await store.exists(a.id))) missing.push(a.id);
  }
  return missing;
}

export function detectPhantomRunning(procs: ProcRow[]): string[] {
  return procs
    .filter(({ pid }) => {
      try { process.kill(pid, 0); return false; }
      catch { return true; }
    })
    .map((p) => p.session_id);
}
