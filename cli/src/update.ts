import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const releaseApiUrl = 'https://api.github.com/repos/miziusLabs/Minecraft/releases/latest';
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

interface ReleaseAsset {
  name?: unknown;
  state?: unknown;
  browser_download_url?: unknown;
  digest?: unknown;
  size?: unknown;
}

interface LatestRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
}

interface PackageMetadata {
  name?: unknown;
  version?: unknown;
}

export interface UpdateResult {
  previousVersion: string;
  installedVersion: string;
  updated: boolean;
}

export interface NpmAdapter {
  globalRoot(): Promise<string>;
  install(tarball: string): Promise<void>;
}

export interface UpdateOptions {
  releaseApiUrl?: string;
  npmAdapter?: NpmAdapter;
  temporaryRoot?: string;
  progress?: (message: string) => void;
}

export interface AutomaticUpdateAttempt {
  result?: UpdateResult;
  error?: Error;
  fatal?: boolean;
}

class NotGlobalInstallationError extends Error {}

class RestoreFailedError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportProgress(options: UpdateOptions, message: string): void {
  try { options.progress?.(message); } catch { /* Reporting must not change update results. */ }
}

async function removeTemporary(directory: string): Promise<void> {
  try { await rm(directory, { recursive: true, force: true }); } catch { /* A cleanup failure must not hide the update result. */ }
}

function processErrorMessage(error: unknown): string {
  const detail = error as NodeJS.ErrnoException & { stderr?: string };
  return detail.stderr?.trim() || errorMessage(error);
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

async function runProcess(executable: string, args: string[], timeoutMs: number): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputSize = 0;
    let timedOut = false;
    let overflow = false;
    let killFinished: Promise<void> | undefined;
    const stopTree = () => {
      if (!child.pid) return Promise.resolve();
      if (process.platform !== 'win32') {
        child.kill('SIGTERM');
        return Promise.resolve();
      }
      return new Promise<void>(resolveKill => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.once('error', () => resolveKill());
        killer.once('close', () => resolveKill());
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killFinished = stopTree();
    }, timeoutMs);
    const append = (target: Buffer[], chunk: Buffer) => {
      outputSize += chunk.length;
      if (outputSize > 10 * 1024 * 1024 && !overflow) {
        overflow = true;
        killFinished = stopTree();
      }
      target.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => append(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => append(stderr, chunk));
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', async (code, signal) => {
      clearTimeout(timer);
      if (killFinished) await killFinished;
      const output = Buffer.concat(stdout).toString('utf8');
      if (timedOut) {
        reject(new Error(`${executable} did not finish within ${timeoutMs} milliseconds.`));
      } else if (overflow) {
        reject(new Error(`${executable} produced more than 10 MB of output.`));
      } else if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(detail || `${executable} exited with code ${code ?? signal ?? 'unknown'}.`));
      } else {
        resolve(output);
      }
    });
  });
}

async function runNpm(args: string[], timeoutMs: number): Promise<string> {
  try {
    if (process.platform !== 'win32') return (await runProcess('npm', args, timeoutMs)).trim();
    const encodedArgs = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$npmArguments = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + encodedArgs + "')) | ConvertFrom-Json",
      '$npmCommand = Get-Command npm.cmd -ErrorAction Stop',
      '& $npmCommand.Source @npmArguments',
      'exit $LASTEXITCODE',
    ].join('; ');
    return (await runProcess('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script),
    ], timeoutMs)).trim();
  } catch (error) {
    throw new Error(`npm ${args[0] ?? 'command'} failed. ${processErrorMessage(error)}`, { cause: error });
  }
}

export function createNpmAdapter(prefix?: string): NpmAdapter {
  const prefixArgs = prefix ? ['--prefix', path.resolve(prefix)] : [];
  return {
    async globalRoot() {
      const output = await runNpm(['root', '--global', ...prefixArgs], 15_000);
      if (!output) throw new Error('npm did not return its global package directory.');
      return path.resolve(output);
    },
    async install(tarball) {
      await runNpm([
        'install', '--global', '--ignore-scripts', '--no-audit', '--no-fund',
        ...prefixArgs, tarball,
      ], 300_000);
    },
  };
}

function stableParts(version: string): bigint[] | undefined {
  if (!stableVersionPattern.test(version)) return undefined;
  return version.split('.').map(BigInt);
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = stableParts(candidate);
  const currentParts = stableParts(current);
  if (!candidateParts || !currentParts) return false;
  for (let index = 0; index < candidateParts.length; index++) {
    if (candidateParts[index]! > currentParts[index]!) return true;
    if (candidateParts[index]! < currentParts[index]!) return false;
  }
  return false;
}

async function readPackageMetadata(packageRoot: string): Promise<PackageMetadata> {
  return JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as PackageMetadata;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left).replace(/[\\/]+$/, '');
  const normalizedRight = path.resolve(right).replace(/[\\/]+$/, '');
  return process.platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
    : normalizedLeft === normalizedRight;
}

async function resolveGlobalPackageRoot(packageRoot: string, npm: NpmAdapter): Promise<string | undefined> {
  const globalRoot = await npm.globalRoot();
  const globalPackage = path.join(globalRoot, '@mizius', 'minecraft');
  try {
    const [currentPath, globalPath] = await Promise.all([realpath(packageRoot), realpath(globalPackage)]);
    return samePath(currentPath, globalPath) ? globalPath : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function validReleaseTag(tag: unknown): tag is string {
  return typeof tag === 'string' && releaseTagPattern.test(tag);
}

function releaseAsset(release: LatestRelease, tag: string, apiUrl: string): {
  url: string;
  sha256: string;
  size: number;
} {
  if (release.draft === true || release.prerelease === true) throw new Error('GitHub returned a draft or prerelease as the latest release.');
  if (!Array.isArray(release.assets)) throw new Error('GitHub release metadata has no asset list.');
  const asset = release.assets.find((item: ReleaseAsset) => item?.name === 'minecraft.tgz') as ReleaseAsset | undefined;
  if (!asset || asset.state !== 'uploaded') throw new Error('The latest GitHub release has no uploaded minecraft.tgz asset.');
  if (typeof asset.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest)) {
    throw new Error('The latest GitHub release does not provide a valid SHA-256 asset digest.');
  }
  if (!Number.isSafeInteger(asset.size) || (asset.size as number) <= 0 || (asset.size as number) > 100_000_000) {
    throw new Error('The latest GitHub release asset has an invalid size.');
  }
  if (typeof asset.browser_download_url !== 'string') throw new Error('The latest GitHub release asset has no download URL.');

  const downloadUrl = new URL(asset.browser_download_url);
  const apiHost = new URL(apiUrl).hostname;
  const apiIsSecure = new URL(apiUrl).protocol === 'https:';
  const allowedHost = downloadUrl.hostname === 'github.com' || (!apiIsSecure && downloadUrl.hostname === apiHost);
  const expectedPath = `/miziusLabs/Minecraft/releases/download/${tag}/minecraft.tgz`;
  if (downloadUrl.protocol !== (apiIsSecure ? 'https:' : 'http:') || !allowedHost
      || downloadUrl.pathname.toLowerCase() !== expectedPath.toLowerCase()) {
    throw new Error('The latest GitHub release asset has an unexpected download URL.');
  }

  return {
    url: downloadUrl.href,
    sha256: asset.digest.slice('sha256:'.length).toLowerCase(),
    size: asset.size as number,
  };
}

async function latestRelease(apiUrl: string): Promise<LatestRelease | undefined> {
  const response = await fetch(apiUrl, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mizius-minecraft-cli' },
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GitHub release lookup returned HTTP ${response.status}.`);
  const release = await response.json() as LatestRelease;
  if (!release || typeof release !== 'object' || !validReleaseTag(release.tag_name)) {
    throw new Error('GitHub returned an invalid stable release tag.');
  }
  return release;
}

async function downloadAsset(asset: { url: string; sha256: string; size: number }, target: string): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`Release asset download returned HTTP ${response.status}.`);
    const hash = createHash('sha256');
    let size = 0;
    const verify = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > asset.size) {
        callback(new Error('Release asset exceeded the declared size.'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as never), verify, createWriteStream(temporary, { flags: 'wx' }));
    if (size !== asset.size || hash.digest('hex') !== asset.sha256) {
      throw new Error('Release asset size or SHA-256 digest did not match GitHub metadata.');
    }
    await rename(temporary, target);
  } finally {
    try { await rm(temporary, { force: true }); } catch { /* Keep the download error or result as the primary outcome. */ }
  }
}

async function readTarballMetadata(tarball: string): Promise<PackageMetadata> {
  try {
    const { stdout } = await execFileAsync('tar', ['-xOf', tarball, 'package/package.json'], {
      encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024,
    });
    return JSON.parse(stdout) as PackageMetadata;
  } catch (error) {
    throw new Error(`Could not read package metadata from minecraft.tgz. ${processErrorMessage(error)}`, { cause: error });
  }
}

async function restorePackage(target: string, backup: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(backup, target, { recursive: true, errorOnExist: true, force: false });
}

export async function updateCli(packageRoot: string, options: UpdateOptions = {}): Promise<UpdateResult> {
  const npm = options.npmAdapter ?? createNpmAdapter();
  const globalPackageRoot = await resolveGlobalPackageRoot(packageRoot, npm);
  if (!globalPackageRoot) {
    throw new NotGlobalInstallationError('Self-update requires the documented global npm installation. Install minecraft.tgz with npm install --global.');
  }

  const localMetadata = await readPackageMetadata(packageRoot);
  if (localMetadata.name !== '@mizius/minecraft' || typeof localMetadata.version !== 'string'
      || !stableParts(localMetadata.version)) {
    throw new Error('The installed CLI package has invalid name or version metadata.');
  }
  const previousVersion = localMetadata.version;

  const apiUrl = options.releaseApiUrl ?? releaseApiUrl;
  const release = await latestRelease(apiUrl);
  if (!release) return { previousVersion, installedVersion: previousVersion, updated: false };
  const latestVersion = (release.tag_name as string).slice(1);
  if (!isNewerVersion(latestVersion, previousVersion)) {
    return { previousVersion, installedVersion: previousVersion, updated: false };
  }

  const asset = releaseAsset(release, release.tag_name as string, apiUrl);
  const temporaryRoot = await mkdtemp(path.join(options.temporaryRoot ?? os.tmpdir(), 'mizius-minecraft-update-'));
  const tarball = path.join(temporaryRoot, 'minecraft.tgz');
  try {
    reportProgress(options, `Downloading Minecraft CLI v${latestVersion}.`);
    await downloadAsset(asset, tarball);
    const tarballMetadata = await readTarballMetadata(tarball);
    if (tarballMetadata.name !== '@mizius/minecraft' || tarballMetadata.version !== latestVersion) {
      throw new Error('The downloaded release package name or version does not match its GitHub release.');
    }

    const backupRoot = await mkdtemp(path.join(options.temporaryRoot ?? os.tmpdir(), 'mizius-minecraft-backup-'));
    const backupPackage = path.join(backupRoot, 'package');
    let keepBackup = false;
    try {
      await cp(globalPackageRoot, backupPackage, { recursive: true, errorOnExist: true, force: false });
      try {
        reportProgress(options, `Installing Minecraft CLI v${latestVersion}.`);
        await npm.install(tarball);
        const installedMetadata = await readPackageMetadata(globalPackageRoot);
        if (installedMetadata.name !== '@mizius/minecraft' || installedMetadata.version !== latestVersion) {
          throw new Error('npm installed a package with unexpected name or version metadata.');
        }
      } catch (error) {
        try {
          await restorePackage(globalPackageRoot, backupPackage);
        } catch (restoreError) {
          keepBackup = true;
          throw new RestoreFailedError(`The update failed and the previous package could not be restored. Recovery copy: ${backupPackage}. ${errorMessage(restoreError)}`, { cause: error });
        }
        throw new Error(`Could not install the update. The previous CLI version was restored. ${errorMessage(error)}`, { cause: error });
      }
      reportProgress(options, `Installed Minecraft CLI v${latestVersion}.`);
      return { previousVersion, installedVersion: latestVersion, updated: true };
    } finally {
      if (!keepBackup) await removeTemporary(backupRoot);
    }
  } finally {
    await removeTemporary(temporaryRoot);
  }
}

export async function attemptAutomaticUpdate(packageRoot: string, options: UpdateOptions = {}): Promise<AutomaticUpdateAttempt> {
  try {
    return { result: await updateCli(packageRoot, options) };
  } catch (error) {
    if (error instanceof NotGlobalInstallationError) return {};
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      fatal: error instanceof RestoreFailedError,
    };
  }
}

export async function relaunchCli(entrypoint: string, nodeArgs: string[], cliArgs: string[]): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [...nodeArgs, entrypoint, ...cliArgs], {
      stdio: 'inherit',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('close', code => resolve(code ?? 1));
  });
}
