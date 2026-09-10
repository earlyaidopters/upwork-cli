import { ageHours, cleanText } from './util.mjs';

const ROLE_TERMS = [
  'trainer',
  'training',
  'workshop',
  'consultant',
  'consultation',
  'advisor',
  'coach',
  'mentor',
  'facilitator',
  'learning',
  'instructional',
  'adoption',
  'enablement',
  'implementation',
];

const AI_TERMS = [
  'artificial intelligence',
  'generative ai',
  'claude',
  'codex',
  'copilot',
  'llm',
  'agentic',
  'ai agent',
  'automation',
  'rag',
  'retrieval augmented generation',
  'prompt engineering',
  'responsible ai',
  'governance',
];

function contains(haystack, needle) {
  return haystack.includes(needle.toLowerCase());
}

function addReason(result, points, reason) {
  result.score += points;
  result.reasons.push(`${points >= 0 ? '+' : ''}${points} ${reason}`);
}

export function scoreJob(job, config, query = '') {
  const title = cleanText(job.title).toLowerCase();
  const description = cleanText(job.description).toLowerCase();
  const skills = (job.skills || []).join(' ').toLowerCase();
  const all = `${title} ${skills} ${description}`;
  const result = { ...job, score: 0, reasons: [] };
  let strongTitleFit = false;

  for (const term of ROLE_TERMS) {
    if (contains(title, term)) {
      strongTitleFit = true;
      addReason(result, 8, `role signal: ${term}`);
    }
    else if (contains(skills, term) || contains(description, term)) addReason(result, 3, `role context: ${term}`);
  }
  for (const term of AI_TERMS) {
    if (contains(title, term)) addReason(result, 5, `AI title: ${term}`);
    else if (contains(skills, term)) addReason(result, 3, `AI skill: ${term}`);
  }

  const priorityKeywords = config.ranking?.priorityKeywords || [];
  for (const keyword of priorityKeywords) {
    const normalized = keyword.toLowerCase();
    if (contains(title, normalized)) {
      strongTitleFit = true;
      addReason(result, 10, `priority title: ${keyword}`);
    }
    else if (contains(skills, normalized)) addReason(result, 5, `priority skill: ${keyword}`);
    else if (contains(description, normalized)) addReason(result, 2, `priority body: ${keyword}`);
  }

  for (const keyword of config.ranking?.negativeKeywords || []) {
    if (contains(all, keyword.toLowerCase())) addReason(result, -15, `negative: ${keyword}`);
  }

  const queryTerms = cleanText(query).toLowerCase().split(' ').filter((term) => term.length > 2);
  const matchedQueryTerms = queryTerms.filter((term) => contains(title, term));
  if (matchedQueryTerms.length) addReason(result, matchedQueryTerms.length * 3, 'query/title alignment');
  if (!strongTitleFit) addReason(result, -12, 'weak title fit for the freelancer’s consulting/training focus');
  const hasAiContext = AI_TERMS.some((term) => contains(all, term));
  if (strongTitleFit && !hasAiContext) addReason(result, -12, 'training/consulting role lacks AI context');
  const looksLikeModelTraining = /\b(model training|training data|train(?:ing)? (?:an? )?model|computer vision)\b/i.test(title);
  const looksLikeHumanEnablement = /\b(trainer|workshop|consultant|coach|mentor|facilitator|instructional|learning content)\b/i.test(title);
  if (looksLikeModelTraining && !looksLikeHumanEnablement) {
    addReason(result, -15, 'model/data training rather than human enablement');
  }

  if (job.paymentVerified) addReason(result, 6, 'payment verified');
  else addReason(result, -3, 'payment unverified');

  if (job.eligibleForProfile === false) {
    addReason(result, -100, `location blocked: ${job.locationRestriction || 'incompatible location restriction'}`);
  }

  if (job.clientRating >= 4.8) addReason(result, 4, 'strong client rating');
  if (job.clientSpend >= 100_000) addReason(result, 10, 'client spend $100K+');
  else if (job.clientSpend >= 10_000) addReason(result, 7, 'client spend $10K+');
  else if (job.clientSpend >= 1_000) addReason(result, 3, 'client spend $1K+');

  if (job.proposalsMax != null) {
    if (job.proposalsMax <= 4) addReason(result, 9, 'fewer than 5 proposals');
    else if (job.proposalsMax <= 10) addReason(result, 6, '10 or fewer proposals');
    else if (job.proposalsMax >= 999) addReason(result, -5, '50+ proposals');
  }

  const age = job.ageHours ?? ageHours(job.posted);
  if (age != null && age <= 6) addReason(result, 7, 'posted within 6 hours');
  else if (age != null && age <= 24) addReason(result, 4, 'posted within 24 hours');
  else if (age != null && age >= 24 * 7) addReason(result, -5, 'older than one week');

  const target = Number(config.ranking?.minimumHourlyTarget || 75);
  if (job.hourlyMax != null) {
    if (job.hourlyMax >= 150) addReason(result, 12, 'hourly ceiling $150+');
    else if (job.hourlyMax >= target) addReason(result, 7, `hourly ceiling meets $${target} target`);
    else if (job.hourlyMax < 25) addReason(result, -25, 'hourly ceiling below $25');
    else if (job.hourlyMax < 50) addReason(result, -18, 'hourly ceiling below $50');
  }
  if (job.fixedBudget != null) {
    if (job.fixedBudget >= 5_000) addReason(result, 10, 'fixed budget $5K+');
    else if (job.fixedBudget >= 1_000) addReason(result, 5, 'fixed budget $1K+');
    else if (job.fixedBudget < 500) addReason(result, -10, 'fixed budget below $500');
  }
  if (/expert/i.test(job.experienceLevel)) addReason(result, 4, 'expert level');
  if (job.featured) addReason(result, 2, 'featured job');

  result.reasons.sort((a, b) => Math.abs(Number(b.split(' ')[0])) - Math.abs(Number(a.split(' ')[0])));
  return result;
}

export function rankJobs(jobs, config) {
  return jobs
    .map((job) => scoreJob(job, config, job.query || ''))
    .sort((a, b) => b.score - a.score || (a.ageHours ?? Infinity) - (b.ageHours ?? Infinity));
}

export function filterJobs(jobs, options = {}) {
  const excluded = String(options.exclude || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  return jobs.filter((job) => {
    if (options.minScore != null && job.score < Number(options.minScore)) return false;
    if (options.verified && !job.paymentVerified) return false;
    if (options.minHourly != null && (job.hourlyMax ?? -Infinity) < Number(options.minHourly)) return false;
    if (options.maxProposals != null && (job.proposalsMax ?? Infinity) > Number(options.maxProposals)) return false;
    if (options.minClientSpend != null && (job.clientSpend ?? 0) < Number(options.minClientSpend)) return false;
    if (options.maxAgeHours != null && (job.ageHours ?? Infinity) > Number(options.maxAgeHours)) return false;
    if (options.eligibleOnly && job.eligibleForProfile === false) return false;
    const text = `${job.title} ${job.description} ${(job.skills || []).join(' ')}`.toLowerCase();
    if (excluded.some((term) => text.includes(term))) return false;
    return true;
  });
}
