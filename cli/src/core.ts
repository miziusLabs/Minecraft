import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import path from 'node:path';

export interface Compatibility { loader: string; java: number }
export interface Manifest {
  defaultVersion: string;
  versions: Record<string, Compatibility>;
  mod: { file: string; sha256: string };
}

export async function readManifest(packageRoot: string): Promise<Manifest> {
  const value = JSON.parse(await readFile(path.join(packageRoot, 'compatibility.json'), 'utf8')) as Manifest;
  if (!value.versions || !value.mod?.file || !value.mod.sha256 || !value.defaultVersion) {
    throw new Error('Incomplete package compatibility manifest. Build the release package first.');
  }
  return value;
}

export function resolveVersion(manifest: Manifest, requested?: string): { version: string; compatibility: Compatibility } {
  const version = requested ?? manifest.defaultVersion;
  if (!Object.hasOwn(manifest.versions, version)) {
    throw new Error(`No compatible bundled mod for Minecraft ${version}. Run minecraft versions.`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(version)) throw new Error('Invalid Minecraft version identifier.');
  return { version, compatibility: manifest.versions[version]! };
}

export function offlineUuid(username: string): string {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) throw new Error('Username must contain 3 to 16 letters, digits, or underscores.');
  const bytes = createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x30;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function defaultOptions(_version: string, dataVersion: number): string {
  if (!Number.isSafeInteger(dataVersion) || dataVersion < 1446) {
    throw new Error('A valid Minecraft options data version is required.');
  }
  // Minecraft stores FOV as (degrees - 70) / 40, rather than literal degrees.
  return [
    `version:${dataVersion}`,
    'fullscreen:false', 'overrideWidth:1280', 'overrideHeight:720', 'guiScale:2',
    'fov:0.5', 'key_key.sprint:key.keyboard.r', 'pauseOnLostFocus:false',
    'soundCategory_master:0.0', 'onboardAccessibility:false', 'tutorialStep:none',
    // Preset callbacks do not apply during startup, so write their individual settings.
    'graphicsPreset:"custom"', 'renderDistance:8', 'simulationDistance:5', 'renderClouds:false',
    'ao:false', 'biomeBlendRadius:1', 'entityShadows:false', 'entityDistanceScaling:0.75',
    'mipmapLevels:2', 'particles:1', 'cloudRange:32', 'cutoutLeaves:false',
    'improvedTransparency:false', 'weatherRadius:5', 'maxAnisotropyBit:1', 'textureFiltering:0',
    'prioritizeChunkUpdates:0', 'menuBackgroundBlurriness:2',
    'maxFps:60', 'enableVsync:false', 'joinedFirstServer:true', 'skipMultiplayerWarning:true',
  ].join('\n') + '\n';
}

export async function initializeOptions(instance: string, version: string, dataVersion: number): Promise<void> {
  await mkdir(instance, { recursive: true });
  try { await access(path.join(instance, 'options.txt')); return; } catch { /* First launch. */ }
  await writeFile(path.join(instance, 'options.txt'), defaultOptions(version, dataVersion), { flag: 'wx' });
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, file);
}
