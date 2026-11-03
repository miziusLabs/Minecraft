import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliDirectory = path.resolve(scriptDirectory, '..');
const repositoryDirectory = path.resolve(cliDirectory, '..');

async function main() {
  const properties = await readFile(path.join(repositoryDirectory, 'project.properties'), 'utf8');
  const versionEntry = properties.split(/\r?\n/).find(line => /^\s*version\s*=/.test(line));
  const version = versionEntry?.slice(versionEntry.indexOf('=') + 1).trim();
  if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('project.properties must contain a valid semantic version in its version property.');
  }

  const packagePath = path.join(cliDirectory, 'package.json');
  const lockPath = path.join(cliDirectory, 'package-lock.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  if (pkg.name !== '@mizius/minecraft' || lock.name !== pkg.name || !lock.packages?.['']) {
    throw new Error('CLI package metadata is missing or has an unexpected package name.');
  }

  pkg.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  process.stdout.write(`Synced CLI package version to ${version}.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
