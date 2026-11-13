import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm, stat } from 'node:fs/promises';
import { arch, platform, release } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import AdmZip from 'adm-zip';
import { x as extractTar } from 'tar';
import { atomicWrite, download, fetchJson, parallel, readJson, type Download } from './download.js';

interface Rule {
  action: 'allow' | 'disallow';
  os?: { name?: string; arch?: string; version?: string; versionRange?: { min?: string; max?: string } };
  features?: Record<string, boolean>;
}
type Argument = string | { rules?: Rule[]; value: string | string[] };
interface Artifact extends Download { path?: string }
interface Library {
  name: string;
  url?: string;
  sha1?: string;
  sha256?: string;
  size?: number;
  rules?: Rule[];
  downloads?: { artifact?: Artifact; classifiers?: Record<string, Artifact> };
  natives?: Record<string, string>;
  extract?: { exclude?: string[] };
}
interface Profile {
  id: string;
  mainClass: string;
  type: string;
  libraries: Library[];
  arguments: { jvm: Argument[]; game: Argument[] };
  downloads: { client: Download };
  assetIndex: Download & { id: string };
  javaVersion?: { majorVersion: number };
  logging?: { client?: { argument: string; file: Download & { id: string } } };
}

export interface Installation {
  java: string;
  instance: string;
  versionId: string;
  optionsDataVersion: number;
  launch(username: string, uuid: string, port?: number, background?: boolean): string[];
}

export function safePath(root: string, name: string): string {
  // Also reject Windows drive letters and backslash traversal on other hosts.
  if (name.includes(':') || name.includes('\0')) throw new Error(`Unsafe archive path ${name}`);
  const destination = resolve(root, name.replaceAll('\\', '/'));
  const part = relative(resolve(root), destination);
  if (part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part)) {
    throw new Error(`Unsafe archive path ${name}`);
  }
  return destination;
}

export async function extractZip(archive: string, destination: string, exclusions: string[] = []): Promise<void> {
  const zip = new AdmZip(archive);
  for (const entry of zip.getEntries()) {
    const path = safePath(destination, entry.entryName);
    // ZIP symlinks can otherwise turn a later entry into a write outside the destination.
    if (((entry.header.attr >>> 16) & 0xf000) === 0xa000) throw new Error(`Archive contains a symbolic link ${entry.entryName}`);
    if (exclusions.some(prefix => entry.entryName.startsWith(prefix))) continue;
    let ancestor = path;
    while (true) {
      try {
        if ((await lstat(ancestor)).isSymbolicLink()) throw new Error(`Archive destination contains a symbolic link ${ancestor}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    if (entry.isDirectory) await mkdir(path, { recursive: true });
    else await atomicWrite(path, entry.getData());
  }
}

function compareVersion(a: string, b: string): number {
  const aa = a.split('.').map(Number);
  const bb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const delta = (aa[i] ?? 0) - (bb[i] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

export function allowed(rules?: Rule[]): boolean {
  if (!rules) return true;
  let result = false;
  for (const rule of rules) {
    const os = rule.os;
    if (os?.name && os.name !== (platform() === 'win32' ? 'windows' : platform())) continue;
    if (os?.arch && !['x86_64', 'amd64', 'x64'].includes(os.arch)) continue;
    if (os?.version && !new RegExp(os.version).test(release())) continue;
    if (os?.versionRange?.min && compareVersion(release(), os.versionRange.min) < 0) continue;
    if (os?.versionRange?.max && compareVersion(release(), os.versionRange.max) > 0) continue;
    if (Object.entries(rule.features ?? {}).some(([, enabled]) => enabled)) continue;
    result = rule.action === 'allow';
  }
  return result;
}

export function argumentsFor(arguments_: Argument[], variables: Record<string, string>): string[] {
  return arguments_.flatMap(argument => typeof argument === 'string'
    ? [argument]
    : allowed(argument.rules) ? [argument.value].flat() : []).map(argument =>
    argument.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
      if (!(name in variables)) throw new Error(`Unsupported launch variable ${name}`);
      return variables[name]!;
    }));
}

export function mavenPath(coordinate: string): string {
  const [name, extension = 'jar'] = coordinate.split('@');
  const [group, artifact, version, classifier] = name!.split(':');
  if (!group || !artifact || !version) throw new Error(`Invalid Maven coordinate ${coordinate}`);
  return `${group.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ''}.${extension}`;
}

async function cachedMetadata<T>(path: string, fetchValue: () => Promise<T>): Promise<T> {
  try {
    const cached = await readJson<{ json: string; sha256: string }>(path);
    if (createHash('sha256').update(cached.json).digest('hex') === cached.sha256) {
      return JSON.parse(cached.json) as T;
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const value = await fetchValue();
  const json = JSON.stringify(value);
  await atomicWrite(path, JSON.stringify({ json, sha256: createHash('sha256').update(json).digest('hex') }));
  return value;
}

async function libraryArtifact(library: Library, root: string): Promise<Artifact> {
  if (library.downloads?.artifact) return library.downloads.artifact;
  const path = mavenPath(library.name);
  const url = new URL(path, library.url ?? 'https://libraries.minecraft.net/').href;
  let sha1 = library.sha1;
  if (!sha1 && !library.sha256) {
    sha1 = await cachedMetadata(safePath(join(root, 'checksums'), `${path}.json`), async () => {
      const response = await fetch(`${url}.sha1`, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Missing checksum for ${library.name}`);
      return (await response.text()).trim().split(/\s+/)[0]!;
    });
    if (!/^[0-9a-f]{40}$/i.test(sha1 ?? '')) throw new Error(`Invalid checksum for ${library.name}`);
  }
  return { path, url, ...(sha1 ? { sha1 } : {}),
    ...(library.sha256 ? { sha256: library.sha256 } : {}),
    ...(library.size !== undefined ? { size: library.size } : {}) };
}

/** Publish a complete runtime while retaining the old directory if publication fails. */
export async function publishRuntime(root: string, major: number, temporary: string): Promise<void> {
  if (!Number.isSafeInteger(major) || major < 8) throw new Error(`Invalid Java major version ${major}`);
  const runtimeRoot = safePath(resolve(root), 'runtime');
  const runtime = safePath(runtimeRoot, `java-${major}`);
  const source = resolve(temporary);
  if (dirname(source) !== runtimeRoot || !source.startsWith(`${runtime}.`) || !source.endsWith('.tmp')) {
    throw new Error('Runtime staging directory is outside the managed runtime directory');
  }
  const quarantine = safePath(runtimeRoot, `java-${major}.${randomUUID()}.old`);
  await mkdir(runtimeRoot, { recursive: true });
  if ((await lstat(runtimeRoot)).isSymbolicLink()) throw new Error(`Managed runtime directory is a symbolic link ${runtimeRoot}`);
  let replaced = false;
  try {
    const existing = await lstat(runtime);
    if (existing.isSymbolicLink()) throw new Error(`Managed runtime is a symbolic link ${runtime}`);
    await rename(runtime, quarantine);
    replaced = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    await rename(source, runtime);
  } catch (error) {
    if (replaced) {
      try { await rename(quarantine, runtime); } catch (restoreError) {
        throw new Error(`Runtime publication failed. Previous runtime remains at ${quarantine}`, {
          cause: new AggregateError([error, restoreError]),
        });
      }
    }
    throw error;
  }
  if (replaced) await rm(quarantine, { recursive: true, force: true });
}

export async function extractJavaTar(archive: string, destination: string): Promise<string | undefined> {
  let executable: string | undefined;
  let validationError: unknown;
  await extractTar({
    file: archive, cwd: destination, strict: true, preserveOwner: false,
    filter(name, entry) {
      if (validationError) return false;
      try {
        safePath(destination, name);
        if (!('type' in entry)) return false;
        if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
          if (!entry.linkpath) throw new Error('Java archive contains an empty link');
          safePath(destination, entry.type === 'Link' ? entry.linkpath : join(dirname(name), entry.linkpath));
        }
        if (/^[^/]+\/bin\/java$/.test(name) && entry.type === 'File') executable = name;
        return true;
      } catch (error) {
        // tar's streaming filter does not turn thrown errors into promise rejections.
        validationError = error;
        return false;
      }
    },
  });
  if (validationError) throw validationError;
  return executable;
}

async function installJava(root: string, major: number, progress: (message: string) => void): Promise<string> {
  if (!Number.isSafeInteger(major) || major < 8) throw new Error(`Invalid Java major version ${major}`);
  const runtime = join(root, 'runtime', `java-${major}`);
  const marker = join(runtime, 'installed.json');
  try {
    const installed = await readJson<{ executable: string }>(marker);
    if (!installed || typeof installed.executable !== 'string') throw new SyntaxError('Invalid Java installation marker');
    const java = safePath(runtime, platform() === 'win32' ? installed.executable.replace(/(^|[\\/])java\.exe$/i, '$1javaw.exe') : installed.executable);
    if ((await stat(java)).isFile()) return java;
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  progress(`Installing Java ${major}`);
  const assets = await fetchJson<Array<{ binary: { package: { link: string; checksum: string; size: number; name: string } } }>>(
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=x64&image_type=jre&os=${platform() === 'win32' ? 'windows' : 'linux'}&vendor=eclipse`);
  const asset = assets[0]?.binary.package;
  const windows = platform() === 'win32';
  const extension = windows ? '.zip' : '.tar.gz';
  if (!asset || !asset.name.endsWith(extension)) throw new Error(`No ${platform()} x64 Java ${major} runtime is available`);
  const archive = join(root, 'cache', `${asset.checksum}${extension}`);
  await download(archive, { url: asset.link, sha256: asset.checksum, size: asset.size });
  const temporary = `${runtime}.${randomUUID()}.tmp`;
  await mkdir(temporary, { recursive: true });
  try {
    let executable: string | undefined;
    if (windows) {
      await extractZip(archive, temporary);
      executable = new AdmZip(archive).getEntries().find(entry => /^[^/]+\/bin\/javaw\.exe$/.test(entry.entryName))?.entryName;
    } else {
      executable = await extractJavaTar(archive, temporary);
    }
    if (!executable) throw new Error('Java runtime archive does not contain a Java executable');
    await atomicWrite(join(temporary, 'installed.json'), JSON.stringify({ executable, checksum: asset.checksum }));
    await publishRuntime(root, major, temporary);
    return safePath(runtime, executable);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function install(root: string, version: string, compatibility: { loader: string; java: number }, progress: (message: string) => void): Promise<Installation> {
  if (!['win32', 'linux'].includes(platform()) || arch() !== 'x64') throw new Error('Managed Minecraft currently requires Windows or Linux x64');
  if (!/^[a-zA-Z0-9._+-]+$/.test(version) || !/^[a-zA-Z0-9._+-]+$/.test(compatibility.loader)) {
    throw new Error('Invalid Minecraft or Fabric version');
  }
  root = resolve(root);
  const instance = join(root, 'instances', version);
  await mkdir(join(instance, 'mods'), { recursive: true });
  progress(`Reading Minecraft ${version} and Fabric ${compatibility.loader} metadata`);
  const entry = await cachedMetadata(join(root, 'versions', version, 'source.json'), async () => {
    const manifest = await fetchJson<{ versions: Array<Download & { id: string }> }>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const entry = manifest.versions.find(candidate => candidate.id === version);
    if (!entry) throw new Error(`Minecraft ${version} is absent from Mojang's version manifest`);
    return entry;
  });
  const metadata = join(root, 'versions', version, `${version}.json`);
  await download(metadata, entry);
  const vanilla = await readJson<Profile>(metadata);
  const fabric = await cachedMetadata(join(root, 'versions', version, `fabric-${compatibility.loader}.json`), () =>
    fetchJson<Profile>(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}/${encodeURIComponent(compatibility.loader)}/profile/json`));
  const java = await installJava(root, Math.max(compatibility.java, vanilla.javaVersion?.majorVersion ?? 0), progress);
  const assets = join(root, 'assets');
  const libraries = join(root, 'libraries');
  const natives = join(instance, 'natives');
  await mkdir(natives, { recursive: true });
  const client = join(root, 'versions', version, `${version}.jar`);
  progress('Installing Minecraft client and libraries');
  await download(client, vanilla.downloads.client);
  const embeddedVersion = JSON.parse(new AdmZip(client).readAsText('version.json')) as { world_version?: number };
  const optionsDataVersion = embeddedVersion.world_version;
  if (!Number.isSafeInteger(optionsDataVersion) || optionsDataVersion! < 1446) {
    throw new Error('Minecraft client contains an invalid options data version');
  }
  // Child coordinates replace inherited versions of the same Maven artifact.
  const merged = new Map<string, Library>();
  for (const library of [...vanilla.libraries, ...fabric.libraries]) {
    const [group, name, , classifier] = library.name.split(':');
    merged.set(`${group}:${name}:${classifier ?? ''}`, library);
  }
  const activeLibraries = [...merged.values()].filter(library => allowed(library.rules));
  const classpath: string[] = new Array(activeLibraries.length).fill('');
  const nativeArchives: Array<{ path: string; exclude: string[] } | undefined> = new Array(activeLibraries.length);
  await parallel(activeLibraries.map((library, index) => ({ library, index })), async ({ library, index }) => {
    if (library.downloads?.artifact || !library.downloads) {
      const artifact = await libraryArtifact(library, root);
      const path = safePath(libraries, artifact.path ?? mavenPath(library.name));
      await download(path, artifact);
      classpath[index] = path;
    }
    const classifier = library.natives?.[platform() === 'win32' ? 'windows' : 'linux']?.replace('${arch}', '64');
    if (classifier) {
      const artifact = library.downloads?.classifiers?.[classifier];
      if (!artifact) throw new Error(`Missing native library ${library.name} ${classifier}`);
      const path = safePath(libraries, artifact.path ?? mavenPath(`${library.name}:${classifier}`));
      await download(path, artifact);
      nativeArchives[index] = { path, exclude: library.extract?.exclude ?? ['META-INF/'] };
    }
  });
  for (const archive of nativeArchives) if (archive) await extractZip(archive.path, natives, archive.exclude);
  classpath.push(client);
  progress('Installing Minecraft assets');
  const assetIndex = safePath(join(assets, 'indexes'), `${vanilla.assetIndex.id}.json`);
  await download(assetIndex, vanilla.assetIndex);
  const index = await readJson<{ objects: Record<string, { hash: string; size: number }> }>(assetIndex);
  const objects = [...new Map(Object.values(index.objects).map(object => [object.hash, object])).values()];
  let completed = 0;
  await parallel(objects, async object => {
    if (!/^[0-9a-f]{40}$/.test(object.hash)) throw new Error('Invalid Minecraft asset hash');
    const suffix = `${object.hash.slice(0, 2)}/${object.hash}`;
    await download(safePath(join(assets, 'objects'), suffix), { url: `https://resources.download.minecraft.net/${suffix}`, sha1: object.hash, size: object.size });
    completed++;
    if (completed % 250 === 0) progress(`Installed ${completed} of ${objects.length} assets`);
  });
  const logging = vanilla.logging?.client;
  let logArgument: string[] = [];
  if (logging) {
    const path = safePath(join(assets, 'log_configs'), logging.file.id);
    await download(path, logging.file);
    logArgument = [logging.argument.replace('${path}', path)];
  }
  const variables: Record<string, string> = {
    version_name: fabric.id, version_type: vanilla.type, game_directory: instance,
    assets_root: assets, assets_index_name: vanilla.assetIndex.id, natives_directory: natives,
    launcher_name: 'minecraft-cli', launcher_version: '1.0', classpath: classpath.filter(Boolean).join(platform() === 'win32' ? ';' : ':'),
    classpath_separator: platform() === 'win32' ? ';' : ':', library_directory: libraries, auth_access_token: '0',
    auth_xuid: '', clientid: '', user_type: 'legacy', user_properties: '{}',
  };
  return {
    java, instance, versionId: fabric.id, optionsDataVersion: optionsDataVersion!,
    launch(username, uuid, port = 8765, background = true) {
      const values = { ...variables, auth_player_name: username, auth_uuid: uuid };
      return ['-Xmx4G', `-Dminecraft.control.port=${port}`, `-Dminecraft.control.background=${background}`,
        ...argumentsFor(vanilla.arguments.jvm, values), ...argumentsFor(fabric.arguments?.jvm ?? [], values),
        ...logArgument, fabric.mainClass,
        ...argumentsFor(vanilla.arguments.game, values), ...argumentsFor(fabric.arguments?.game ?? [], values)];
    },
  };
}
