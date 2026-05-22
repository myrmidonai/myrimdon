import type { Readable } from 'node:stream';

export type Checksum = string; // SHA-256 hex

export interface ArtifactStat {
  mtime: number;
  size: number;
  sha256?: string;
}

export interface ArtifactStore {
  put(id: string, content: Buffer | Readable): Promise<Checksum>;
  get(id: string): Promise<Readable>;
  stat(id: string): Promise<ArtifactStat>;
  exists(id: string): Promise<boolean>;
}
