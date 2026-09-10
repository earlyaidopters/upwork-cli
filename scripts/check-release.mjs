import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, encoding: 'utf8', ...options });
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'upwork-release-'));
try {
  const [packed] = JSON.parse(run(npm, ['pack', '--json', '--pack-destination', temporary]));
  const allowed = /^(?:src\/[^/]+\.mjs|docs\/[^/]+\.md|README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|CONTRIBUTING\.md|(?:package|config\.example|profile\.example)\.json)$/;
  for (const file of packed.files) {
    if (!allowed.test(file.path)) throw new Error(`Unexpected package file: ${file.path}`);
    const content = await fs.readFile(path.join(root, file.path), 'utf8');
    // Catch private machine paths, contact details, and common credential encodings.
    const privatePattern = /\/Users\/[^/\s]+|\/home\/[^/\s]+|-----BEGIN .*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{24,}|[A-Z0-9._%+-]+@(?!example\.)[A-Z0-9.-]+\.[A-Z]{2,}/i;
    if (privatePattern.test(content)) throw new Error(`Possible private content in ${file.path}; inspect locally.`);
  }
  for (const file of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/proposal-writing.md']) {
    if (!packed.files.some(entry => entry.path === file)) throw new Error(`Missing release file: ${file}`);
  }
  for (const file of packed.files.filter(entry => entry.path.endsWith('.md'))) {
    const content = await fs.readFile(path.join(root, file.path), 'utf8');
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      await fs.access(path.resolve(root, path.dirname(file.path), target));
    }
  }
  const install = path.join(temporary, 'install');
  await fs.mkdir(install);
  run(npm, ['install', '--ignore-scripts', '--prefix', install, path.join(temporary, packed.filename)]);
  const cli = path.join(install, 'node_modules/upwork-job-cli/src/cli.mjs');
  const env = { ...process.env, UPWORK_JOBS_HOME: path.join(temporary, 'state') };
  delete env.UPWORK_JOBS_CONFIG;
  delete env.UPWORK_JOBS_PROFILE;
  const execute = args => run(process.execPath, [cli, ...args], { env });
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest.private !== true) throw new Error('npm publication must remain disabled by default');
  if (execute(['--version']).trim() !== manifest.version) throw new Error('CLI/package version mismatch');
  execute(['init']);
  const profile = JSON.parse(await fs.readFile(path.join(env.UPWORK_JOBS_HOME, 'profile.json'), 'utf8'));
  if (profile.name || profile.defaultHourlyRate !== null || profile.facts.length || profile.proof.length) throw new Error('Fresh profile contains inherited personal data');
  execute(['setup', '--country', 'Canada', '--rate', '100']);
  const configured = JSON.parse(await fs.readFile(path.join(env.UPWORK_JOBS_HOME, 'profile.json'), 'utf8'));
  if (configured.defaultHourlyRate !== 100 || configured.facts.length) throw new Error('Installed setup failed');
  const stats = JSON.parse(execute(['history', 'stats']));
  if (stats.jobs !== 0 || stats.runs !== 0) throw new Error('Fresh install inherited job history');
  await fs.access(execute(['proposal', 'playbook']).trim());
  console.log(`Release checks passed: ${packed.files.length} allowed files, documentation links, clean installation, empty private profile and database.`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
