import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE } from '../src/profile.mjs';
import {
  approvalPhrase,
  auditApplicationStyle,
  boostStateMatches,
  buildApplicationTemplate,
  comboboxSelectionMatches,
  confirmationPhrase,
  handleSubmissionDialogs,
  isBlockingFormMessage,
  RATE_INCREASE_QUESTION_PATTERN,
  renderApplicationReview,
  replaceMaskedRate,
  requireExplicitApproval,
  reviewFingerprint,
  styleViolations,
  validateApplication,
} from '../src/application.mjs';

test('recognizes the hourly rate-increase control from its question text', () => {
  assert.match('How often do you want a rate increase?', RATE_INCREASE_QUESTION_PATTERN);
  assert.doesNotMatch('How much of an increase do you want?', RATE_INCREASE_QUESTION_PATTERN);
});

test('accepts an already-selected combobox value without reopening its option list', () => {
  assert.equal(comboboxSelectionMatches('1 to 3 months', '1 to 3 months'), true);
  assert.equal(comboboxSelectionMatches('  1 to 3   months  ', '1 to 3 months'), true);
  assert.equal(comboboxSelectionMatches('Select a duration', '1 to 3 months'), false);
});

test('accepts an already-applied boost after Upwork collapses its editor', () => {
  assert.equal(boostStateMatches({ connectsRequired: 19, boostConnects: 92, totalConnects: 111 }, 92), true);
  assert.equal(boostStateMatches({ connectsRequired: 19, boostConnects: 0, totalConnects: 19 }, 92), false);
  assert.equal(boostStateMatches({ connectsRequired: 19, boostConnects: 92, totalConnects: 110 }, 92), false);
});

test('acknowledges Upwork fixed-price confirmation before continuing submission', async () => {
  const events = [];
  const hiddenDialog = {
    waitFor: async () => {},
    isVisible: async () => false,
  };
  const fixedPriceDialog = {
    waitFor: async () => {},
    isVisible: async () => true,
    getByRole: (role) => role === 'checkbox'
      ? {
          isVisible: async () => true,
          check: async () => events.push('check'),
        }
      : {
          isVisible: async () => true,
          isEnabled: async () => true,
          click: async () => events.push('continue'),
        },
  };
  const page = {
    getByRole: (_role, options) => options.name.test('3 things you need to know')
      ? fixedPriceDialog
      : hiddenDialog,
  };
  const handled = await handleSubmissionDialogs(page, {
    guard: async () => events.push('guard'),
  });
  assert.deepEqual(handled, ['fixed-price']);
  assert.deepEqual(events, ['guard', 'check', 'continue']);
});

test('does not treat Upwork Connects promotions as blocking form errors', () => {
  assert.equal(isBlockingFormMessage('Buy more Connects to rank in 1st place Buy'), false);
  assert.equal(isBlockingFormMessage('Suggested bid: 12 Connects'), false);
  assert.equal(isBlockingFormMessage('Duration is required'), true);
});

const questions = [
  'Describe the most successful AI training you delivered.',
  'Tell us about an AI workflow you built.',
];

function validApplication() {
  const application = buildApplicationTemplate({
    job: {
      uid: '1111111111111111101',
      url: 'https://www.upwork.com/jobs/~021111111111111111101',
      title: 'Enterprise AI Trainer',
      hourlyMax: 250,
    },
    form: {
      connectsRequired: 13,
      submitAs: 'freelancer',
      fields: [{ question: 'Cover Letter' }, ...questions.map((question) => ({ question }))],
    },
    profile: DEFAULT_PROFILE,
    hourlyRate: 250,
  });
  application.coverLetter = 'I will build a hands-on workshop around the client’s real workflows.';
  application.terms.duration = '1 to 3 months';
  application.answers.forEach((item, index) => { item.answer = `Evidence-grounded answer ${index + 1}.`; });
  return application;
}

test('builds a replayable application template from exact live questions', () => {
  const application = validApplication();
  assert.equal(application.schemaVersion, 3);
  assert.equal(application.submissionPolicy.explicitUserConsentRequired, true);
  assert.equal(application.submissionPolicy.separateCodeBlockReviewRequired, true);
  assert.equal(application.terms.hourlyRate, 250);
  assert.equal(application.terms.maxConnects, 13);
  assert.deepEqual(application.answers.map((item) => item.question), questions);
  assert.deepEqual(application.evidence, []); // A new user inherits no one else’s credentials.
});

test('validates exact live question order and Connects', () => {
  const application = validApplication();
  const result = validateApplication(application, {
    liveForm: {
      connectsRequired: 13,
      connectsRemaining: 151,
      durationControl: { index: 0, value: 'Select a duration' },
      fields: [{ question: 'Cover Letter' }, ...questions.map((question) => ({ question }))],
    },
    job: { hourlyMax: 250 },
  });
  assert.equal(result.valid, true);
});

test('ignores Upwork character counters appended to live question labels', () => {
  const application = validApplication();
  const result = validateApplication(application, {
    liveForm: {
      connectsRequired: 13,
      connectsRemaining: 151,
      fields: [
        { question: 'Cover Letter' },
        ...questions.map((question, index) => ({
          question: `${question} ${4_455 + index} characters left`,
        })),
      ],
    },
    job: { hourlyMax: 250 },
  });
  assert.equal(result.valid, true);
});

test('allows hourly forms without a duration control but keeps it mandatory for fixed price', () => {
  const application = validApplication();
  const liveForm = {
    connectsRequired: 13,
    fields: [{ question: 'Cover Letter' }, ...questions.map((question) => ({ question }))],
  };
  assert.equal(validateApplication(application, { liveForm }).valid, true);

  application.job.jobType = 'Fixed price';
  application.terms.pricingBasis = 'fixed';
  application.terms.paymentMode = 'project';
  application.terms.fixedPrice = 300;
  const fixedResult = validateApplication(application, { liveForm });
  assert.equal(fixedResult.valid, false);
  assert.ok(fixedResult.errors.some((error) => error.includes('fixed-price form')));
});

test('fails closed when questions or Connects change', () => {
  const application = validApplication();
  const result = validateApplication(application, {
    liveForm: {
      connectsRequired: 15,
      durationControl: { index: 0, value: 'Select a duration' },
      fields: [
        { question: 'Cover Letter' },
        { question: questions[1] },
        { question: questions[0] },
      ],
    },
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('Connects changed')));
  assert.ok(result.errors.some((error) => error.includes('out of order')));
});

test('blocks unintended above-budget bids and contact requests', () => {
  const application = validApplication();
  application.terms.hourlyRate = 500;
  application.coverLetter = 'Email me at writer@example.com to discuss.';
  const result = validateApplication(application, { job: { hourlyMax: 250 } });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('exceeds the live client ceiling')));
  assert.ok(result.errors.some((error) => error.includes('off-platform contact')));
});

test('requires a Connects-specific action-time confirmation phrase', () => {
  assert.equal(confirmationPhrase(13, 0), 'SUBMIT 13 CONNECTS');
  assert.equal(confirmationPhrase(13, 5), 'SUBMIT 18 CONNECTS');
});

test('blocks em dashes and formulaic AI phrasing', () => {
  assert.deepEqual(styleViolations('A direct, specific answer.'), []);
  assert.ok(styleViolations('This is practical — and specific.').includes('em dash'));
  assert.ok(styleViolations("You're not looking for slides; you want results.").includes('formulaic contrast opener'));
  assert.ok(styleViolations('I am excited to apply.').includes('generic enthusiasm'));
  assert.ok(styleViolations('Let me be clear. I can help.').includes('throat-clearing opener'));
  assert.ok(styleViolations('This marks a pivotal moment for the team.').includes('importance puffery'));
  assert.ok(styleViolations('We can leverage a robust workflow.').includes('banned AI vocabulary'));

  const application = validApplication();
  application.answers[0].answer = 'This is not just training, but transformation.';
  const result = validateApplication(application);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('binary contrast')));
});

test('audits the cover letter and each answer with named No AI Slop findings', () => {
  const application = validApplication();
  application.coverLetter = 'Here’s the thing. We can leverage a robust workflow.';
  application.answers[0].answer = 'Actually, we can use the existing data.';
  const findings = auditApplicationStyle(application);
  assert.ok(findings.some((finding) => finding.section === 'coverLetter'
    && finding.severity === 'error'
    && finding.rule === 'throat-clearing opener'));
  assert.ok(findings.some((finding) => finding.section === 'coverLetter'
    && finding.severity === 'error'
    && finding.rule === 'banned AI vocabulary'));
  assert.ok(findings.some((finding) => finding.section === 'answers[0]'
    && finding.severity === 'warning'
    && finding.rule === 'possibly empty adverb'));
});

test('blocks posting mirrors and portable proposal filler', () => {
  const application = validApplication();
  application.job.description = 'We need an experienced trainer who can help our team build repeatable AI workflows from real company data every week.';
  application.coverLetter = 'You are looking for an experienced trainer who can help your team build repeatable AI workflows from real company data every week. I believe my experience makes me the right choice.';
  const result = validateApplication(application);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('client-brief mirror')));
  assert.ok(result.errors.some((error) => error.includes('copied posting phrase')));
  assert.ok(result.errors.some((error) => error.includes('portable proposal filler')));
});

test('accepts the canonical value-first proposal cadence', () => {
  const application = validApplication();
  application.job.description = 'Our seven-person team uses ChatGPT and Claude but needs weekly training on durable workflows.';
  application.coverLetter = [
    'Hey!',
    '',
    'Your posting caught my attention. My team is also seven people.',
    '',
    'I taught a community workshop where participants built a task tracker and practiced reviewing its output.',
    '',
    'My rate is $195/hour. But honestly, if you want someone who can get the team building things they will keep using after the session, that difference should pay for itself pretty quickly.',
  ].join('\n');
  const findings = auditApplicationStyle(application);
  assert.equal(findings.some((finding) => finding.severity === 'error'), false);
  assert.equal(findings.some((finding) => finding.rule === 'client-brief mirror'), false);
  assert.equal(findings.some((finding) => finding.rule === 'specific proof arrives too late'), false);
});

test('blocks screening answers that repeat the question instead of answering it', () => {
  const application = validApplication();
  application.answers[0].question = 'Tell us about one specific team and what they built with artificial intelligence during your training program.';
  application.answers[0].answer = 'One specific team and what they built with artificial intelligence during my training program was a dashboard.';
  const result = validateApplication(application);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('screening-question mirror')));
});

test('warns when conversational copy collapses into stacked short sentences', () => {
  const application = validApplication();
  application.coverLetter = 'We build it. We test it. We ship it.';
  const findings = auditApplicationStyle(application);
  assert.ok(findings.some((finding) => finding.section === 'coverLetter'
    && finding.severity === 'warning'
    && finding.rule === 'possible stacked short sentences'));
});

test('does not mistake periods inside proof URLs for stacked short sentences', () => {
  const application = validApplication();
  application.coverLetter = 'Relevant work:\n\nCommunity workshop recording\nhttps://example.com/workshop';
  const findings = auditApplicationStyle(application);
  assert.equal(findings.some((finding) => finding.rule === 'possible stacked short sentences'), false);
});

test('warns on abstract work-lives metaphors and invented team archetypes', () => {
  const application = validApplication();
  application.coverLetter = 'The useful work still lives in chats. One person wants reports. Someone else wants APIs.';
  const findings = auditApplicationStyle(application);
  assert.ok(findings.some((finding) => finding.rule === 'abstract work-lives metaphor'));
  assert.ok(findings.some((finding) => finding.rule === 'possible invented archetypes'));
});

test('warns on empathetic and transitional sentences that add no information', () => {
  const application = validApplication();
  application.coverLetter = 'I know what it looks like when a team uses AI. So that’s how I’d handle this.';
  const findings = auditApplicationStyle(application);
  assert.ok(findings.some((finding) => finding.rule === 'possible empty empathy claim'));
  assert.ok(findings.some((finding) => finding.rule === 'possible empty bridge'));
});

test('renders every response in a separate code block before approval', () => {
  const application = validApplication();
  const review = renderApplicationReview(application);
  assert.equal(review.validation.valid, true);
  assert.match(review.markdown, /STATUS: NOT APPROVED/);
  assert.match(review.markdown, /## Cover letter/);
  assert.match(review.markdown, /## Answer 1/);
  assert.match(review.markdown, /## Answer 2/);
  assert.equal((review.markdown.match(/```text/g) || []).length, 4);
  assert.match(review.markdown, new RegExp(approvalPhrase(application)));
});

test('reviews fixed-price terms accurately and binds them to the fingerprint', () => {
  const application = validApplication();
  application.job.jobType = 'Fixed price';
  application.terms.pricingBasis = 'fixed';
  application.terms.paymentMode = 'project';
  application.terms.fixedPrice = 300;
  const before = reviewFingerprint(application);
  const review = renderApplicationReview(application);
  assert.equal(review.validation.valid, true);
  assert.match(review.markdown, /Fixed price: \$300/);
  assert.match(review.markdown, /Payment mode: project/);
  assert.match(review.markdown, /Estimated duration: 1 to 3 months/);
  assert.doesNotMatch(review.markdown, /\$300\/hr/);

  application.terms.fixedPrice = 350;
  assert.notEqual(reviewFingerprint(application), before);
});

test('requires duration and binds proposal logistics to the approval fingerprint', () => {
  const application = validApplication();
  const baseline = reviewFingerprint(application);

  application.terms.duration = null;
  const missingDuration = validateApplication(application);
  assert.equal(missingDuration.valid, false);
  assert.ok(missingDuration.errors.some((error) => error.includes('terms.duration')));

  application.terms.duration = '3 to 6 months';
  assert.notEqual(reviewFingerprint(application), baseline);
  const durationFingerprint = reviewFingerprint(application);
  application.terms.submitAs = 'agency';
  assert.notEqual(reviewFingerprint(application), durationFingerprint);
});

test('blocks a base-plus-boost total above the application Connects cap', () => {
  const application = validApplication();
  application.terms.boostConnects = 5;
  application.terms.maxConnects = 17;
  const result = validateApplication(application);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('Base 13 plus boost 5')));
});

test('fails validation for milestone mode until explicit milestone fields are supported', () => {
  const application = validApplication();
  application.job.jobType = 'Fixed price';
  application.terms.pricingBasis = 'fixed';
  application.terms.fixedPrice = 300;
  application.terms.paymentMode = 'milestone';
  const result = validateApplication(application);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('milestone is not supported')));
});

test('does not issue an approval phrase for an already-submitted application', () => {
  const application = validApplication();
  application.status = 'submitted-manually';
  const review = renderApplicationReview(application);
  assert.equal(review.validation.valid, true);
  assert.match(review.markdown, /SUBMITTED-MANUALLY/);
  assert.doesNotMatch(review.markdown, /I APPROVE PROPOSAL/);
  assert.throws(
    () => requireExplicitApproval(application, approvalPhrase(application)),
    /Only draft applications can receive CLI approval/,
  );
});

test('invalidates approval when any reviewed content changes', () => {
  const application = validApplication();
  const approved = approvalPhrase(application);
  const before = reviewFingerprint(application);
  assert.equal(requireExplicitApproval(application, approved).approved, true);

  application.answers[0].answer += ' One changed sentence.';
  assert.notEqual(reviewFingerprint(application), before);
  assert.throws(
    () => requireExplicitApproval(application, approved),
    /explicit user consent is missing or stale/i,
  );
});

test('replaces a masked rate instead of appending to the existing currency value', async () => {
  const events = [];
  const input = {
    click: async () => events.push('click'),
    press: async (key) => events.push(`press:${key}`),
    type: async (value) => events.push(`type:${value}`),
  };
  await replaceMaskedRate(input, 250);
  assert.equal(events[0], 'click');
  assert.ok(events[1] === 'press:Meta+A' || events[1] === 'press:Control+A');
  assert.deepEqual(events.slice(2), ['press:Backspace', 'type:250', 'press:Tab']);
});
