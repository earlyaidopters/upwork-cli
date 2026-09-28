import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, validateConfig } from '../src/config.mjs';
import { BUILT_IN_LANES, lanePresets, matchesTerm, parseLaneSelection, resolveLanes } from '../src/lanes.mjs';
import { rankJobs, scoreJob } from '../src/score.mjs';
import { assessOpportunity } from '../src/proposal.mjs';
import { envSetting } from '../src/util.mjs';

const base = {
  uid: '1',
  description: '',
  skills: [],
  proposalsMax: null,
  paymentVerified: true,
  clientRating: null,
  clientSpend: null,
  hourlyMin: null,
  hourlyMax: 90,
  fixedBudget: null,
  experienceLevel: '',
  featured: false,
  posted: '',
  ageHours: null,
};

const withLanes = (lanes, extra = {}) => validateConfig({ ...structuredClone(DEFAULT_CONFIG), lanes, ...extra });

test('terms match whole words so short terms do not fire inside other words', () => {
  assert.equal(matchesTerm('cloud storage migration', 'rag'), false);
  assert.equal(matchesTerm('build a rag pipeline', 'rag'), true);
  assert.equal(matchesTerm('email marketing assistant', 'ai'), false);
  assert.equal(matchesTerm('ai-powered crm', 'ai'), true);
  assert.equal(matchesTerm('two ai trainers needed', 'ai trainer'), true);
  assert.equal(matchesTerm('automate our invoicing', 'automat*'), true);
  assert.equal(matchesTerm('make.com scenario fixes', 'make.com'), true);
  assert.equal(matchesTerm('makexcom', 'make.com'), false);
});

test('an automation job is a strong fit in the automation lane and weak in the training lane', () => {
  const job = { ...base, title: 'n8n automation expert for CRM workflows', skills: ['n8n', 'Zapier'] };
  const automation = scoreJob(job, withLanes(['ai-automation']), 'n8n');
  const training = scoreJob(job, withLanes(['ai-training']), 'n8n');
  assert.equal(automation.lane, 'ai-automation');
  assert.ok(automation.score > training.score + 20);
  assert.ok(!automation.reasons.some((reason) => reason.includes('weak title fit')));
  assert.ok(training.reasons.some((reason) => reason.includes('weak title fit')));
});

test('with several lanes each job is scored by its best lane', () => {
  const config = withLanes(['ai-automation', 'ai-training']);
  const [first, second] = rankJobs([
    { ...base, uid: 'train', title: 'Claude AI Trainer for Sales Team Workshop' },
    { ...base, uid: 'auto', title: 'Make.com and n8n workflow automation with OpenAI' },
  ], config);
  const lanes = Object.fromEntries([first, second].map((job) => [job.uid, job.lane]));
  assert.deepEqual(lanes, { train: 'ai-training', auto: 'ai-automation' });
});

test('training and consulting lanes still require AI context', () => {
  const scored = scoreJob({ ...base, title: 'Sales Trainer for Retail Staff' }, withLanes(['ai-training']));
  assert.ok(scored.reasons.some((reason) => reason.includes('lacks AI context')));
});

test('an empty lane selection lets every built-in lane compete', () => {
  assert.deepEqual(resolveLanes(DEFAULT_CONFIG).map((lane) => lane.id), Object.keys(BUILT_IN_LANES));
});

test('lane presets include each lane plus a combined deduplicated lanes preset', () => {
  const presets = lanePresets(withLanes(['ai-agents', 'ai-apps']));
  assert.deepEqual(Object.keys(presets).sort(), ['ai-agents', 'ai-apps', 'lanes']);
  assert.equal(new Set(presets.lanes.queries).size, presets.lanes.queries.length);
  assert.ok(presets.lanes.queries.includes('claude code'));
});

test('custom lanes are validated, selectable, and can override a built-in lane', () => {
  const config = withLanes(['shopify-ai'], {
    customLanes: {
      'shopify-ai': {
        label: 'Shopify AI',
        titleTerms: ['shopify'],
        contextTerms: ['ai'],
        requireContext: true,
        queries: ['shopify ai'],
      },
    },
  });
  const scored = scoreJob({ ...base, title: 'Shopify store AI chatbot' }, config);
  assert.equal(scored.lane, 'shopify-ai');
  assert.equal(lanePresets(config)['shopify-ai'].queries[0], 'shopify ai');
  assert.throws(() => withLanes(['nope']), /unknown lane "nope"/);
  assert.throws(() => withLanes([], { customLanes: { 'Bad Id': { label: 'x', titleTerms: ['x'], queries: ['x'] } } }), /lowercase id/);
  assert.throws(() => withLanes([], { customLanes: { empty: { label: 'x', titleTerms: [], queries: ['x'] } } }), /titleTerms must include/);
  assert.throws(() => withLanes([], { customLanes: { typo: { label: 'x', titleTerm: ['x'], titleTerms: ['x'], queries: ['x'] } } }), /not a lane field/);
});

test('lane selection accepts numbers or ids and rejects unknown lanes', () => {
  assert.deepEqual(parseLaneSelection('1, ai-agents, 1', DEFAULT_CONFIG), ['ai-automation', 'ai-agents']);
  assert.throws(() => parseLaneSelection('99', DEFAULT_CONFIG), /Unknown lane "99"/);
});

test('proposal assessment uses the selected lanes for topic match', () => {
  const job = { title: 'Build an n8n workflow for lead routing', description: '', eligibleForProfile: true, detailInspectedAt: new Date().toISOString() };
  const profile = { proof: [], facts: [], defaultHourlyRate: null };
  const automation = assessOpportunity(job, profile, resolveLanes(withLanes(['ai-automation'])));
  const creative = assessOpportunity(job, profile, resolveLanes(withLanes(['ai-creative'])));
  assert.ok(automation.positives.some((item) => item.includes('n8n')));
  assert.ok(automation.score > creative.score);
});

test('new UPWORK_CLI settings win over legacy UPWORK_JOBS names', () => {
  assert.equal(envSetting('HOME', { UPWORK_JOBS_HOME: '/old' }), '/old');
  assert.equal(envSetting('HOME', { UPWORK_JOBS_HOME: '/old', UPWORK_CLI_HOME: '/new' }), '/new');
  assert.equal(envSetting('HOME', {}), '');
});
