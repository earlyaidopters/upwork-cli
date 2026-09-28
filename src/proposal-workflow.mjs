import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { stateDirectory, writeAtomic } from './util.mjs';

export const WORKFLOW_STATES = new Set([
  'DRAFT',
  'REVIEWED',
  'FILLED',
  'READY',
  'BLOCKED',
  'MANUAL_CONTROL',
  'SUBMITTED',
]);

const ALLOWED_TRANSITIONS = {
  DRAFT: new Set(['DRAFT', 'REVIEWED', 'BLOCKED', 'MANUAL_CONTROL', 'SUBMITTED']),
  REVIEWED: new Set(['DRAFT', 'REVIEWED', 'FILLED', 'BLOCKED', 'MANUAL_CONTROL', 'SUBMITTED']),
  FILLED: new Set(['READY', 'REVIEWED', 'BLOCKED', 'MANUAL_CONTROL', 'SUBMITTED']),
  READY: new Set(['DRAFT', 'REVIEWED', 'BLOCKED', 'MANUAL_CONTROL', 'SUBMITTED']),
  BLOCKED: new Set(['DRAFT', 'REVIEWED', 'MANUAL_CONTROL', 'SUBMITTED']),
  MANUAL_CONTROL: new Set(['DRAFT', 'REVIEWED', 'BLOCKED', 'SUBMITTED']),
  SUBMITTED: new Set(['SUBMITTED']),
};

function now() {
  return new Date().toISOString();
}

function leaseFile(jobUid, { file = proposalWorkflowDatabasePath(), leaseDirectory = null } = {}) {
  return path.join(leaseDirectory || path.join(path.dirname(file), 'proposal-leases'), `${jobUid}.lock`);
}

export async function getProposalLease(jobUid, options = {}) {
  const file = leaseFile(jobUid, options);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { file, unreadable: true, error: error.message };
  }
}

async function acquireProposalLease(jobUid, command, options = {}) {
  const file = leaseFile(jobUid, options);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await fs.open(file, 'wx', 0o600);
    const lease = { jobUid: String(jobUid), command, pid: process.pid, acquiredAt: now(), file };
    await handle.writeFile(`${JSON.stringify(lease, null, 2)}\n`);
    return lease;
  } catch (error) {
    if (error.code === 'EEXIST') {
      const existing = await getProposalLease(jobUid, options);
      throw new Error(
        `Proposal browser lease is already held${existing?.command ? ` by ${existing.command}` : ''}. `
        + 'Run proposal status; do not start another live command. Use proposal resume only after confirming no attempt is running.',
      );
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function clearProposalLease(jobUid, options = {}) {
  await fs.unlink(leaseFile(jobUid, options)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export function proposalWorkflowDatabasePath() {
  return path.join(stateDirectory(), 'data', 'proposal-workflows.json');
}

async function readDatabase(file) {
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    return {
      version: 1,
      workflows: data?.workflows && typeof data.workflows === 'object' ? data.workflows : {},
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, workflows: {} };
    throw new Error(`Could not read proposal workflows: ${error.message}`);
  }
}

async function writeDatabase(database, file) {
  await writeAtomic(file, `${JSON.stringify(database, null, 2)}\n`);
}

function historyEntry(from, to, reason, details = {}) {
  return {
    at: now(),
    from: from || null,
    to,
    reason,
    ...details,
  };
}

function normalizeWorkflow(workflow) {
  if (!workflow) return null;
  return {
    ...workflow,
    history: Array.isArray(workflow.history) ? workflow.history : [],
  };
}

export async function loadProposalWorkflows({ file = proposalWorkflowDatabasePath() } = {}) {
  const database = await readDatabase(file);
  return Object.values(database.workflows).map(normalizeWorkflow);
}

export async function getProposalWorkflow(jobUid, { file = proposalWorkflowDatabasePath() } = {}) {
  const database = await readDatabase(file);
  return normalizeWorkflow(database.workflows[String(jobUid)] || null);
}

async function saveWorkflow(workflow, { file = proposalWorkflowDatabasePath() } = {}) {
  const database = await readDatabase(file);
  database.workflows[String(workflow.jobUid)] = workflow;
  await writeDatabase(database, file);
  return workflow;
}

export async function ensureProposalWorkflow({
  application,
  applicationSource,
  fingerprint,
  submittedRecord = null,
}, options = {}) {
  const jobUid = String(application?.job?.uid || '');
  if (!jobUid) throw new Error('Cannot create proposal workflow without application.job.uid');
  const existing = await getProposalWorkflow(jobUid, options);
  const timestamp = now();
  if (submittedRecord || String(application?.status || '').startsWith('submitted')) {
    const detectedSubmission = submittedRecord || application.submission || existing?.submission || null;
    if (
      existing?.state === 'SUBMITTED'
      && existing.fingerprint === fingerprint
      && String(existing.submission?.proposalId || '') === String(detectedSubmission?.proposalId || '')
    ) {
      return existing;
    }
    const workflow = {
      ...(existing || {}),
      jobUid,
      jobTitle: application.job?.title || existing?.jobTitle || null,
      applicationSource: applicationSource || existing?.applicationSource || null,
      fingerprint,
      state: 'SUBMITTED',
      owner: 'none',
      activeAttempt: null,
      reviewedFingerprint: existing?.reviewedFingerprint || null,
      updatedAt: timestamp,
      submission: detectedSubmission,
      history: existing?.state === 'SUBMITTED'
        ? (existing.history || [])
        : [...(existing?.history || []), historyEntry(existing?.state, 'SUBMITTED', 'submission-record-detected')].slice(-100),
    };
    return saveWorkflow(workflow, options);
  }

  if (!existing) {
    return saveWorkflow({
      jobUid,
      jobTitle: application.job?.title || null,
      applicationSource,
      fingerprint,
      reviewedFingerprint: null,
      state: 'DRAFT',
      owner: 'none',
      activeAttempt: null,
      lastCheckpoint: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      history: [historyEntry(null, 'DRAFT', 'application-tracked')],
    }, options);
  }

  if (existing.fingerprint === fingerprint) return existing;
  const preserveManualControl = existing.state === 'MANUAL_CONTROL';
  return saveWorkflow({
    ...existing,
    applicationSource: applicationSource || existing.applicationSource,
    fingerprint,
    reviewedFingerprint: null,
    state: preserveManualControl ? 'MANUAL_CONTROL' : 'DRAFT',
    resumeState: 'DRAFT',
    owner: preserveManualControl ? 'manual' : 'none',
    activeAttempt: null,
    lastCheckpoint: null,
    lastError: null,
    updatedAt: timestamp,
    history: [
      ...(existing.history || []),
      historyEntry(existing.state, preserveManualControl ? 'MANUAL_CONTROL' : 'DRAFT', 'application-fingerprint-changed'),
    ].slice(-100),
  }, options);
}

export async function transitionProposalWorkflow(jobUid, to, {
  reason,
  patch = {},
  history = {},
} = {}, options = {}) {
  if (!WORKFLOW_STATES.has(to)) throw new Error(`Unknown proposal workflow state: ${to}`);
  const existing = await getProposalWorkflow(jobUid, options);
  if (!existing) throw new Error(`No proposal workflow exists for job ${jobUid}`);
  if (!ALLOWED_TRANSITIONS[existing.state]?.has(to)) {
    throw new Error(`Invalid proposal workflow transition: ${existing.state} -> ${to}`);
  }
  const workflow = {
    ...existing,
    ...patch,
    state: to,
    updatedAt: now(),
    history: [
      ...(existing.history || []),
      historyEntry(existing.state, to, reason || 'state-transition', history),
    ].slice(-100),
  };
  return saveWorkflow(workflow, options);
}

export async function markProposalReviewed(workflow, fingerprint, options = {}) {
  if (workflow.state === 'SUBMITTED') throw new Error('Submitted proposals cannot be reviewed for another submission');
  if (workflow.activeAttempt || await getProposalLease(workflow.jobUid, options)) {
    throw new Error('A live proposal attempt owns the browser. Run proposal status; do not review or restart it concurrently.');
  }
  if (workflow.state === 'BLOCKED') throw new Error('Proposal workflow is BLOCKED. Run `upwork-cli proposal resume <application>` first.');
  if (workflow.state === 'MANUAL_CONTROL') throw new Error('Proposal workflow is under MANUAL_CONTROL. Run `upwork-cli proposal resume <application>` first.');
  return transitionProposalWorkflow(workflow.jobUid, 'REVIEWED', {
    reason: 'mandatory-review-rendered',
    patch: {
      fingerprint,
      reviewedFingerprint: fingerprint,
      owner: 'none',
      activeAttempt: null,
      lastError: null,
      lastCheckpoint: { type: 'review', fingerprint, at: now() },
    },
  }, options);
}

export async function beginProposalAttempt(workflow, command, expectedStates, options = {}) {
  await acquireProposalLease(workflow.jobUid, command, options);
  try {
    const latest = await getProposalWorkflow(workflow.jobUid, options);
    if (latest.activeAttempt) {
      throw new Error(`Proposal already has an active ${latest.activeAttempt.command} attempt. Run proposal status; do not retry.`);
    }
    if (!expectedStates.includes(latest.state)) {
      const next = latest.state === 'DRAFT'
        ? 'Run `upwork-cli proposal review <application>` first.'
        : latest.state === 'BLOCKED' || latest.state === 'MANUAL_CONTROL'
          ? 'Run `upwork-cli proposal resume <application>` before another live attempt.'
          : `Expected workflow state ${expectedStates.join(' or ')}, saw ${latest.state}.`;
      throw new Error(`Proposal ${command} is not allowed from ${latest.state}. ${next}`);
    }
    const attempt = {
      id: randomUUID(),
      command,
      pid: process.pid,
      startedAt: now(),
    };
    const updated = {
      ...latest,
      owner: 'cli',
      activeAttempt: attempt,
      updatedAt: now(),
    };
    await saveWorkflow(updated, options);
    return updated;
  } catch (error) {
    await clearProposalLease(workflow.jobUid, options);
    throw error;
  }
}

export async function assertProposalAttemptActive(workflow, options = {}) {
  const [latest, lease] = await Promise.all([
    getProposalWorkflow(workflow.jobUid, options),
    getProposalLease(workflow.jobUid, options),
  ]);
  const expectedId = workflow.activeAttempt?.id;
  if (!expectedId
    || latest?.owner !== 'cli'
    || latest?.activeAttempt?.id !== expectedId
    || lease?.pid !== process.pid
    || lease?.command !== workflow.activeAttempt?.command) {
    throw new Error(
      `Proposal browser ownership changed during ${workflow.activeAttempt?.command || 'the live attempt'}. `
      + `Current state is ${latest?.state || 'unknown'}; the CLI stopped before the next form action.`,
    );
  }
  return latest;
}

export async function markProposalReady(workflow, checkpoint, options = {}) {
  try {
    const filled = await transitionProposalWorkflow(workflow.jobUid, 'FILLED', {
      reason: 'form-filled-once',
      patch: { owner: 'cli', activeAttempt: workflow.activeAttempt },
    }, options);
    return await transitionProposalWorkflow(filled.jobUid, 'READY', {
      reason: 'all-live-fields-verified',
      patch: {
        owner: 'none',
        activeAttempt: null,
        lastError: null,
        lastCheckpoint: { type: 'ready', at: now(), ...checkpoint },
      },
    }, options);
  } finally {
    await clearProposalLease(workflow.jobUid, options);
  }
}

export function classifyProposalFailure(error) {
  const message = String(error?.message || error || 'Unknown proposal failure');
  if (/not signed in|run `upwork-cli auth`/i.test(message)) {
    return { category: 'authentication', requiredAction: 'Run `upwork-cli auth`, sign in, then run proposal resume once.' };
  }
  if (/verification page|captcha|cloudflare/i.test(message)) {
    return { category: 'browser-verification', requiredAction: 'Complete the visible browser verification manually, then run proposal resume once.' };
  }
  if (/duration/i.test(message)) {
    return { category: 'duration', requiredAction: 'Set a valid terms.duration, rerun proposal review, then make one new fill attempt.' };
  }
  if (/question.*changed|out of order|live form has/i.test(message)) {
    return { category: 'form-changed', requiredAction: 'Create a fresh proposal template from the live form and review it. Do not retry this application.' };
  }
  if (/Connects|boost|bid/i.test(message)) {
    return { category: 'connects', requiredAction: 'Inspect the saved Connects snapshot, update the application cap or boost deliberately, rerun review, then resume once.' };
  }
  if (/ready browser checkpoint|browser.*moved|browser ownership changed|different proposal page/i.test(message)) {
    return { category: 'browser-ownership', requiredAction: 'Do not rerun submit. Run proposal status, then resume and fill once to create a new browser checkpoint.' };
  }
  if (/verifiable submission success state/i.test(message)) {
    return { category: 'submission-uncertain', requiredAction: 'Inspect My Proposals manually. Do not rerun submit until the submission outcome is reconciled.' };
  }
  return { category: 'live-form', requiredAction: 'Inspect proposal status and its saved snapshot, correct the cause, then run proposal resume once.' };
}

export async function blockProposalWorkflow(workflow, error, snapshot = null, options = {}) {
  const failure = classifyProposalFailure(error);
  try {
    return await transitionProposalWorkflow(workflow.jobUid, 'BLOCKED', {
      reason: `attempt-failed:${workflow.activeAttempt?.command || 'unknown'}`,
      patch: {
        owner: 'none',
        activeAttempt: null,
        resumeState: workflow.reviewedFingerprint === workflow.fingerprint ? 'REVIEWED' : 'DRAFT',
        lastError: {
          at: now(),
          message: String(error?.message || error),
          ...failure,
          snapshot,
        },
      },
      history: { category: failure.category },
    }, options);
  } finally {
    await clearProposalLease(workflow.jobUid, options);
  }
}

export async function handoffProposalWorkflow(workflow, reason = 'user-took-browser-control', options = {}) {
  if (workflow.state === 'SUBMITTED') throw new Error('Submitted proposals are already terminal');
  const handedOff = await transitionProposalWorkflow(workflow.jobUid, 'MANUAL_CONTROL', {
    reason,
    patch: {
      owner: 'manual',
      activeAttempt: null,
      resumeState: workflow.reviewedFingerprint === workflow.fingerprint ? 'REVIEWED' : 'DRAFT',
    },
  }, options);
  await clearProposalLease(workflow.jobUid, options);
  return handedOff;
}

export async function resumeProposalWorkflow(workflow, fingerprint, options = {}) {
  if (!['BLOCKED', 'MANUAL_CONTROL'].includes(workflow.state) && !workflow.activeAttempt) {
    throw new Error(`Proposal resume is only valid from BLOCKED or MANUAL_CONTROL; saw ${workflow.state}`);
  }
  const target = workflow.reviewedFingerprint === fingerprint ? 'REVIEWED' : 'DRAFT';
  const resumed = await transitionProposalWorkflow(workflow.jobUid, target, {
    reason: 'explicit-resume',
    patch: {
      fingerprint,
      owner: 'none',
      activeAttempt: null,
      lastError: null,
      lastCheckpoint: target === 'REVIEWED' ? { type: 'review', fingerprint, at: now() } : null,
      resumeState: null,
    },
  }, options);
  await clearProposalLease(workflow.jobUid, options);
  return resumed;
}

export async function markProposalSubmitted(workflow, submission, options = {}) {
  try {
    return await transitionProposalWorkflow(workflow.jobUid, 'SUBMITTED', {
      reason: 'submission-verified',
      patch: {
        owner: 'none',
        activeAttempt: null,
        lastError: null,
        lastCheckpoint: { type: 'submitted', at: now(), proposalId: submission?.proposalId || null },
        submission,
      },
    }, options);
  } finally {
    await clearProposalLease(workflow.jobUid, options);
  }
}

export function proposalNextAction(workflow) {
  if (!workflow) return 'Create a proposal template.';
  if (workflow.state === 'DRAFT') return 'Complete the application and run proposal review.';
  if (workflow.state === 'REVIEWED') return 'Run proposal fill once.';
  if (workflow.state === 'READY') return 'Keep the browser on the filled form; submit only with exact approval and live Connects confirmation.';
  if (workflow.state === 'BLOCKED') return workflow.lastError?.requiredAction || 'Inspect the blocker, then run proposal resume once.';
  if (workflow.state === 'MANUAL_CONTROL') return 'Finish or cancel manual work, then run proposal resume once.';
  if (workflow.state === 'SUBMITTED') return 'No further proposal action is allowed.';
  return 'Run proposal status.';
}
