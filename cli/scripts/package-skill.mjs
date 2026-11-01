import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const cliDirectory = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(cliDirectory, '..', 'skills', 'minecraft', 'SKILL.md');
const destination = path.join(cliDirectory, 'skills', 'minecraft');

await mkdir(destination, { recursive: true });
await copyFile(source, path.join(destination, 'SKILL.md'));
