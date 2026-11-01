import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliDirectory = path.resolve(scriptDirectory, '..');
const repositoryDirectory = path.resolve(cliDirectory, '..');
const modDirectory = path.join(repositoryDirectory, 'mod');
const artifactDirectory = path.join(cliDirectory, 'artifacts');
const destination = path.join(artifactDirectory, 'minecraft-control.jar');
const manifestPath = path.join(cliDirectory, 'compatibility.json');

function runGradle(initScript, archivePathFile) {
  const wrapper = path.join(modDirectory, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', `call "${wrapper}" --init-script "${initScript}" "-PcliArtifactPathFile=${archivePathFile}" writeCliJarArchivePath`], {
      cwd: modDirectory,
      stdio: 'inherit',
      windowsHide: true,
      windowsVerbatimArguments: true,
    })
    : spawnSync('sh', [wrapper, '--init-script', initScript, `-PcliArtifactPathFile=${archivePathFile}`, 'writeCliJarArchivePath'], {
      cwd: modDirectory,
      stdio: 'inherit',
    });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Gradle build failed with exit code ${result.status ?? 'unknown'}.`);
}

async function main() {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'mizius-package-'));
  try {
    const initScript = path.join(temporaryDirectory, 'package-mod.init.gradle');
    const archivePathFile = path.join(temporaryDirectory, 'jar-archive-path.txt');
    await writeFile(initScript, `gradle.projectsEvaluated {
  def root = gradle.rootProject
  def outputPath = root.findProperty('cliArtifactPathFile')
  if (outputPath == null) throw new GradleException('Missing -PcliArtifactPathFile project property')
  root.tasks.register('writeCliJarArchivePath') {
    dependsOn root.tasks.named('build')
    doLast {
      def archive = root.tasks.named('jar').get().archiveFile.get().asFile.canonicalFile
      new File(outputPath.toString()).setText(archive.absolutePath, 'UTF-8')
    }
  }
}
`);
    runGradle(initScript, archivePathFile);

    const archivePath = (await readFile(archivePathFile, 'utf8')).trim();
    if (!archivePath || !path.isAbsolute(archivePath) || path.extname(archivePath).toLowerCase() !== '.jar') {
      throw new Error('Gradle did not return an absolute JAR archive path.');
    }
    const archive = path.resolve(archivePath);
    const relativeArchive = path.relative(repositoryDirectory, archive);
    if (relativeArchive === '..' || relativeArchive.startsWith(`..${path.sep}`) || path.isAbsolute(relativeArchive)) {
      throw new Error('Gradle returned a JAR archive outside the repository.');
    }
    if (!(await stat(archive)).isFile()) throw new Error(`Gradle archive does not exist: ${archive}`);

    await mkdir(artifactDirectory, { recursive: true });
    await copyFile(archive, destination);

    const jar = await readFile(destination);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!manifest.mod || manifest.mod.file !== 'artifacts/minecraft-control.jar') {
      throw new Error('The compatibility manifest must point to artifacts/minecraft-control.jar.');
    }
    manifest.mod.sha256 = createHash('sha256').update(jar).digest('hex');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    process.stdout.write(`Packaged ${path.basename(destination)} with SHA-256 ${manifest.mod.sha256}\n`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
