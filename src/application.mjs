import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { cleanText } from './util.mjs';
import { noAISlopFindings, noAISlopViolations } from './no-ai-slop.mjs';
import {
  DURATION_QUESTION_PATTERN,
  extractProposalForm,
  jobReference,
  selectEvidence,
} from './proposal.mjs';

const FIELD_LIMIT = 5_000;
const RATE_FREQUENCIES = new Set(['Never', 'Every 3 months', 'Every 6 months', 'Every 12 months']);
export const RATE_INCREASE_QUESTION_PATTERN = /How often do you want a rate increase/i;
export const DURATION_OPTIONS = new Set([
  'Less than 1 month',
  '1 to 3 months',
  '3 to 6 months',
  'More than 6 months',
]);
const SUBMIT_AS_OPTIONS = new Set(['freelancer', 'agency']);
const PAYMENT_MODES = new Set(['project', 'milestone']);
const REQUIRED_SUBMISSION_POLICY = {
  explicitUserConsentRequired: true,
  separateCodeBlockReviewRequired: true,
  noEmDashes: true,
  noFormulaicAISpeak: true,
  approvalInvalidatedByAnyChange: true,
};

function number(value) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function explicitContactRequest(text) {
  return /\b(?:email me at|call me at|text me at|contact me at|whats?app|calendly\.com|meet\.google\.com|zoom\.us\/j)\b/i.test(text);
}

function normalizeQuestion(value) {
  return cleanText(value)
    .replace(/\s+\d{1,5}\s+characters?\s+left$/i, '')
    .replace(/[’‘]/g, "'");
}

function pricingBasis(application) {
  const explicit = String(application?.terms?.pricingBasis || '').toLowerCase();
  if (explicit === 'fixed' || explicit === 'hourly') return explicit;
  return /fixed/i.test(String(application?.job?.jobType || '')) ? 'fixed' : 'hourly';
}

export function styleViolations(text) {
  return noAISlopViolations(text);
}

export function auditApplicationStyle(application) {
  const sections = [
    { section: 'coverLetter', text: application?.coverLetter || '' },
    ...(application?.answers || []).map((item, index) => ({
      section: `answers[${index}]`,
      question: item?.question || '',
      text: item?.answer || '',
    })),
  ];
  const slopFindings = sections.flatMap((section) => noAISlopFindings(section.text).map((finding) => ({
    section: section.section,
    ...(section.question ? { question: section.question } : {}),
    ...finding,
  })));
  return [...slopFindings, ...proposalCopyFindings(application)];
}

function normalizedWords(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .match(/[a-z0-9']+/g) || [];
}

function sharedPhrase(left, right, length = 9) {
  const leftWords = normalizedWords(left);
  const rightWords = normalizedWords(right);
  if (leftWords.length < length || rightWords.length < length) return null;
  const rightPhrases = new Set();
  for (let index = 0; index <= rightWords.length - length; index += 1) {
    rightPhrases.add(rightWords.slice(index, index + length).join(' '));
  }
  for (let index = 0; index <= leftWords.length - length; index += 1) {
    const phrase = leftWords.slice(index, index + length).join(' ');
    if (rightPhrases.has(phrase)) return phrase;
  }
  return null;
}

function sentenceParts(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/g, '')
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !/^(?:hey|hello|hi)[!,]?$/i.test(sentence)) || [];
}

export function proposalCopyFindings(application) {
  const coverLetter = String(application?.coverLetter || '');
  const findings = [];
  const directMirrorPatterns = [
    /(?:^|\n)\s*(?:I understand (?:that )?)?you(?:'re| are) (?:looking for|seeking|trying to|hoping to)\b/i,
    /(?:^|\n)\s*(?:Your|The) (?:goal|problem|challenge|objective) is\b/i,
    /(?:^|\n)\s*It sounds like you\b/i,
  ];
  const portableFillerPatterns = [
    /\bI believe (?:my|that I)\b/i,
    /\bI am confident (?:that )?I\b/i,
    /\bI would be (?:a great|an excellent|the perfect|the ideal)\b/i,
    /\bI can help you (?:achieve|reach|build|create|develop|implement)\b/i,
    /\bI understand the importance of\b/i,
  ];
  for (const pattern of directMirrorPatterns) {
    const match = pattern.exec(coverLetter);
    if (match) {
      findings.push({
        section: 'coverLetter',
        severity: 'error',
        rule: 'client-brief mirror',
        excerpt: match[0].replace(/\s+/g, ' ').trim(),
      });
      break;
    }
  }
  for (const pattern of portableFillerPatterns) {
    const match = pattern.exec(coverLetter);
    if (match) {
      findings.push({
        section: 'coverLetter',
        severity: 'error',
        rule: 'portable proposal filler',
        excerpt: match[0].replace(/\s+/g, ' ').trim(),
      });
      break;
    }
  }
  const mirroredPostingPhrase = sharedPhrase(coverLetter, application?.job?.description, 9);
  if (mirroredPostingPhrase) {
    findings.push({
      section: 'coverLetter',
      severity: 'error',
      rule: 'copied posting phrase',
      excerpt: mirroredPostingPhrase,
    });
  }
  const opening = sentenceParts(coverLetter).slice(0, 3).join(' ');
  if (coverLetter && !/(?:\d|O['’]Reilly|Claude|Codex|insurance|enterprise|agency|team|community|audience|course|workshop|built|teach|trained|founder|professor|master['’]s)/i.test(opening)) {
    findings.push({
      section: 'coverLetter',
      severity: 'warning',
      rule: 'specific proof arrives too late',
      excerpt: opening.slice(0, 220),
    });
  }
  for (const [index, item] of (application?.answers || []).entries()) {
    const mirror = sharedPhrase(item?.answer, item?.question, 8);
    if (mirror) {
      findings.push({
        section: `answers[${index}]`,
        question: item.question || '',
        severity: 'error',
        rule: 'screening-question mirror',
        excerpt: mirror,
      });
    }
    const vagueOpening = String(item?.answer || '').match(/^\s*(?:It depends|There are (?:a few|several)|The first step would be to understand)\b/i);
    if (vagueOpening) {
      findings.push({
        section: `answers[${index}]`,
        question: item.question || '',
        severity: 'warning',
        rule: 'answer delays the point',
        excerpt: vagueOpening[0].trim(),
      });
    }
  }
  return findings;
}

export function isBlockingFormMessage(message) {
  const text = cleanText(message);
  if (!text) return false;
  return !/In compliance with Tax Law/i.test(text)
    && !/^Suggested bid:/i.test(text)
    && !/Buy more Connects to rank in \d+(?:st|nd|rd|th) place/i.test(text);
}

function reviewedContent(application) {
  return {
    schemaVersion: application.schemaVersion,
    job: {
      uid: application.job?.uid || null,
      title: application.job?.title || null,
      url: application.job?.url || null,
    },
    terms: {
      pricingBasis: pricingBasis(application),
      submitAs: application.terms?.submitAs ?? null,
      paymentMode: application.terms?.paymentMode ?? null,
      duration: application.terms?.duration ?? null,
      hourlyRate: application.terms?.hourlyRate ?? null,
      fixedPrice: application.terms?.fixedPrice ?? null,
      rateIncrease: application.terms?.rateIncrease || null,
      expectedConnects: application.terms?.expectedConnects ?? null,
      maxConnects: application.terms?.maxConnects ?? null,
      boostConnects: application.terms?.boostConnects ?? 0,
      allowRateAboveBudget: Boolean(application.terms?.allowRateAboveBudget),
    },
    coverLetter: application.coverLetter || '',
    answers: (application.answers || []).map((item) => ({
      question: item.question || '',
      answer: item.answer || '',
    })),
  };
}

export function reviewFingerprint(application) {
  return createHash('sha256')
    .update(JSON.stringify(reviewedContent(application)))
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
}

export function approvalPhrase(application) {
  return `I APPROVE PROPOSAL ${reviewFingerprint(application)}`;
}

export function requireExplicitApproval(application, provided) {
  if (application?.status !== 'draft') {
    throw new Error(`Only draft applications can receive CLI approval; saw ${application?.status || 'missing'}`);
  }
  const expected = approvalPhrase(application);
  if (provided !== expected) {
    throw new Error(`Explicit user consent is missing or stale. After reviewing every code block, the user must provide exactly: ${expected}`);
  }
  return { approved: true, fingerprint: reviewFingerprint(application), phrase: expected };
}

function fencedBlock(text) {
  const runs = String(text || '').match(/`+/g) || [];
  const fenceLength = Math.max(3, ...runs.map((run) => run.length + 1));
  const fence = '`'.repeat(fenceLength);
  return `${fence}text\n${text}\n${fence}`;
}

export function renderApplicationReview(application) {
  const validation = validateApplication(application);
  const fingerprint = reviewFingerprint(application);
  const basis = pricingBasis(application);
  const isDraft = application?.status === 'draft';
  const statusLine = isDraft
    ? '**STATUS: NOT APPROVED AND NOT AUTHORIZED FOR SUBMISSION**'
    : `**STATUS: ${String(application?.status || 'unknown').toUpperCase()} - NOT ELIGIBLE FOR CLI SUBMISSION**`;
  const priceLine = basis === 'fixed'
    ? `Fixed price: $${application.terms?.fixedPrice ?? 'unknown'}`
    : `Hourly rate: $${application.terms?.hourlyRate ?? 'unknown'}/hr`;
  const lines = [
    '# FINAL PROPOSAL REVIEW',
    '',
    statusLine,
    '',
    `Job: ${application.job?.title || application.job?.uid || 'unknown'}`,
    priceLine,
    `Submit as: ${application.terms?.submitAs ?? 'unknown'}`,
    `Payment mode: ${application.terms?.paymentMode ?? 'n/a'}`,
    `Estimated duration: ${application.terms?.duration ?? 'unknown'}`,
    `Base Connects: ${application.terms?.expectedConnects ?? 'unknown'}`,
    `Maximum Connects authorized in file: ${application.terms?.maxConnects ?? 'unknown'}`,
    `Optional boost Connects: ${application.terms?.boostConnects ?? 0}`,
    `Content fingerprint: ${fingerprint}`,
    '',
    '## Cover letter',
    '',
    fencedBlock(application.coverLetter || ''),
    '',
  ];
  (application.answers || []).forEach((item, index) => {
    lines.push(
      `## Answer ${index + 1}`,
      '',
      `Question: ${item.question}`,
      '',
      fencedBlock(item.answer || ''),
      '',
    );
  });
  lines.push('## Validation', '');
  if (validation.valid) lines.push('- Passed all content, No AI Slop, rate, and policy checks.');
  else validation.errors.forEach((error) => lines.push(`- BLOCKED: ${error}`));
  validation.warnings.forEach((warning) => lines.push(`- WARNING: ${warning}`));
  lines.push('', '**Any change to price, identity, payment mode, duration, Connects, cover letter, questions, answers, or links changes the fingerprint and voids prior approval.**', '');
  if (validation.valid && isDraft) {
    lines.push('Only the user may provide this exact approval after reviewing every block:', '', fencedBlock(approvalPhrase(application)), '');
  } else if (validation.valid) {
    lines.push('No approval phrase is issued because this application is not a draft.', '');
  } else {
    lines.push('Approval is unavailable until every blocked item is fixed.', '');
  }
  return { markdown: `${lines.join('\n')}\n`, validation, fingerprint };
}

export async function loadApplication(file) {
  const source = path.resolve(file);
  let application;
  try {
    application = JSON.parse(await fs.readFile(source, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read application ${source}: ${error.message}`);
  }
  return { application, source };
}

export function buildApplicationTemplate({ job, form, profile, hourlyRate }) {
  const ref = jobReference(job.url || job.uid);
  const questions = form?.fields?.slice(1).map((field) => field.question).filter(Boolean)
    || job.questions
    || [];
  const requestedRate = number(hourlyRate) ?? number(profile.defaultHourlyRate);
  const evidenceQuery = `${job.title || ''} ${job.description || ''} ${questions.join(' ')}`;
  return {
    schemaVersion: 3,
    status: 'draft',
    submissionPolicy: structuredClone(REQUIRED_SUBMISSION_POLICY),
    job: {
      uid: ref.uid,
      ciphertext: ref.ciphertext,
      title: job.title || form?.title || '',
      url: ref.jobUrl,
      description: job.description || job.summary || '',
      jobType: job.jobType || null,
      hourlyMin: job.hourlyMin ?? null,
      hourlyMax: job.hourlyMax ?? null,
    },
    terms: {
      pricingBasis: /fixed/i.test(String(job.jobType || '')) ? 'fixed' : 'hourly',
      submitAs: form?.submitAs || 'freelancer',
      paymentMode: /fixed/i.test(String(job.jobType || ''))
        ? (form?.paymentMode || 'project')
        : null,
      duration: form?.duration || null,
      hourlyRate: requestedRate,
      fixedPrice: number(job.fixedBudget),
      rateIncrease: { frequency: 'Never', percent: null },
      expectedConnects: form?.connectsRequired ?? job.connectsRequired ?? null,
      maxConnects: form?.connectsRequired ?? job.connectsRequired ?? 20,
      boostConnects: 0,
      allowRateAboveBudget: false,
    },
    coverLetter: '',
    answers: questions.map((question) => ({ question, answer: '' })),
    evidence: selectEvidence(evidenceQuery, profile, 8).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      urls: item.urls || [],
    })),
    notes: [
      'Complete the cover letter and every answer before validation.',
      'Keep exact question text so live form mapping can fail safely if Upwork changes it.',
      'Show the cover letter and every answer in separate code blocks before requesting consent.',
      'Never submit without explicit user consent for the exact content fingerprint.',
      'Apply the No AI Slop rules: preserve the freelancer’s voice while removing banned vocabulary, canned contrasts, throat-clearing, faux insights, puffery, robotic rhythm, and generic closings.',
      'Use the proposalVoice operating system from the evidence profile. Treat its cadence examples as references, never reusable templates.',
      'Do not restate or paraphrase the client’s problem in the cover letter. Use it for the freelancer’s value, evidence, rate, availability, and proof; answer requirements only where the screening questions require them.',
      'Put the strongest role-specific proof inside the first three sentences. Open with a genuine point of resonance only when it is true and useful.',
      'Every sentence must earn its place by adding evidence, a mechanism, a decision, a constraint, a term, or a concrete next step.',
      'For screening questions, lead with the freelancer’s strongest directly relevant external proof. Training questions should lead with verified teaching examples and exercises when available.',
      'When the user deliberately positions a premium rate, state the rate and value directly. Do not add a fallback line about the client’s budget cap unless the user requests one.',
    ],
  };
}

export function validateApplication(application, { liveForm = null, job = null } = {}) {
  const errors = [];
  const warnings = [];
  if (application?.schemaVersion !== 3) errors.push('schemaVersion must be 3');
  for (const [key, expected] of Object.entries(REQUIRED_SUBMISSION_POLICY)) {
    if (application?.submissionPolicy?.[key] !== expected) {
      errors.push(`submissionPolicy.${key} must be ${expected}`);
    }
  }
  if (!application?.job?.uid && !application?.job?.url) errors.push('job.uid or job.url is required');
  try {
    jobReference(application?.job?.url || application?.job?.uid);
  } catch (error) {
    errors.push(error.message);
  }

  const basis = pricingBasis(application);
  const submitAs = String(application?.terms?.submitAs || '');
  const paymentMode = application?.terms?.paymentMode == null
    ? null
    : String(application.terms.paymentMode);
  const duration = String(application?.terms?.duration || '');
  if (!SUBMIT_AS_OPTIONS.has(submitAs)) errors.push('terms.submitAs must be freelancer or agency');
  if (!DURATION_OPTIONS.has(duration)) {
    errors.push(`terms.duration must be one of: ${[...DURATION_OPTIONS].join(', ')}`);
  }
  const rate = number(application?.terms?.hourlyRate);
  const fixedPrice = number(application?.terms?.fixedPrice);
  if (basis === 'fixed') {
    if (!fixedPrice || fixedPrice <= 0) errors.push('terms.fixedPrice must be greater than zero for fixed-price jobs');
    if (!PAYMENT_MODES.has(paymentMode)) errors.push('terms.paymentMode must be project or milestone for fixed-price jobs');
    if (paymentMode === 'milestone') {
      errors.push('terms.paymentMode milestone is not supported by automated filling; use project or add explicit milestone support first');
    }
  } else if (!rate || rate <= 0) {
    errors.push('terms.hourlyRate must be greater than zero');
  }
  const maxConnects = number(application?.terms?.maxConnects);
  if (maxConnects == null || maxConnects < 0) errors.push('terms.maxConnects must be zero or greater');
  const expectedConnects = number(application?.terms?.expectedConnects);
  if (expectedConnects == null || expectedConnects <= 0) errors.push('terms.expectedConnects must be greater than zero');
  if (expectedConnects != null && expectedConnects > maxConnects) {
    errors.push(`Expected ${expectedConnects} Connects exceeds maxConnects ${maxConnects}`);
  }
  const boostConnects = number(application?.terms?.boostConnects) ?? 0;
  if (boostConnects < 0 || !Number.isInteger(boostConnects)) errors.push('terms.boostConnects must be a non-negative integer');
  if (expectedConnects != null && maxConnects != null && expectedConnects + boostConnects > maxConnects) {
    errors.push(`Base ${expectedConnects} plus boost ${boostConnects} exceeds maxConnects ${maxConnects}`);
  }

  const frequency = application?.terms?.rateIncrease?.frequency || 'Never';
  if (!RATE_FREQUENCIES.has(frequency)) errors.push(`Unsupported rate-increase frequency: ${frequency}`);
  if (frequency !== 'Never') {
    const percent = number(application?.terms?.rateIncrease?.percent);
    if (!percent || percent <= 0) errors.push('A positive rate-increase percent is required when frequency is not Never');
  }

  const cover = String(application?.coverLetter || '').trim();
  if (!cover) errors.push('coverLetter is required');
  if (cover.length > FIELD_LIMIT) errors.push(`coverLetter exceeds ${FIELD_LIMIT} characters`);
  if (explicitContactRequest(cover)) errors.push('coverLetter contains an off-platform contact request');
  for (const violation of styleViolations(cover)) errors.push(`coverLetter violates style rule: ${violation}`);
  for (const finding of noAISlopFindings(cover).filter((item) => item.severity === 'warning')) {
    warnings.push(`coverLetter ${finding.rule}: "${finding.excerpt}"`);
  }

  if (!Array.isArray(application?.answers)) errors.push('answers must be an array');
  const answers = Array.isArray(application?.answers) ? application.answers : [];
  const seen = new Set();
  answers.forEach((item, index) => {
    const question = normalizeQuestion(item?.question);
    const answer = String(item?.answer || '').trim();
    if (!question) errors.push(`answers[${index}].question is required`);
    if (seen.has(question)) errors.push(`Duplicate question: ${question}`);
    seen.add(question);
    if (!answer) errors.push(`Answer is required for: ${question || `index ${index}`}`);
    if (answer.length > FIELD_LIMIT) errors.push(`Answer exceeds ${FIELD_LIMIT} characters: ${question}`);
    if (explicitContactRequest(answer)) errors.push(`Answer contains an off-platform contact request: ${question}`);
    for (const violation of styleViolations(answer)) errors.push(`Answer violates style rule (${question}): ${violation}`);
    for (const finding of noAISlopFindings(answer).filter((entry) => entry.severity === 'warning')) {
      warnings.push(`Answer style warning (${question}): ${finding.rule}: "${finding.excerpt}"`);
    }
  });

  for (const finding of proposalCopyFindings(application)) {
    const message = `${finding.section} ${finding.rule}: "${finding.excerpt}"`;
    if (finding.severity === 'error') errors.push(message);
    else warnings.push(message);
  }

  const hourlyMax = number(job?.hourlyMax ?? application?.job?.hourlyMax);
  if (basis === 'hourly' && hourlyMax && rate > hourlyMax && !application?.terms?.allowRateAboveBudget) {
    errors.push(`Rate $${rate}/hr exceeds the live client ceiling of $${hourlyMax}/hr; set allowRateAboveBudget only if intentional`);
  }

  if (liveForm) {
    const liveQuestions = (liveForm.fields || []).slice(1).map((field) => normalizeQuestion(field.question));
    const applicationQuestions = answers.map((item) => normalizeQuestion(item.question));
    if (liveQuestions.length !== applicationQuestions.length) {
      errors.push(`Live form has ${liveQuestions.length} questions but the application has ${applicationQuestions.length}`);
    } else {
      liveQuestions.forEach((question, index) => {
        if (question !== applicationQuestions[index]) {
          errors.push(`Question ${index + 1} changed or is out of order: "${question}"`);
        }
      });
    }
    if (liveForm.connectsRequired != null && liveForm.connectsRequired > maxConnects) {
      errors.push(`Live form requires ${liveForm.connectsRequired} Connects, above maxConnects ${maxConnects}`);
    }
    if (expectedConnects != null && liveForm.connectsRequired != null && expectedConnects !== liveForm.connectsRequired) {
      errors.push(`Connects changed from expected ${expectedConnects} to live ${liveForm.connectsRequired}`);
    }
    if (liveForm.connectsRemaining != null && liveForm.connectsRemaining < 0) errors.push('The account does not have enough Connects');
    if (basis === 'fixed' && !liveForm.durationControl) {
      errors.push('The live fixed-price form is missing the required duration control');
    }
    if (liveForm.totalConnects != null && liveForm.connectsRequired != null
      && liveForm.totalConnects !== liveForm.connectsRequired + liveForm.boostConnects) {
      errors.push('The live total Connects do not equal base plus boost');
    }
  }

  if (boostConnects > 0) warnings.push(`Application requests ${boostConnects} optional boost Connects; live support must be detected before submission`);
  if (!application?.evidence?.length) warnings.push('No evidence records are attached to this application file');
  return { valid: errors.length === 0, errors, warnings };
}

export async function replaceMaskedRate(input, rate) {
  await input.click();
  await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await input.press('Backspace');
  await input.type(String(rate), { delay: 15 });
  await input.press('Tab');
}

export function comboboxSelectionMatches(value, option) {
  return cleanText(value).toLowerCase() === cleanText(option).toLowerCase();
}

export function boostStateMatches(form, requestedBoost) {
  const boost = Number(requestedBoost || 0);
  const base = Number(form?.connectsRequired);
  const observedBoost = Number(form?.boostConnects);
  const total = Number(form?.totalConnects);
  return boost > 0
    && Number.isFinite(base)
    && observedBoost === boost
    && total === base + boost;
}

async function chooseComboboxOption(page, index, option) {
  const combobox = page.locator('main').getByRole('combobox').nth(index);
  await combobox.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function chooseComboboxByContext(page, pattern, option) {
  const comboboxes = page.locator('main').getByRole('combobox');
  const matcher = { source: pattern.source, flags: pattern.flags.replace('g', '') };
  const metadata = await comboboxes.evaluateAll((elements, contextMatcher) => elements.map((element, index) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const contextPattern = new RegExp(contextMatcher.source, contextMatcher.flags);
    let ancestor = element.parentElement;
    let context = '';
    for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
      const text = clean(ancestor.innerText);
      if (text) context = text;
      if (contextPattern.test(text)) break;
    }
    return { index, value: clean(element.innerText), context };
  }), matcher);
  const match = metadata.find((item) => pattern.test(item.context));
  if (!match) throw new Error(`Could not find the required combobox for ${option}`);
  if (comboboxSelectionMatches(match.value, option)) return;
  await chooseComboboxOption(page, match.index, option);
}

async function chooseComboboxByCurrentValue(page, allowedValues, option) {
  const comboboxes = page.locator('main').getByRole('combobox');
  const values = await comboboxes.allTextContents();
  const index = values.findIndex((value) => allowedValues.has(cleanText(value)));
  if (index < 0) throw new Error(`Could not find the combobox currently showing ${[...allowedValues].join(' or ')}`);
  await chooseComboboxOption(page, index, option);
}

export async function detectBoost(page) {
  const bodyText = await page.locator('body').innerText();
  const mentionsBoost = /boost (?:your )?proposal|boosted proposal|bid.*connects/i.test(bodyText);
  const candidates = await page.locator('input').evaluateAll((elements) => elements.map((element, index) => ({
    index,
    type: element.type || '',
    label: String(
      element.getAttribute('aria-label')
      || document.querySelector(`label[for="${element.id}"]`)?.textContent
      || (() => {
        let ancestor = element.parentElement;
        for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
          const text = ancestor.innerText || '';
          if (/boost|bid.*connect|connect.*bid/i.test(text)) return text;
        }
        return '';
      })()
      || '',
    ).replace(/\s+/g, ' ').trim(),
    value: element.value || '',
  })).filter((item) => item.type === 'number' && /boost|bid.*connect|connect.*bid/i.test(item.label)));
  return { available: mentionsBoost && candidates.length > 0, mentionsBoost, candidates };
}

export async function verifyFilledApplicationForm(page, application) {
  const basis = pricingBasis(application);
  const after = await extractProposalForm(page);
  const observedPrice = basis === 'fixed' ? after.fixedPrice : after.bidRate;
  const actualPrice = number(String(observedPrice || '').replace(/[^\d.]/g, ''));
  const expectedPrice = number(basis === 'fixed' ? application.terms.fixedPrice : application.terms.hourlyRate);
  if (actualPrice !== expectedPrice) {
    throw new Error(`Masked price verification failed: expected $${expectedPrice}, saw ${observedPrice}`);
  }
  if (after.durationControl && after.duration !== application.terms.duration) {
    throw new Error(`Duration verification failed: expected ${application.terms.duration}, saw ${after.duration || 'nothing selected'}`);
  }
  if (basis === 'fixed' && after.paymentMode !== application.terms.paymentMode) {
    throw new Error(`Payment mode verification failed: expected ${application.terms.paymentMode}, saw ${after.paymentMode}`);
  }
  if (after.submitAs && after.submitAs !== application.terms.submitAs) {
    throw new Error(`Submit-as verification failed: expected ${application.terms.submitAs}, saw ${after.submitAs}`);
  }
  const requestedBoost = number(application.terms.boostConnects) || 0;
  if (after.boostConnects !== requestedBoost) {
    throw new Error(`Boost verification failed: expected ${requestedBoost}, saw ${after.boostConnects}`);
  }
  const expectedTotalConnects = number(application.terms.expectedConnects) + requestedBoost;
  if (after.totalConnects == null) {
    throw new Error('Total Connects verification failed: the Send button total could not be read');
  }
  if (after.totalConnects !== expectedTotalConnects) {
    throw new Error(`Total Connects verification failed: expected ${expectedTotalConnects}, saw ${after.totalConnects}`);
  }
  const fieldValues = after.fields.map((field) => field.value);
  const expectedValues = [application.coverLetter, ...application.answers.map((item) => item.answer)];
  expectedValues.forEach((value, index) => {
    if (fieldValues[index] !== value) throw new Error(`Textarea ${index + 1} did not retain the expected value`);
  });

  const visibleMessages = await page.locator('[role="alert"], .air3-form-message').evaluateAll((elements) => elements
    .filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getBoundingClientRect().height > 0;
    })
    .map((element) => element.textContent?.trim())
    .filter(Boolean));
  const visibleErrors = visibleMessages.filter(isBlockingFormMessage);
  if (visibleErrors.length) throw new Error(`Upwork form validation failed:\n- ${visibleErrors.join('\n- ')}`);

  const sendButton = page.getByRole('button', { name: /^Send for \d+ Connects$|^Submit proposal$/ });
  const submitReady = await sendButton.isVisible().catch(() => false)
    && await sendButton.isEnabled().catch(() => false);
  if (!submitReady) throw new Error('The proposal form is not ready to submit after filling all required fields');

  return { form: after, submitReady };
}

export async function fillApplicationForm(page, application, { job = null, guard = async () => {} } = {}) {
  if (application?.status !== 'draft') {
    throw new Error(`Application status must be draft before filling; saw ${application?.status || 'missing'}`);
  }
  await guard();
  const before = await extractProposalForm(page);
  const validation = validateApplication(application, { liveForm: before, job });
  if (!validation.valid) throw new Error(`Application validation failed:\n- ${validation.errors.join('\n- ')}`);

  const basis = pricingBasis(application);
  const submitAs = application.terms.submitAs;
  const contractorInputs = page.locator('input[name="contractor-selector"]');
  if (await contractorInputs.count()) {
    const candidate = submitAs === 'freelancer'
      ? page.locator('input[name="contractor-selector"][value="true"]')
      : page.locator('input[name="contractor-selector"]:not([value="true"])');
    if (!await candidate.count()) throw new Error(`The live form cannot submit as ${submitAs}`);
    await candidate.first().check({ force: true });
  }
  if (basis === 'fixed') {
    if (application.terms.paymentMode !== 'project') {
      throw new Error('Fixed-price milestone filling is not supported; use paymentMode project or add explicit milestone terms');
    }
    await page.locator('input[name="milestoneMode"][value="default"]').check({ force: true });
    await page.waitForTimeout(250);
    const candidates = await page.locator('main input').evaluateAll((elements) => elements.map((element, index) => {
      const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const explicitLabel = element.id
        ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent
        : '';
      return {
        index,
        type: element.type || '',
        label: clean(explicitLabel || element.closest('label')?.textContent || ''),
        ariaLabel: element.getAttribute('aria-label') || '',
        context: clean(element.parentElement?.parentElement?.innerText || ''),
        value: element.value || '',
      };
    }));
    const candidate = candidates.find((input) => {
      const label = `${input.ariaLabel} ${input.label} ${input.context}`;
      return input.type === 'text'
        && /bid|project.*amount|fixed.*price|amount/i.test(label)
        && !/description|date|milestone/i.test(label);
    }) || candidates.find((input) => input.type === 'text' && /^\$?0(?:\.00)?$/.test(input.value));
    if (!candidate) throw new Error('Could not identify the fixed-price bid field; no proposal text was changed');
    await replaceMaskedRate(page.locator('main input').nth(candidate.index), application.terms.fixedPrice);
  } else {
    const rateInput = page.getByRole('textbox', { name: 'Hourly rate', exact: true });
    await replaceMaskedRate(rateInput, application.terms.hourlyRate);

    const frequency = application.terms.rateIncrease?.frequency || 'Never';
    await chooseComboboxByContext(page, RATE_INCREASE_QUESTION_PATTERN, frequency);
    if (frequency !== 'Never') {
      await chooseComboboxByCurrentValue(page, new Set(['5%', '10%', '15%', '20%', '25%']), `${application.terms.rateIncrease.percent}%`);
    }
  }

  if (before.durationControl) {
    await chooseComboboxByContext(
      page,
      DURATION_QUESTION_PATTERN,
      application.terms.duration,
    );
  }

  await guard();
  const textareas = page.locator('textarea');
  await textareas.nth(0).fill(application.coverLetter);
  for (let index = 0; index < application.answers.length; index += 1) {
    await textareas.nth(index + 1).fill(application.answers[index].answer);
  }

  await guard();
  const requestedBoost = number(application.terms.boostConnects) || 0;
  const currentForm = requestedBoost > 0 ? await extractProposalForm(page) : null;
  const existingBoostMatches = boostStateMatches(currentForm, requestedBoost);
  const boost = await detectBoost(page);
  if (requestedBoost > 0 && !existingBoostMatches) {
    if (!boost.available) throw new Error(`A ${requestedBoost}-Connect boost was requested, but this form has no controllable boost field`);
    const candidate = boost.candidates[0];
    const boostInput = page.locator('input').nth(candidate.index);
    await boostInput.fill(String(requestedBoost));
    await boostInput.press('Tab');
    const setBid = page.getByRole('button', { name: 'Set bid', exact: true });
    if (await setBid.isVisible().catch(() => false)) {
      await setBid.click();
      await page.waitForTimeout(250);
    }
  }

  await guard();
  const verified = await verifyFilledApplicationForm(page, application);
  return { ...verified, boost, validation };
}

export function confirmationPhrase(connectsRequired, boostConnects = 0) {
  const total = Number(connectsRequired || 0) + Number(boostConnects || 0);
  return `SUBMIT ${total} CONNECTS`;
}

export async function handleSubmissionDialogs(page, { guard = async () => {} } = {}) {
  const handled = [];
  const safetyDialog = page.getByRole('dialog', { name: /Stay safe & build your reputation/i });
  await safetyDialog.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await safetyDialog.isVisible().catch(() => false)) {
    await guard();
    await safetyDialog.getByRole('checkbox', { name: /I understand Upwork.s policies/i }).check();
    await safetyDialog.getByRole('button', { name: 'Submit', exact: true }).click();
    handled.push('safety-policy');
  }

  const fixedPriceDialog = page.getByRole('dialog', { name: /3 things you need to know/i });
  await fixedPriceDialog.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await fixedPriceDialog.isVisible().catch(() => false)) {
    const checkbox = fixedPriceDialog.getByRole('checkbox', { name: /Yes, I understand/i });
    const continueButton = fixedPriceDialog.getByRole('button', { name: 'Continue', exact: true });
    if (!await checkbox.isVisible().catch(() => false)) {
      throw new Error('The fixed-price confirmation appeared without its acknowledgement checkbox');
    }
    if (!await continueButton.isVisible().catch(() => false)
      || !await continueButton.isEnabled().catch(() => false)) {
      throw new Error('The fixed-price confirmation appeared without an enabled Continue button');
    }
    await guard();
    await checkbox.check();
    await continueButton.click();
    handled.push('fixed-price');
  }
  return handled;
}

export async function submitFilledApplication(page, {
  confirmation,
  connectsRequired,
  boostConnects = 0,
  terms = {},
  guard = async () => {},
}) {
  const expected = confirmationPhrase(connectsRequired, boostConnects);
  if (confirmation !== expected) {
    throw new Error(`Submission not authorized. Pass --confirm "${expected}"`);
  }

  const sendButton = page.getByRole('button', { name: /^Send for \d+ Connects$|^Submit proposal$/ });
  if (!await sendButton.isVisible().catch(() => false) || !await sendButton.isEnabled().catch(() => false)) {
    throw new Error('The live proposal form is not ready for submission');
  }
  await guard();
  await sendButton.click();
  await handleSubmissionDialogs(page, { guard });

  await page.waitForURL(/\/nx\/proposals\/\d+\?success/, { timeout: 20_000 }).catch(() => {});
  await page.getByText('Your proposal was submitted.', { exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => {});
  const url = page.url();
  const alert = await page.getByText('Your proposal was submitted.', { exact: true }).isVisible().catch(() => false);
  const proposalId = url.match(/\/nx\/proposals\/(\d+)/)?.[1] || null;
  if (!proposalId || !alert) throw new Error(`Upwork did not return a verifiable submission success state; current URL: ${url}`);

  const pageText = await page.locator('main').innerText();
  const actualBoostConnects = Number(pageText.match(/Your bid is set to\s+(\d+)\s+Connects/i)?.[1] || boostConnects || 0);
  return {
    proposalId,
    url: `https://www.upwork.com/nx/proposals/${proposalId}`,
    success: true,
    pricingBasis: terms.pricingBasis || null,
    submitAs: terms.submitAs || null,
    paymentMode: terms.paymentMode || null,
    duration: terms.duration || null,
    hourlyRate: number(pageText.match(/Hourly rate[^$]*\$([\d,.]+)/i)?.[1]?.replaceAll(',', '')),
    fixedPrice: number(pageText.match(/Total price of project[^$]*\$([\d,.]+)/i)?.[1]?.replaceAll(',', '')),
    estimatedReceive: number(pageText.match(/You'll receive[^$]*\$([\d,.]+)/i)?.[1]?.replaceAll(',', '')),
    baseConnects: Number(connectsRequired || 0),
    boostConnects: actualBoostConnects,
    connectsSpent: Number(connectsRequired || 0) + actualBoostConnects,
    submittedAt: new Date().toISOString(),
  };
}
