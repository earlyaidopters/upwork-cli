import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPullOutput } from '../src/delta.mjs';

const jobs = [{ uid: 'old' }, { uid: 'new' }];
const seen = new Set(['old']);

test('live pulls return only net-new jobs by default', () => {
  assert.deepEqual(selectPullOutput(jobs, seen).map((job) => job.uid), ['new']);
});

test('--all explicitly includes refreshed jobs', () => {
  assert.deepEqual(selectPullOutput(jobs, seen, { all: true }).map((job) => job.uid), ['old', 'new']);
});

test('--new-only remains a compatible override when combined with --all', () => {
  assert.deepEqual(selectPullOutput(jobs, seen, { all: true, newOnly: true }).map((job) => job.uid), ['new']);
});
