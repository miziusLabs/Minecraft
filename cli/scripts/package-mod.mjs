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
const manifestPath = path.join(cliDirectory, 'compatibility.json');
const versions = [
  '1.21.4', '1.21.5', '1.21.6', '1.21.7', '1.21.8', '1.21.9', '1.21.10', '1.21.11',
  '26.1', '26.1.1', '26.1.2', '26.2', '26.3',
];
const loaderVersion = '0.20.1';

function runGradle(initScript, archivePathFile, target) {
  const wrapper = path.join(modDirectory, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const gradleArguments = [
    '--no-daemon',
    '--rerun-tasks',
    '--no-build-cache',
    `-PcliArtifactPathFile=${archivePathFile}`,
    `-PcliJarTask=${target.jarTask}`,
    ...target.gradleProperties,
  ];
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', `call "${wrapper}" --init-script "${initScript}" ${gradleArguments.map(value => `"${value.replaceAll('"', '""')}"`).join(' ')} writeCliJarArchivePath`], {
      cwd: modDirectory,
      stdio: 'inherit',
      windowsHide: true,
      windowsVerbatimArguments: true,
    })
    : spawnSync('sh', [wrapper, '--init-script', initScript, ...gradleArguments, 'writeCliJarArchivePath'], {
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
      def jarTaskName = root.findProperty('cliJarTask') ?: 'jar'
  if (outputPath == null) throw new GradleException('Missing -PcliArtifactPathFile project property')
  root.tasks.register('writeCliJarArchivePath') {
    dependsOn root.tasks.named(jarTaskName.toString())
    doLast {
      def archive = root.tasks.named(jarTaskName.toString()).get().archiveFile.get().asFile.canonicalFile
      new File(outputPath.toString()).setText(archive.absolutePath, 'UTF-8')
    }
  }
}
`);
    await mkdir(artifactDirectory, { recursive: true });
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const targets = versions.map(version => ({
      versions: [version],
      file: `artifacts/minecraft-control-${version}.jar`,
      jarTask: version.startsWith('1.21.') ? 'remapJar' : 'jar',
      gradleProperties: [
        `-Pminecraft_version=${version}`,
        `-Pfabric_minecraft_versions=${version}`,
        `-Pfabric_loader_version=${loaderVersion}`,
        `-Pfabric_loader_minimum=${loaderVersion}`,
      ],
    }));
    const targetVersions = new Set(targets.flatMap(target => target.versions));
    const manifestVersions = Object.keys(manifest.versions ?? {});
    if (manifestVersions.length !== targetVersions.size
        || manifestVersions.some(version => !targetVersions.has(version))) {
      throw new Error('The compatibility manifest versions do not match the packaged Minecraft targets.');
    }

    for (const target of targets) {
      runGradle(initScript, archivePathFile, target);
      const archivePath = (await readFile(archivePathFile, 'utf8')).trim();
      if (!archivePath || !path.isAbsolute(archivePath) || path.extname(archivePath).toLowerCase() !== '.jar') {
        throw new Error(`Gradle did not return an absolute JAR archive path for Minecraft ${target.versions.join(', ')}.`);
      }
      const archive = path.resolve(archivePath);
      const relativeArchive = path.relative(repositoryDirectory, archive);
      if (relativeArchive === '..' || relativeArchive.startsWith(`..${path.sep}`) || path.isAbsolute(relativeArchive)) {
        throw new Error(`Gradle returned a JAR archive outside the repository for Minecraft ${target.versions.join(', ')}.`);
      }
      if (!(await stat(archive)).isFile()) throw new Error(`Gradle archive does not exist: ${archive}`);

      const destination = path.join(cliDirectory, target.file);
      await copyFile(archive, destination);
      const sha256 = createHash('sha256').update(await readFile(destination)).digest('hex');
      for (const version of target.versions) {
        manifest.versions[version].mod = { file: target.file, sha256 };
      }
      process.stdout.write(`Packaged ${path.basename(destination)} for Minecraft ${target.versions.join(', ')} with SHA-256 ${sha256}\n`);
    }

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
