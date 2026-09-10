import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertProposalAttemptActive,
  beginProposalAttempt,
  blockProposalWorkflow,
  ensureProposalWorkflow,
  getProposalLease,
  handoffProposalWorkflow,
  markProposalReady,
  markProposalReviewed,
  markProposalSubmitted,
  resumeProposalWorkflow,
} from '../src/proposal-workflow.mjs';

function application() {
  return {
    status: 'draft',
    job: { uid: '1111111111111111103', title: 'State-machine test job' },
  };
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'upwork-workflow-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { file: path.join(directory, 'proposal-workflows.json') };
}

test('moves through one reviewed fill checkpoint to a terminal submission', async (t) => {
  const options = await fixture(t);
  let workflow = await ensureProposalWorkflow({
    application: application(),
    applicationSource: '/tmp/application.json',
    fingerprint: 'AAAA',
  }, options);
  assert.equal(workflow.state, 'DRAFT');

  workflow = await markProposalReviewed(workflow, 'AAAA', options);
  assert.equal(workflow.state, 'REVIEWED');
  workflow = await beginProposalAttempt(workflow, 'fill', ['REVIEWED'], options);
  assert.equal(workflow.activeAttempt.command, 'fill');
  assert.equal((await getProposalLease(workflow.jobUid, options)).command, 'fill');
  workflow = await markProposalReady(workflow, {
    fingerprint: 'AAAA',
    baseConnects: 11,
    boostConnects: 25,
    totalConnects: 36,
  }, options);
  assert.equal(workflow.state, 'READY');
  assert.equal(workflow.lastCheckpoint.totalConnects, 36);
  assert.equal(await getProposalLease(workflow.jobUid, options), null);

  workflow = await beginProposalAttempt(workflow, 'submit', ['READY'], options);
  workflow = await markProposalSubmitted(workflow, { proposalId: '123' }, options);
  assert.equal(workflow.state, 'SUBMITTED');
  assert.equal(await getProposalLease(workflow.jobUid, options), null);
  await assert.rejects(
    beginProposalAttempt(workflow, 'fill', ['REVIEWED'], options),
    /not allowed from SUBMITTED/,
  );
});

test('content changes invalidate the reviewed checkpoint and return to draft', async (t) => {
  const options = await fixture(t);
  let workflow = await ensureProposalWorkflow({
    application: application(),
    applicationSource: '/tmp/application.json',
    fingerprint: 'AAAA',
  }, options);
  workflow = await markProposalReviewed(workflow, 'AAAA', options);
  workflow = await ensureProposalWorkflow({
    application: application(),
    applicationSource: '/tmp/application.json',
    fingerprint: 'BBBB',
  }, options);
  assert.equal(workflow.state, 'DRAFT');
  assert.equal(workflow.reviewedFingerprint, null);
  assert.equal(workflow.lastCheckpoint, null);
});

test('a failed attempt blocks retries until one explicit resume', async (t) => {
  const options = await fixture(t);
  let workflow = await ensureProposalWorkflow({
    application: application(),
    applicationSource: '/tmp/application.json',
    fingerprint: 'AAAA',
  }, options);
  workflow = await markProposalReviewed(workflow, 'AAAA', options);
  workflow = await beginProposalAttempt(workflow, 'fill', ['REVIEWED'], options);
  await assert.rejects(
    beginProposalAttempt(workflow, 'fill', ['REVIEWED'], options),
    /browser lease|active fill attempt/,
  );
  workflow = await blockProposalWorkflow(workflow, new Error('Duration verification failed'), {
    page: { url: 'https://www.upwork.com/nx/proposals/job/example/apply/' },
  }, options);
  assert.equal(workflow.state, 'BLOCKED');
  assert.equal(workflow.lastError.category, 'duration');
  await assert.rejects(
    beginProposalAttempt(workflow, 'fill', ['REVIEWED'], options),
    /proposal resume/,
  );
  workflow = await resumeProposalWorkflow(workflow, 'AAAA', options);
  assert.equal(workflow.state, 'REVIEWED');
});

test('manual handoff blocks CLI ownership and resumes to a reviewed state', async (t) => {
  const options = await fixture(t);
  let workflow = await ensureProposalWorkflow({
    application: application(),
    applicationSource: '/tmp/application.json',
    fingerprint: 'AAAA',
  }, options);
  workflow = await markProposalReviewed(workflow, 'AAAA', options);
  workflow = await handoffProposalWorkflow(workflow, 'test-handoff', options);
  assert.equal(workflow.state, 'MANUAL_CONTROL');
  assert.equal(workflow.owner, 'manual');
  await assert.rejects(
    beginProposalAttempt(workflow, 'fill', ['REVIEWED'], options),
    /proposal resume/,
  );
  workflow = await resumeProposalWorkflow(workflow, 'AAAA', options);
  assert.equal(workflow.state, 'REVIEWED');
  assert.equal(workflow.owner, 'none');
});

test('a manual handoff interrupts the next guarded action in an active attempt', async (t) => {
  const options = await fixture(t);
  let workflow = await ensureProposalWorkflow({
    application: application(),
    applicationSource: '/tmp/application.json',
    fingerprint: 'AAAA',
  }, options);
  workflow = await markProposalReviewed(workflow, 'AAAA', options);
  workflow = await beginProposalAttempt(workflow, 'fill', ['REVIEWED'], options);
  await assertProposalAttemptActive(workflow, options);
  const handedOff = await handoffProposalWorkflow(workflow, 'user-took-over', options);
  assert.equal(handedOff.state, 'MANUAL_CONTROL');
  await assert.rejects(
    assertProposalAttemptActive(workflow, options),
    /browser ownership changed/i,
  );
});

test('an existing successful proposal record forces the workflow terminal', async (t) => {
  const options = await fixture(t);
  const workflow = await ensureProposalWorkflow({
    application: application(),
    applicationSource: '/tmp/application.json',
    fingerprint: 'AAAA',
    submittedRecord: { proposalId: '123', success: true },
  }, options);
  assert.equal(workflow.state, 'SUBMITTED');
  assert.equal(workflow.submission.proposalId, '123');
});

test('rechecking an unchanged submitted workflow is read-only', async (t) => {
  const options = await fixture(t);
  const input = {
    application: application(),
    applicationSource: '/tmp/application.json',
    fingerprint: 'AAAA',
    submittedRecord: { proposalId: '123', success: true },
  };
  const first = await ensureProposalWorkflow(input, options);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await ensureProposalWorkflow(input, options);
  assert.equal(second.state, 'SUBMITTED');
  assert.equal(second.updatedAt, first.updatedAt);
  assert.deepEqual(second.history, first.history);
});
