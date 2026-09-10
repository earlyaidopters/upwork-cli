import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.mjs';
import { filterJobs, rankJobs, scoreJob } from '../src/score.mjs';

const base = {
  uid: '1',
  description: '',
  skills: [],
  proposalsMax: null,
  paymentVerified: false,
  clientRating: null,
  clientSpend: null,
  hourlyMin: null,
  hourlyMax: null,
  fixedBudget: null,
  experienceLevel: '',
  featured: false,
  posted: '',
  ageHours: null,
};

test('ranks a strong AI training engagement above generic low-budget work', () => {
  const strong = {
    ...base,
    uid: 'strong',
    title: 'Claude and Copilot AI Trainer for Executive Workshop',
    skills: ['Artificial Intelligence', 'Prompt Engineering'],
    paymentVerified: true,
    clientSpend: 70_000,
    clientRating: 5,
    proposalsMax: 4,
    hourlyMin: 100,
    hourlyMax: 200,
    ageHours: 2,
    experienceLevel: 'Expert',
  };
  const weak = {
    ...base,
    uid: 'weak',
    title: 'Data Entry Assistant',
    fixedBudget: 100,
    proposalsMax: 999,
    ageHours: 100,
  };
  const ranked = rankJobs([weak, strong], DEFAULT_CONFIG);
  assert.equal(ranked[0].uid, 'strong');
  assert.ok(ranked[0].score > ranked[1].score);
  assert.ok(ranked[0].reasons.some((reason) => reason.includes('payment verified')));
});

test('score explanations contain positive and negative evidence', () => {
  const scored = scoreJob({
    ...base,
    title: 'AI Consultant for Claude Code Adoption',
    description: 'Unpaid trial followed by implementation work.',
    paymentVerified: true,
    hourlyMax: 150,
    posted: '2 hours ago',
  }, DEFAULT_CONFIG, 'ai consultant');
  assert.ok(scored.reasons.some((reason) => reason.includes('priority title')));
  assert.ok(scored.reasons.some((reason) => reason.includes('negative: unpaid trial')));
});

test('generic research roles do not outrank title-aligned training work on client stats alone', () => {
  const generic = scoreJob({
    ...base,
    title: 'Computer Vision Researcher for Video Benchmark',
    paymentVerified: true,
    clientSpend: 50_000,
    clientRating: 5,
    proposalsMax: 4,
  }, DEFAULT_CONFIG, 'ai trainer');
  const trainer = scoreJob({
    ...base,
    title: 'AI Trainer for Executive Workshop',
    paymentVerified: true,
    hourlyMax: 150,
  }, DEFAULT_CONFIG, 'ai trainer');
  assert.ok(trainer.score > generic.score);
  assert.ok(generic.reasons.some((reason) => reason.includes('weak title fit')));
});

test('distinguishes human AI enablement from model training', () => {
  const modelTraining = scoreJob({
    ...base,
    title: 'Computer Vision Pipeline and Model Training',
    description: 'Improve a machine learning model.',
    skills: ['Artificial Intelligence'],
    paymentVerified: true,
    proposalsMax: 4,
  }, DEFAULT_CONFIG, 'ai trainer');
  const humanTraining = scoreJob({
    ...base,
    title: 'Enterprise AI Trainer and Workshop Facilitator',
    description: 'Train leaders to use Claude and generative AI.',
    paymentVerified: true,
  }, DEFAULT_CONFIG, 'ai trainer');
  assert.ok(humanTraining.score > modelTraining.score);
  assert.ok(modelTraining.reasons.some((reason) => reason.includes('model/data training')));
});

test('penalizes and filters jobs with confirmed incompatible location restrictions', () => {
  const blocked = scoreJob({
    ...base,
    uid: 'blocked',
    title: 'Claude AI Trainer',
    eligibleForProfile: false,
    locationRestriction: 'Only freelancers located in the U.S. may apply.',
  }, DEFAULT_CONFIG, 'claude trainer');
  assert.ok(blocked.reasons.some((reason) => reason.includes('location blocked')));
  assert.deepEqual(filterJobs([blocked], { eligibleOnly: true }), []);
  assert.equal(filterJobs([blocked], { eligibleOnly: false }).length, 1);
});
