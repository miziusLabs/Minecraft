import path from 'node:path';
import os from 'node:os';

export function managedRoot(): string {
  const base = process.env.mizius_minecraft_home
    ?? (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'mizius', 'Minecraft') : path.join(os.homedir(), '.mizius', 'minecraft'));
  return path.resolve(base);
}
