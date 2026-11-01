import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface Download {
  url: string;
  sha1?: string;
  sha256?: string;
  size?: number;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status} for ${url}`);
  return await response.json() as T;
}

export async function atomicWrite(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function validFile(path: string, source: Download): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile() || (source.size !== undefined && source.size !== info.size)) return false;
    const expected = source.sha256 ?? source.sha1;
    if (!expected) return false;
    const hash = createHash(source.sha256 ? 'sha256' : 'sha1');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex') === expected.toLowerCase();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** A cache entry becomes visible only after the complete download passes verification. */
export async function download(path: string, source: Download): Promise<void> {
  if (!source.sha1 && !source.sha256) throw new Error(`Missing checksum for ${source.url}`);
  if (await validFile(path, source)) return;
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const response = await fetch(source.url, { signal: AbortSignal.timeout(300_000) });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${source.url}`);
      const hash = createHash(source.sha256 ? 'sha256' : 'sha1');
      let size = 0;
      const verify = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        size += chunk.length;
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body as never), verify, createWriteStream(temporary, { flags: 'wx' }));
      if (hash.digest('hex') !== (source.sha256 ?? source.sha1)!.toLowerCase()
          || (source.size !== undefined && size !== source.size)) {
        throw new Error(`Checksum or size mismatch for ${source.url}`);
      }
      await rename(temporary, path);
      return;
    } catch (error) {
      if (attempt === 2) throw new Error(`Could not download ${source.url}`, { cause: error });
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function parallel<T>(items: T[], action: (item: T) => Promise<void>, concurrency = 12): Promise<void> {
  let index = 0;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length && !failure) {
      const item = items[index++]!;
      try { await action(item); } catch (error) { failure = error; }
    }
  }));
  if (failure) throw failure;
}
