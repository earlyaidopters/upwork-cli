import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildApplicationTemplate } from '../src/application.mjs';
import { DEFAULT_PROFILE } from '../src/profile.mjs';

const cli = path.resolve(import.meta.dirname, '../src/cli.mjs');

test('member lifecycle works through the actual CLI with isolated state and no live browser', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upwork-cli-e2e-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const env = {...process.env, UPWORK_CLI_HOME:root};
  delete env.UPWORK_CLI_CONFIG;
  delete env.UPWORK_CLI_PROFILE;
  for (const key of Object.keys(env)) if (key.startsWith('UPWORK_JOBS_')) delete env[key];
  const run = (...args) => spawnSync(process.execPath, [cli,...args], {env, encoding:'utf8', timeout:10000});
  const ok = (...args) => { const result = run(...args); assert.equal(result.status, 0, result.stderr); return result.stdout; };
  assert.notEqual(run('hunt', '--pages', 'not-a-number').status, 0);
  assert.deepEqual(await fs.readdir(root), []);
  ok('setup', '--country', 'DE', '--rate', '120');
  const config = JSON.parse(await fs.readFile(path.join(root,'config.json'),'utf8'));
  assert.equal(config.eligibility.freelancerCountry, 'Germany');
  const readiness = JSON.parse(ok('doctor', '--offline'));
  assert.equal(readiness.readiness.countryConfigured, true);
  assert.equal(readiness.readiness.rateConfigured, true);
  assert.equal(readiness.browser.checked, false);
  const imported = path.join(root,'synthetic-jobs.json');
  await fs.writeFile(imported, JSON.stringify([{uid:'1111111111111111111', title:'Synthetic workshop', posted:'1 hour ago', score:40}]));
  ok('history','import',imported);
  assert.equal(JSON.parse(ok('history','stats')).jobs, 1);
  assert.equal(JSON.parse(ok('cache','--format','json'))[0].title,'Synthetic workshop');
  const application = buildApplicationTemplate({job:{uid:'1111111111111111111',title:'Synthetic test'},profile:DEFAULT_PROFILE,hourlyRate:120});
  application.terms.duration = 'Less than 1 month';
  application.terms.expectedConnects = 0;
  application.terms.maxConnects = 0;
  application.coverLetter = 'I built a CSV validation tool that flags missing invoice IDs and writes rejected rows to a separate file.';
  const file = path.join(root,'application.json');
  await fs.writeFile(file,JSON.stringify(application));
  ok('proposal','lint',file);
  assert.match(ok('proposal','review',file), /NOT APPROVED/);
  const status = JSON.parse(ok('proposal','status',file));
  assert.equal(status.workflow.state, 'REVIEWED');
  assert.notEqual(run('proposal','submit',file).status, 0);
  assert.equal(JSON.parse(ok('proposal','status',file)).workflow.state, 'REVIEWED');

  ok('setup', '--lanes', 'ai-automation,2');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'config.json'),'utf8')).lanes, ['ai-automation','ai-agents']);
  assert.match(ok('lanes'), /● 1\. ai-automation/);
  assert.notEqual(run('setup', '--lanes', 'not-a-lane').status, 0);
  assert.notEqual(run('hunt', 'not-a-lane').status, 0);

  const blockedFill = run('proposal','fill',file);
  assert.notEqual(blockedFill.status, 0);
  assert.match(blockedFill.stderr, /Live proposal filling and submission are off/);
  const blockedSubmit = run('proposal','submit',file,'--approval','x','--confirm','SUBMIT 0 CONNECTS');
  assert.match(blockedSubmit.stderr, /setup --enable-live-proposals/);
  assert.equal(JSON.parse(ok('proposal','status',file)).workflow.state, 'REVIEWED');

  ok('setup', '--enable-live-proposals');
  const enabled = JSON.parse(await fs.readFile(path.join(root,'config.json'),'utf8'));
  assert.equal(enabled.proposals.liveAutomation, true);
  assert.deepEqual(enabled.lanes, ['ai-automation','ai-agents']);
  assert.equal(JSON.parse(ok('doctor','--offline')).readiness.liveProposalAutomation, true);
  ok('setup', '--disable-live-proposals');
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'config.json'),'utf8')).proposals.liveAutomation, false);
});
