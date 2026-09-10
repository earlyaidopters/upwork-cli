import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { configureMember } from '../src/setup.mjs';

test('member setup validates before writing and preserves unrelated private settings', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'upwork-member-test-'));
  const keys = ['UPWORK_JOBS_HOME', 'UPWORK_JOBS_CONFIG', 'UPWORK_JOBS_PROFILE'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.UPWORK_JOBS_HOME = directory;
  delete process.env.UPWORK_JOBS_CONFIG;
  delete process.env.UPWORK_JOBS_PROFILE;
  try {
    for (const rate of ['no', '0', '-4', '', 'Infinity']) {
      await assert.rejects(configureMember({ country: 'Canada', rate }), /positive number/);
      assert.deepEqual(await fs.readdir(directory), []);
    }
    await configureMember({ country: 'USA', rate: '125.50' });
    const configPath = path.join(directory, 'config.json');
    const profilePath = path.join(directory, 'profile.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
    assert.equal(config.eligibility.freelancerCountry, 'United States');
    assert.equal(profile.defaultHourlyRate, 125.5);
    config.browser.port = 9333;
    profile.facts = ['User-provided evidence'];
    await fs.writeFile(configPath, JSON.stringify(config));
    await fs.writeFile(profilePath, JSON.stringify(profile));
    const profileBefore = await fs.readFile(profilePath, 'utf8');
    await configureMember({ country: 'Canada' });
    assert.equal(JSON.parse(await fs.readFile(configPath, 'utf8')).browser.port, 9333);
    assert.equal(await fs.readFile(profilePath, 'utf8'), profileBefore);
    await configureMember({ rate: '150' });
    assert.deepEqual(JSON.parse(await fs.readFile(profilePath, 'utf8')).facts, profile.facts);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});
