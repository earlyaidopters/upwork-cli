import { fileURLToPath } from 'node:url';
import { locationEligibility } from './eligibility.mjs';
import { ageHours, cleanText, parseMoney, parseRating, proposalMaximum } from './util.mjs';

export const DURATION_QUESTION_PATTERN = /How long(?: do you think)? (?:this project will|will this project) take/i;
export const PROPOSAL_COPY_PLAYBOOK = fileURLToPath(new URL('../docs/proposal-writing.md', import.meta.url));

export function boostConnectsFromInputs(mainText, inputs) {
  const mentionsBoost = /boost (?:your )?proposal|boosted proposal|bid.*connects/i.test(String(mainText || ''));
  if (!mentionsBoost) return 0;
  const candidates = (inputs || []).filter((input) => {
    const context = `${input.ariaLabel || ''} ${input.label || ''} ${input.context || ''}`;
    return input.type === 'number' && /boost|bid.*connect|connect.*bid/i.test(context);
  });
  if (candidates.length !== 1) return 0;
  return Number(candidates[0].value || 0) || 0;
}

export function resolveBoostConnects({ inputBoost = 0, totalConnects = null, baseConnects = null } = {}) {
  const total = totalConnects == null ? null : Number(totalConnects);
  const base = baseConnects == null ? null : Number(baseConnects);
  if (Number.isFinite(total) && Number.isFinite(base) && total >= base) return total - base;
  return Number(inputBoost || 0) || 0;
}

const QUESTION_FRAMEWORKS = {
  training: ['Answer in the first sentence', 'Name one real course or team', 'Say what participants built', 'Name the concrete struggle', 'Explain the teaching move that addressed it', 'Add public proof only if useful'],
  system: ['Name one recurring task', 'Define its real inputs and output', 'Build the first run together', 'Test messy input or failure', 'Have the learner run it alone', 'Keep an approval or rollback step'],
  agenda: ['Name the week-one artifact', 'List only the steps needed to build it', 'Define what the learner can do alone by the end', 'Give technical members one bounded extension'],
  tailoring: ['Start from one shared task', 'Separate only the genuinely different needs', 'Name the artifact or workflow for each group', 'Keep the same validation standard'],
  links: ['Closest public course', 'Closest implementation walkthrough', 'One portfolio page only if it adds evidence'],
  general: ['Direct answer', 'Strongest relevant real proof', 'Mechanism or decision', 'Concrete deliverable or bounded result'],
};

export function jobReference(input) {
  const raw = String(input || '').trim();
  const cipher = raw.match(/~0?2(\d{16,})/)?.[1];
  const digits = cipher || raw.match(/\b(\d{16,})\b/)?.[1];
  if (!digits) throw new Error(`Could not find an Upwork job UID in "${raw}"`);
  const ciphertext = `~02${digits}`;
  return {
    uid: digits,
    ciphertext,
    jobUrl: `https://www.upwork.com/jobs/${ciphertext}`,
    proposalUrl: `https://www.upwork.com/nx/proposals/job/${ciphertext}/apply/`,
  };
}

export async function extractJobDetail(page, options = {}) {
  await page.locator('main').waitFor({ state: 'attached', timeout: 20_000 });
  const raw = await page.locator('main').evaluate((root) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const headings = [...root.querySelectorAll('h1,h2,h3,h4')].map((el) => clean(el.textContent));
    const paragraphs = [...root.querySelectorAll('p')].map((el) => clean(el.textContent)).filter(Boolean);
    const marker = [...root.querySelectorAll('p,strong')]
      .find((el) => /asked to answer the following questions/i.test(el.textContent || ''));
    let questionList = marker?.closest('p')?.nextElementSibling;
    while (questionList && questionList.tagName !== 'UL') questionList = questionList.nextElementSibling;
    const questions = questionList
      ? [...questionList.querySelectorAll('li')].map((el) => clean(el.textContent)).filter(Boolean)
      : [];
    const summary = paragraphs.find((text) => /we('|’)re looking|we are looking|seeking|looking for/i.test(text))
      || paragraphs.sort((a, b) => b.length - a.length)[0]
      || '';
    return {
      title: headings.find((text) => !/upwork|job details/i.test(text)) || '',
      summary,
      questions,
      text: root.innerText || '',
      links: [...root.querySelectorAll('a[href]')].map((a) => a.href).filter(Boolean),
    };
  });

  const compact = cleanText(raw.text);
  const moneyRange = compact.match(/\$([\d,.]+)\s*(?:-|–|to)\s*\$([\d,.]+)/);
  const activity = {
    proposals: compact.match(/Proposals:\s*(Fewer than 5|\d+\s*(?:to\s*\d+|\+)?)/i)?.[1] || null,
    lastViewed: compact.match(/Last viewed by client:\s*([^:]+?)(?=\s*Interviewing:)/i)?.[1]?.trim() || null,
    interviewing: Number(compact.match(/Interviewing:\s*(\d+)/i)?.[1] || 0),
    invitesSent: Number(compact.match(/Invites sent:\s*(\d+)/i)?.[1] || 0),
    unansweredInvites: Number(compact.match(/Unanswered invites:\s*(\d+)/i)?.[1] || 0),
  };
  const posted = compact.match(/Posted\s+([^:]+?)(?=\s+(?:Worldwide|Only freelancers|Summary))/i)?.[1]?.trim() || null;
  const clientText = compact.match(/About the client\s+(.+?)(?=\s+Job link)/i)?.[1]?.trim() || '';
  const clientSpendLabel = clientText.match(/\$[\d,.]+\s*[KMB]?\+?\s+total spent/i)?.[0] || '';
  const eligibility = locationEligibility(compact, options.freelancerCountry);
  return {
    url: page.url(),
    title: raw.title,
    description: raw.summary,
    questions: raw.questions,
    posted,
    ageHours: ageHours(posted),
    hourlyMin: moneyRange ? Number(moneyRange[1].replaceAll(',', '')) : null,
    hourlyMax: moneyRange ? Number(moneyRange[2].replaceAll(',', '')) : null,
    activity,
    connectsRequired: Number(compact.match(/Required Connects to submit a proposal:\s*(\d+)/i)?.[1] || 0) || null,
    connectsAvailable: Number(compact.match(/Available Connects:\s*(\d+)/i)?.[1] || 0) || null,
    paymentVerified: /Payment method verified/i.test(clientText),
    phoneVerified: /Phone number verified/i.test(clientText),
    clientCountry: clientText.match(/^(\S+(?:\s+\S+){0,2})\s+\d{1,2}:\d{2}\s+(?:AM|PM)/i)?.[1] || null,
    clientRating: parseRating(clientText),
    clientSpend: parseMoney(clientSpendLabel),
    clientSpendLabel,
    clientJobsPosted: Number(clientText.match(/(\d+)\s+jobs? posted/i)?.[1] || 0),
    clientHireRate: Number(clientText.match(/(\d+)%\s+hire rate/i)?.[1] || 0),
    clientMemberSince: clientText.match(/Member since\s+(.+)$/i)?.[1]?.trim() || null,
    ...eligibility,
    rawText: raw.text,
  };
}

export async function extractProposalForm(page) {
  await page.locator('textarea').first().waitFor({ state: 'attached', timeout: 20_000 });
  const mainText = await page.locator('main').innerText();
  const fields = await page.locator('textarea').evaluateAll((elements) => elements.map((element, index) => ({
    index,
    question: String(element.parentElement?.parentElement?.innerText || element.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ')
      .trim(),
    value: element.value || '',
  })));
  const inputs = await page.locator('main input').evaluateAll((elements) => elements.map((element, index) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const explicitLabel = element.id
      ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent
      : '';
    return {
      index,
      type: element.type || '',
      name: element.name || '',
      ariaLabel: element.getAttribute('aria-label') || '',
      label: clean(explicitLabel || element.closest('label')?.textContent || ''),
      context: clean(element.parentElement?.parentElement?.innerText || ''),
      value: element.value || '',
      checked: Boolean(element.checked),
    };
  }));
  const durationMatcher = {
    source: DURATION_QUESTION_PATTERN.source,
    flags: DURATION_QUESTION_PATTERN.flags.replace('g', ''),
  };
  const comboboxes = await page.locator('main [role="combobox"]').evaluateAll((elements, matcher) => {
    const durationPattern = new RegExp(matcher.source, matcher.flags);
    return elements.map((element, index) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    let ancestor = element.parentElement;
    let context = '';
    for (let depth = 0; ancestor && depth < 5; depth += 1, ancestor = ancestor.parentElement) {
      const text = clean(ancestor.innerText);
      if (text) context = text;
      if (durationPattern.test(text)) break;
    }
    return {
      index,
      value: clean(element.innerText),
      context,
      expanded: element.getAttribute('aria-expanded') === 'true',
    };
    });
  }, durationMatcher);
  const inputValue = async (name) => page.getByRole('textbox', { name, exact: true }).inputValue().catch(() => null);
  const durationControl = comboboxes.find((item) => DURATION_QUESTION_PATTERN.test(item.context));
  const duration = durationControl && !/select.*duration/i.test(durationControl.value)
    ? durationControl.value
    : null;
  const selectedPayment = inputs.find((input) => input.name === 'milestoneMode' && input.checked);
  const paymentMode = selectedPayment?.value === 'default'
    ? 'project'
    : selectedPayment?.value === 'milestone' ? 'milestone' : null;
  const selectedContractor = inputs.find((input) => input.name === 'contractor-selector' && input.checked);
  const submitAs = selectedContractor
    ? (selectedContractor.value === 'true' ? 'freelancer' : 'agency')
    : null;
  const totalConnects = Number(mainText.match(/Send for\s+(\d+)\s+Connects/i)?.[1] || 0) || null;
  const explicitBaseConnects = Number(mainText.match(/requires\s+(\d+)\s+Connects/i)?.[1] || 0) || null;
  const boostConnects = resolveBoostConnects({
    inputBoost: boostConnectsFromInputs(mainText, inputs),
    totalConnects,
    baseConnects: explicitBaseConnects,
  });
  const connectsRequired = explicitBaseConnects
    || (totalConnects != null ? totalConnects - boostConnects : null);
  const connectsRemaining = Number(mainText.match(/have\s+(\d+)\s+Connects\s+remaining/i)?.[1] || 0) || null;
  const contractorAvailable = Number(inputs
    .map((input) => `${input.label} ${input.context}`)
    .join(' ')
    .match(/(\d+)\s+Connects available/i)?.[1] || 0) || null;
  const fixedPriceInput = inputs.find((input) => {
    const label = `${input.ariaLabel} ${input.label} ${input.context}`;
    return input.type === 'text'
      && /bid|project.*amount|fixed.*price|amount/i.test(label)
      && !/description|date/i.test(label);
  });
  return {
    url: page.url(),
    title: cleanText(await page.locator('main h3').first().innerText().catch(() => '')),
    profileRate: cleanText(mainText.match(/Your profile rate:\s*([^\n]+)/i)?.[1] || ''),
    clientBudget: cleanText(mainText.match(/Client.s budget:\s*([^\n]+)/i)?.[1] || ''),
    bidRate: await inputValue('Hourly rate'),
    fixedPrice: fixedPriceInput?.value || null,
    serviceFee: await inputValue('Freelancer Service Fee: 15%'),
    estimatedReceive: await inputValue("You'll receive"),
    connectsRequired,
    connectsRemaining,
    connectsAvailable: contractorAvailable
      || (connectsRequired && connectsRemaining ? connectsRequired + connectsRemaining : null),
    totalConnects,
    boostConnects,
    submitAs,
    paymentMode,
    duration,
    durationControl: durationControl || null,
    fields,
    inputs,
    comboboxes,
  };
}

export function classifyQuestion(question) {
  const text = String(question || '').toLowerCase();
  if (/teach|taught|training|trainer|non-developer|nontechnical|non-technical|workshop.*deliver/.test(text)) return 'training';
  if (/workflow|agent.*built|personally built|problem.*solve/.test(text)) return 'system';
  if (/structure|agenda|one-day|one day|exercise|week one|first week/.test(text)) return 'agenda';
  if (/tailor|product.*marketing|different.*function/.test(text)) return 'tailoring';
  if (/links?|github|articles?|videos?|materials?|talks?/.test(text)) return 'links';
  return 'general';
}

export function selectEvidence(question, profile, limit = 3) {
  const stopWords = new Set(['the', 'and', 'for', 'you', 'your', 'with', 'have', 'has', 'what', 'that', 'this', 'from', 'about', 'our', 'are', 'was', 'can']);
  const terms = new Set((String(question || '').toLowerCase().match(/[a-z][a-z0-9+-]{2,}/g) || []).filter(term => !stopWords.has(term)));
  return (profile.proof || [])
    .map((item) => {
      const haystack = `${item.title} ${item.summary} ${(item.tags || []).join(' ')}`.toLowerCase();
      let score = 0;
      for (const term of terms) if (haystack.includes(term)) score += term.length > 6 ? 3 : 1;
      const kind = classifyQuestion(question);
      if (kind === 'training' && item.tags?.includes('training')) score += 8;
      if (kind === 'training' && /non-developer|nontechnical|non-technical/.test(String(question).toLowerCase())
        && item.tags?.includes('nontechnical')) score += 12;
      if (kind === 'system' && (item.tags?.includes('agent') || item.tags?.includes('workflow'))) score += 8;
      if (kind === 'agenda' && item.tags?.includes('workshop')) score += 8;
      if (kind === 'tailoring' && item.tags?.includes('adoption')) score += 8;
      if (kind === 'links' && item.urls?.length) score += 5;
      return { ...item, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function assessOpportunity(job, profile) {
  const text = `${job.title || ''} ${job.description || ''}`.toLowerCase();
  const expertiseTerms = ['ai training', 'ai trainer', 'workshop', 'claude', 'workflow', 'agent', 'mcp', 'automation', 'adoption'];
  const matches = expertiseTerms.filter((term) => text.includes(term));
  let score = 45 + Math.min(30, matches.length * 4);
  const positives = [];
  const risks = [];
  if (job.eligibleForProfile === false) {
    score -= 100;
    risks.push(`Location blocked: ${job.locationRestriction || 'profile is outside the allowed location'}`);
  }
  if (matches.length) positives.push(`Topic match: ${matches.join(', ')}`);
  if (job.paymentVerified) { score += 6; positives.push('Payment method verified'); }
  if (job.phoneVerified) { score += 2; positives.push('Phone verified'); }
  if (job.activity?.lastViewed && (ageHours(job.activity.lastViewed) || 0) >= 168) {
    score -= 16;
    risks.push(`Client last viewed the job ${job.activity.lastViewed}`);
  }
  const maxProposals = proposalMaximum(job.activity?.proposals);
  if (maxProposals >= 50) { score -= 9; risks.push(`${job.activity.proposals} proposals`); }
  else if (maxProposals >= 20) { score -= 5; risks.push(`${job.activity.proposals} proposals`); }
  if (job.clientJobsPosted <= 1 && job.clientHireRate === 0) {
    score -= 8;
    risks.push('New client with no hiring history');
  }
  if (job.hourlyMax && profile.defaultHourlyRate > job.hourlyMax) {
    score -= 10;
    risks.push(`Profile rate $${profile.defaultHourlyRate}/hr exceeds the client ceiling of $${job.hourlyMax}/hr`);
  }
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    verdict: job.eligibleForProfile === false ? 'location blocked'
      : job.eligibleForProfile !== true || !job.detailInspectedAt ? 'inspect eligibility'
      : !profile.proof?.length && !profile.facts?.length ? 'add your evidence'
      : score >= 68 ? 'strong apply' : score >= 40 ? 'selective apply' : 'low priority',
    positives,
    risks,
  };
}

export function buildProposalPacket({ job, form = null, profile }) {
  const questions = form?.fields?.slice(1).map((field) => field.question).filter(Boolean)
    || job.questions
    || [];
  const assessment = assessOpportunity(job, profile);
  return {
    generatedAt: new Date().toISOString(),
    copyPlaybook: PROPOSAL_COPY_PLAYBOOK,
    job,
    form,
    profile,
    assessment,
    coverLetter: {
      targetLength: `${profile.proposalVoice?.coverLetterWordRange?.[0] || 130}–${profile.proposalVoice?.coverLetterWordRange?.[1] || 220} words`,
      structure: profile.proposalVoice?.coverLetterOrder || [
        'Open with one genuine point of resonance or the strongest relevant proof',
        'Give one concrete example or mechanism',
        'State terms directly when relevant',
        'Include the strongest proof links and stop',
      ],
      evidence: selectEvidence(`${job.title} ${job.description}`, profile, 4),
    },
    answers: questions.map((question) => ({
      question,
      kind: classifyQuestion(question),
      framework: QUESTION_FRAMEWORKS[classifyQuestion(question)],
      evidence: selectEvidence(question, profile, 3),
    })),
  };
}

export function renderProposalPacket(packet) {
  const { job, form, profile, assessment } = packet;
  const lines = [
    `# Proposal packet: ${job.title || 'Upwork job'}`,
    '',
    `- Job: ${job.url || form?.url || 'unknown'}`,
    `- Decision: **${assessment.verdict} (${assessment.score}/100)**`,
    `- Connects: ${form?.connectsRequired ?? job.connectsRequired ?? 'unknown'} required${form?.connectsRemaining != null ? `; ${form.connectsRemaining} would remain` : ''}`,
    `- Bid: ${form?.bidRate || (profile.defaultHourlyRate == null ? 'not configured' : `$${profile.defaultHourlyRate}/hr`)}${job.hourlyMax ? `; client ceiling $${job.hourlyMax}/hr` : ''}`,
    `- Required voice reference: ${packet.copyPlaybook}`,
    '',
    '## Decision signals',
    '',
    ...assessment.positives.map((item) => `- ✅ ${item}`),
    ...assessment.risks.map((item) => `- ⚠️ ${item}`),
    '',
    '## Truth and platform guardrails',
    '',
    ...(profile.truthRules || []).map((item) => `- ${item}`),
    '',
    '## Cover-letter brief',
    '',
    `Target length: ${packet.coverLetter.targetLength}`,
    '',
    ...packet.coverLetter.structure.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Evidence to draw from:',
    '',
    ...(packet.coverLetter.evidence.length ? [] : ['No matching evidence supplied. Ask for relevant work before drafting claims.']),
    ...packet.coverLetter.evidence.map((item) => `- **${item.title}:** ${item.summary} ${item.urls?.join(' ') || ''}`),
    '',
    '## the freelancer’s copy operating system',
    '',
    `Read the proposal writing guide and editing examples first: ${packet.copyPlaybook}`,
    '',
    profile.proposalVoice?.objective || 'Communicate the freelancer’s value without repeating the posting.',
    '',
    'Cadence references, not reusable templates:',
    '',
    ...(profile.proposalVoice?.cadenceExamples || []).map((item) => `- ${item}`),
    '',
    'Rejected moves:',
    '',
    ...(profile.proposalVoice?.rejectedMoves || []).map((item) => `- ${item}`),
    '',
    '## Screening questions',
    '',
  ];
  packet.answers.forEach((answer, index) => {
    lines.push(`### ${index + 1}. ${answer.question}`, '', `Framework: ${answer.framework.join(' → ')}`, '', 'Best evidence:', '');
    answer.evidence.forEach((item) => lines.push(`- **${item.title}:** ${item.summary} ${item.urls?.join(' ') || ''}`));
    lines.push('', 'Draft:', '', '_Write the direct answer here. Every claim must be supported by the profile evidence above._', '');
  });
  lines.push(
    '## Paste-ready drafting prompt',
    '',
    'Draft one concise cover letter and a separate answer to every screening question. Follow the profile’s voice: direct, confident, colloquial, and specific. The cover letter must communicate the freelancer’s value rather than prove that you understood the posting. Open with one genuine point of resonance or the strongest relevant proof. Put the best role-specific evidence inside the first three sentences. Use only facts and proof in this packet. Every sentence must add evidence, a mechanism, a decision, a constraint, a term, or a next step. Use short bridge sentences where the logic needs them, but never add empathy filler. Do not mirror the client’s problem, invent personas, write a generic biography, recycle the cadence examples as templates, or add a defensive budget exit. Answer each screening question in its first sentence, then support it with one real example and the relevant mechanism. Never invent metrics, and clearly distinguish designed outcomes from measured outcomes. Read the full draft aloud and run proposal lint before review.',
    '',
  );
  return `${lines.join('\n')}\n`;
}
