import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, readlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';

const exec = promisify(execFile);
export interface Identity { pid: number; started: string; executable: string; commandLine: string }
export interface RunningClient { identity: Identity; instance: string; version: string; log: string; port: number }

async function powershell(script: string): Promise<string> {
  const encoded = Buffer.from(`$ErrorActionPreference='Stop'; ${script}`, 'utf16le').toString('base64');
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

export async function identity(pid: number): Promise<Identity | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process identifier.');
  if (process.platform === 'linux') {
    try {
      const readStat = () => readFile(`/proc/${pid}/stat`, 'utf8');
      const before = await readStat();
      if (['Z', 'X'].includes(before.slice(before.lastIndexOf(')') + 2).split(' ')[0]!)) return null;
      const [executable, commandLine, boot] = await Promise.all([
        readlink(`/proc/${pid}/exe`), readFile(`/proc/${pid}/cmdline`, 'utf8'),
        readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      ]);
      const after = await readStat();
      const start = (stat: string) => stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
      if (start(before) !== start(after) || !commandLine) return null;
      return { pid, started: `${boot.trim()}:${start(after)}`, executable, commandLine };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        try {
          const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
          if (['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]!)) return null;
        } catch (statError) {
          if (['ENOENT', 'ESRCH'].includes((statError as NodeJS.ErrnoException).code ?? '')) return null;
        }
      }
      if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
      throw error;
    }
  }
  const json = await powershell(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if($p){ @{pid=[int]$p.ProcessId;started=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath;commandLine=$p.CommandLine} | ConvertTo-Json -Compress }`);
  return json ? JSON.parse(json) as Identity : null;
}

export function matchesProcess(actual: Identity | null, expected: Identity, instance: string): boolean {
  const escaped = instance.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const gameDirectory = new RegExp(`(?:^|\\s)--gameDir\\s+(?:"${escaped}"|${escaped}(?=\\s|$))`);
  const args = actual?.commandLine.split('\0') ?? [];
  const directoryMatches = process.platform === 'linux' && args.length > 1
    ? args.some((arg, index) => arg === '--gameDir' && args[index + 1] === instance)
    : gameDirectory.test(actual?.commandLine ?? '');
  return !!actual && actual.pid === expected.pid && actual.started === expected.started &&
    !!actual.executable && (process.platform === 'win32' ? actual.executable.toLowerCase() === expected.executable.toLowerCase() : actual.executable === expected.executable) &&
    !!actual.commandLine && actual.commandLine === expected.commandLine && directoryMatches;
}

export async function running(root: string): Promise<RunningClient | null> {
  let record: RunningClient & { url?: string };
  try { record = JSON.parse(await readFile(path.join(root, 'client.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const legacyPort = (() => {
    try {
      const url = new URL(record.url ?? '');
      const port = Number(url.port || 8765);
      return url.protocol === 'http:' && url.hostname === '127.0.0.1' && validControlPort(port) ? port : undefined;
    } catch { return undefined; }
  })();
  const port = validControlPort(record.port) ? record.port : legacyPort ?? 8765;
  const normalized = { ...record, port };
  return matchesProcess(await identity(record.identity.pid), record.identity, record.instance) ? normalized : null;
}

function validControlPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== 18765;
}

export async function stopClient(record: RunningClient): Promise<void> {
  if (process.platform === 'linux') {
    const signal = async (value: NodeJS.Signals) => {
      if (matchesProcess(await identity(record.identity.pid), record.identity, record.instance)) {
        try { process.kill(record.identity.pid, value); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      }
    };
    await signal('SIGTERM');
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!matchesProcess(await identity(record.identity.pid), record.identity, record.instance)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await signal('SIGKILL');
    return;
  }
  // Keep the PowerShell command short even when Minecraft has a long Java classpath.
  const data = Buffer.from(JSON.stringify({ identity: {
    pid: record.identity.pid, started: record.identity.started, executable: record.identity.executable,
    commandHash: createHash('sha256').update(record.identity.commandLine).digest('base64'),
  } }), 'utf8').toString('base64');
  // Verify and terminate within the same PowerShell invocation. Never kill a PID based only on a stale file.
  if (!matchesProcess(record.identity, record.identity, record.instance)) throw new Error('Invalid managed process record.');
  await powershell(`
    $r=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
    function Matches($p) {
      return ($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq $r.identity.started -and
        $p.ExecutablePath -eq $r.identity.executable -and
        [Convert]::ToBase64String([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($p.CommandLine))) -ceq $r.identity.commandHash)
    }
    $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$r.identity.pid)
    if(Matches $p) {
      $process=Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
      if($process -and $process.CloseMainWindow()) {
        try { $process.WaitForExit(10000) | Out-Null } catch {}
      }
      $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$r.identity.pid)
      if(Matches $p) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    }
  `);
}

export async function acquireLock(root: string): Promise<() => Promise<void>> {
  await mkdir(root, { recursive: true });
  // The OS releases this mutex on crashes. It also serializes different managed roots.
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once('error', () => reject(new Error('Another CLI operation is running, or mutex port 18765 is occupied.')));
    socket.listen({ host: '127.0.0.1', port: 18765, exclusive: true }, resolve);
  });
  return () => new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
}
