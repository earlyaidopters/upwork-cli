import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PROFILE, initializeProfile, loadProfile } from '../src/profile.mjs';
import { buildApplicationTemplate } from '../src/application.mjs';
import { buildProposalPacket, renderProposalPacket } from '../src/proposal.mjs';

test('fresh users receive no identity, rate, claims, or proof', () => {
  assert.equal(DEFAULT_PROFILE.name, '');
  assert.equal(DEFAULT_PROFILE.defaultHourlyRate, null);
  assert.deepEqual(DEFAULT_PROFILE.facts, []);
  assert.deepEqual(DEFAULT_PROFILE.proof, []);
  const job = { uid: '1111111111111111100', title: 'Test workshop' };
  const application = buildApplicationTemplate({ job, profile: DEFAULT_PROFILE });
  assert.equal(application.terms.hourlyRate, null);
  assert.deepEqual(application.evidence, []);
  const packet = renderProposalPacket(buildProposalPacket({ job, profile: DEFAULT_PROFILE }));
  assert.match(packet, /Bid: not configured/);
  assert.doesNotMatch(packet, /\$null|\$0\/hr/);
});

test('initialization preserves a user profile and partial profiles inherit no evidence', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'upwork-profile-test-'));
  const previous = process.env.UPWORK_CLI_PROFILE;
  process.env.UPWORK_CLI_PROFILE = path.join(directory, 'profile.json');
  try {
    assert.equal((await initializeProfile()).created, true);
    const custom = { name: 'Synthetic User', facts: ['A supplied fact'] };
    await fs.writeFile(process.env.UPWORK_CLI_PROFILE, JSON.stringify(custom));
    assert.equal((await initializeProfile()).created, false);
    assert.deepEqual(JSON.parse(await fs.readFile(process.env.UPWORK_CLI_PROFILE, 'utf8')), custom);
    const loaded = await loadProfile();
    assert.deepEqual(loaded.facts, custom.facts);
    assert.deepEqual(loaded.proof, []);
    assert.equal(loaded.defaultHourlyRate, null);
  } finally {
    if (previous === undefined) delete process.env.UPWORK_CLI_PROFILE;
    else process.env.UPWORK_CLI_PROFILE = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
