import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  databasePath,
  databaseStats,
  findJob,
  legacyDatabasePath,
  loadJobs,
  loadJobsByIds,
  loadRuns,
  loadTrends,
  previouslySeenIds,
  recordPull,
} from '../src/store.mjs';

function job(uid, title, extras = {}) {
  return {
    uid,
    title,
    url: `https://www.upwork.com/jobs/~02${uid}`,
    posted: '1 hour ago',
    ageHours: 1,
    proposals: 'Fewer than 5',
    proposalsMax: 4,
    paymentVerified: true,
    clientSpend: 10_000,
    score: 50,
    source: 'search',
    query: 'claude code',
    scrapedAt: new Date().toISOString(),
    ...extras,
  };
}

test('migrates the legacy JSON cache into SQLite without deleting it', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upwork-store-migrate-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  process.env.UPWORK_CLI_HOME = root;
  await fs.mkdir(path.dirname(legacyDatabasePath()), { recursive: true });
  await fs.writeFile(legacyDatabasePath(), JSON.stringify({
    version: 1,
    jobs: [job('100', 'Legacy Claude Trainer', {
      firstSeen: '2026-08-01T00:00:00.000Z',
      lastSeen: '2026-08-02T00:00:00.000Z',
    })],
  }));

  const jobs = await loadJobs();
  assert.equal(databasePath().endsWith('jobs.sqlite'), true);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Legacy Claude Trainer');
  assert.equal(jobs[0].firstSeen, '2026-08-01T00:00:00.000Z');
  assert.equal((await fs.stat(legacyDatabasePath())).isFile(), true);
});

test('records canonical jobs, per-query sightings, runs, and net-new deltas', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upwork-store-runs-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  process.env.UPWORK_CLI_HOME = root;

  const first = await recordPull([job('1', 'Claude Code Trainer'), job('2', 'AI Adoption Partner')], {
    command: 'hunt ai-trainers',
    queries: ['claude code', 'ai adoption'],
    observations: [
      job('1', 'Claude Code Trainer', { query: 'claude code' }),
      job('1', 'Claude Code Trainer', { query: 'ai trainer' }),
      job('2', 'AI Adoption Partner', { query: 'ai adoption' }),
    ],
  });
  assert.deepEqual({ added: first.added, updated: first.updated, total: first.total }, {
    added: 2,
    updated: 0,
    total: 2,
  });

  const second = await recordPull([
    job('1', 'Claude Code Trainer', { proposals: '20 to 50', proposalsMax: 50 }),
    job('3', 'MCP Workflow Consultant'),
  ], { command: 'search mcp', queries: ['mcp'] });
  assert.deepEqual({ added: second.added, updated: second.updated, total: second.total }, {
    added: 1,
    updated: 1,
    total: 3,
  });

  const stats = await databaseStats();
  assert.equal(stats.jobs, 3);
  assert.equal(stats.runs, 2);
  assert.equal(stats.sightings, 5);
  assert.equal((await previouslySeenIds()).has('3'), true);
  assert.equal((await findJob('1')).proposalsMax, 50);
  assert.equal((await loadRuns())[0].jobsNew, 1);
  assert.equal((await loadTrends(30)).reduce((sum, row) => sum + Number(row.newJobs), 0), 3);
});

test('persists inspected location eligibility across search-card refreshes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upwork-store-eligibility-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  process.env.UPWORK_CLI_HOME = root;

  await recordPull([job('restricted', 'U.S.-Only Claude Consultant', {
    locationScope: 'restricted',
    locationRestriction: 'Only freelancers located in the U.S. may apply.',
    eligibleForProfile: false,
    detailInspectedAt: '2026-08-21T14:00:00.000Z',
  })], { command: 'first detail inspection' });

  await recordPull([job('restricted', 'U.S.-Only Claude Consultant', {
    locationScope: 'unknown',
    eligibleForProfile: null,
    detailInspectedAt: null,
  })], { command: 'later search-card refresh' });

  const stored = await findJob('restricted');
  assert.equal(stored.locationScope, 'restricted');
  assert.equal(stored.eligibleForProfile, false);
  assert.equal(stored.detailInspectedAt, '2026-08-21T14:00:00.000Z');
  const stats = await databaseStats();
  assert.equal(stats.locationInspected, 1);
  assert.equal(stats.locationIneligible, 1);
});

test('canonicalizes stored job URLs independently of malformed search slugs', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upwork-store-url-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  process.env.UPWORK_CLI_HOME = root;

  await recordPull([job('1111111111111111104', 'AI Agent Developer – Claude / Microsoft Copilot', {
    url: 'https://www.upwork.com/jobs/span-class-highlight-span-Agent_~021111111111111111104/',
  })], { command: 'canonical URL test' });

  const stored = await findJob('1111111111111111104');
  assert.equal(
    stored.url,
    'https://www.upwork.com/jobs/~021111111111111111104/',
  );
});


test('indexed cache reads return only requested jobs across batches', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upwork-store-indexed-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  process.env.UPWORK_CLI_HOME = root;
  await recordPull(Array.from({length: 600}, (_, i) => job(String(i), `Synthetic ${i}`)));
  const requested = Array.from({length: 550}, (_, i) => String(i));
  const selected = await loadJobsByIds([...requested, '1', 'missing']);
  assert.equal(selected.length, 550);
  assert.deepEqual(new Set(selected.map(row => row.uid)), new Set(requested));
  assert.deepEqual(await loadJobsByIds([]), []);
});

test('fresh unknown eligibility clears an older confirmed result', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upwork-store-fresh-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  process.env.UPWORK_CLI_HOME = root;
  await recordPull([job('1', 'Example', {locationScope:'restricted', allowedLocations:['Canada'], eligibleForProfile:true, detailInspectedAt:'2026-09-10T01:00:00Z'})]);
  await recordPull([job('1', 'Example', {locationScope:'unknown', allowedLocations:[], locationRestriction:null, eligibleForProfile:null, detailInspectedAt:'2026-09-10T02:00:00Z'})]);
  const stored = await findJob('1');
  assert.equal(stored.eligibleForProfile, null);
  assert.equal(stored.locationScope, 'unknown');
  assert.deepEqual(stored.allowedLocations, []);
});

test('search refresh preserves structured locations for country re-evaluation', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upwork-store-locations-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  process.env.UPWORK_CLI_HOME = root;
  await recordPull([job('1', 'Example', {locationScope:'restricted', allowedLocations:['Canada'], eligibleForProfile:true, detailInspectedAt:'2026-09-10T01:00:00Z'})]);
  await recordPull([job('1', 'Example')]);
  assert.deepEqual((await findJob('1')).allowedLocations, ['Canada']);
});


test('job lookup never selects a different job through a partial ID or SQL wildcard', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upwork-store-exact-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  process.env.UPWORK_CLI_HOME = root;
  await recordPull([job('100', 'Synthetic A'), job('1000', 'Synthetic B')]);
  assert.equal(await findJob('10'), null);
  assert.equal(await findJob('%'), null);
  assert.equal((await findJob('https://www.upwork.com/jobs/~02100/')).uid, '100');
});
