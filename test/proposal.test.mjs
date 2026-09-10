import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE as EMPTY_PROFILE } from '../src/profile.mjs';
// Synthetic evidence: these are test fixtures, not user credentials.
const DEFAULT_PROFILE = { ...EMPTY_PROFILE, defaultHourlyRate: 500, proof: [
  { id: 'insurance-demo', title: 'Insurance onboarding demo', summary: 'An insurance enterprise onboarding AI platform.', tags: ['enterprise', 'insurance'], urls: [] },
  { id: 'workshop-demo', title: 'Community Claude workshop', summary: 'Taught nontechnical learners to build a Claude workflow.', tags: ['training', 'workshop', 'nontechnical', 'claude'], urls: [] },
] };
import {
  DURATION_QUESTION_PATTERN,
  assessOpportunity,
  boostConnectsFromInputs,
  buildProposalPacket,
  classifyQuestion,
  jobReference,
  renderProposalPacket,
  resolveBoostConnects,
  selectEvidence,
} from '../src/proposal.mjs';

test('recognizes both current and legacy Upwork duration prompts', () => {
  assert.match('How long will this project take?', DURATION_QUESTION_PATTERN);
  assert.match('How long do you think this project will take?', DURATION_QUESTION_PATTERN);
  assert.doesNotMatch('How do you want to be paid?', DURATION_QUESTION_PATTERN);
});

test('ignores unlabeled numeric controls when calculating boost Connects', () => {
  assert.equal(boostConnectsFromInputs('Boost your proposal', [
    { type: 'number', value: '101', ariaLabel: '', label: '', context: '' },
  ]), 0);
  assert.equal(boostConnectsFromInputs('Boost your proposal', [
    { type: 'number', value: '5', ariaLabel: '', label: 'Bid Connects', context: 'Boost your proposal' },
  ]), 5);
});

test('derives boost Connects from the authoritative send total and base requirement', () => {
  assert.equal(resolveBoostConnects({ inputBoost: 0, totalConnects: 111, baseConnects: 19 }), 92);
  assert.equal(resolveBoostConnects({ inputBoost: 5, totalConnects: 24, baseConnects: 19 }), 5);
  assert.equal(resolveBoostConnects({ inputBoost: 7 }), 7);
});

test('normalizes numeric and ciphertext job references', () => {
  assert.equal(jobReference('1111111111111111101').ciphertext, '~021111111111111111101');
  assert.equal(
    jobReference('https://www.upwork.com/jobs/~021111111111111111101').proposalUrl,
    'https://www.upwork.com/nx/proposals/job/~021111111111111111101/apply/',
  );
});

test('classifies Upwork screening questions', () => {
  assert.equal(classifyQuestion('Describe the most successful AI training you delivered and the outcomes.'), 'training');
  assert.equal(classifyQuestion('Have you taught non-developers to build with AI?'), 'training');
  assert.equal(classifyQuestion('Tell us about an AI agent you personally built.'), 'system');
  assert.equal(classifyQuestion('How would you structure a one-day workshop?'), 'agenda');
  assert.equal(classifyQuestion('What exercise would you set in week one?'), 'agenda');
  assert.equal(classifyQuestion('Please share links to talks and GitHub projects.'), 'links');
});

test('prioritizes the strongest context-specific proof', () => {
  assert.equal(
    selectEvidence('insurance enterprise onboarding AI platform', DEFAULT_PROFILE, 1)[0].id,
    'insurance-demo',
  );
  assert.equal(
    selectEvidence('teach nontechnical people Claude Cowork', DEFAULT_PROFILE, 1)[0].id,
    'workshop-demo',
  );
});

test('flags an excellent but stale opportunity as selective', () => {
  const result = assessOpportunity({
    title: 'Enterprise AI Trainer: Claude workflows and agents',
    description: 'Hands-on workshop covering MCP, automation, and AI adoption.',
    hourlyMax: 250,
    paymentVerified: true,
    phoneVerified: true,
    clientJobsPosted: 1,
    clientHireRate: 0,
    activity: { proposals: '20 to 50', lastViewed: '2 weeks ago' },
  }, DEFAULT_PROFILE);
  assert.equal(result.verdict, 'selective apply');
  assert.ok(result.risks.some((risk) => risk.includes('exceeds the client ceiling')));
});

test('renders an evidence-grounded proposal packet', () => {
  const packet = buildProposalPacket({
    job: {
      title: 'Enterprise AI Trainer',
      url: 'https://www.upwork.com/jobs/~021111111111111111101',
      description: 'A Claude workflow workshop.',
      questions: ['Tell us about an AI workflow you built.'],
      activity: {},
    },
    profile: DEFAULT_PROFILE,
  });
  const markdown = renderProposalPacket(packet);
  assert.match(markdown, /Screening questions/);
  assert.match(markdown, /Community Claude workshop/);
  assert.match(markdown, /never invent metrics/i);
  assert.match(markdown, /proposal-writing\.md/);
  assert.match(markdown, /copy operating system/i);
  assert.match(markdown, /must communicate the freelancer’s value rather than prove that you understood the posting/i);
  assert.doesNotMatch(markdown, /Lead with the client’s outcome/i);
});
