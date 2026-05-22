import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { ArtifactStore, ArtifactStat, Checksum } from '../artifact-store.js';

export class LocalArtifactStore implements ArtifactStore {
  private readonly registry = new Map<string, string>(); // artifactId → absolute path

  constructor(private readonly projectRoot: string) {}

  register(id: string, relativePath: string): void {
    this.registry.set(id, resolve(this.projectRoot, relativePath));
  }

  private resolve(id: string): string {
    const p = this.registry.get(id);
    if (!p) throw new Error(`Artifact '${id}' not registered`);
    return p;
  }

  async exists(id: string): Promise<boolean> {
    return existsSync(this.resolve(id));
  }

  async stat(id: string): Promise<ArtifactStat> {
    const p = this.resolve(id);
    const s = statSync(p);
    return { mtime: s.mtimeMs, size: s.size };
  }

  async put(id: string, content: Buffer | Readable): Promise<Checksum> {
    const p = this.resolve(id);
    mkdirSync(dirname(p), { recursive: true });
    const buf = content instanceof Buffer ? content : await streamToBuffer(content);
    writeFileSync(p, buf);
    return createHash('sha256').update(buf).digest('hex');
  }

  async get(id: string): Promise<Readable> {
    return createReadStream(this.resolve(id));
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
