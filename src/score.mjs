import { ageHours, cleanText } from './util.mjs';
import { matchesTerm, resolveLanes } from './lanes.mjs';

function addReason(result, points, reason) {
  result.score += points;
  result.reasons.push(`${points >= 0 ? '+' : ''}${points} ${reason}`);
}

function addCapped(result, matches, points, cap, label) {
  let total = 0;
  for (const term of matches) {
    const awarded = Math.min(points, cap - total);
    if (awarded <= 0) break;
    total += awarded;
    addReason(result, awarded, `${label}: ${term}`);
  }
}

// Scores the lane-specific part of fit: what the job is and whether it matches this lane.
function scoreLane(lane, text, config) {
  const result = { lane, score: 0, reasons: [], strongTitleFit: false };
  const titleMatches = lane.titleTerms.filter((term) => matchesTerm(text.title, term));
  const bodyMatches = lane.titleTerms.filter((term) => !titleMatches.includes(term)
    && (matchesTerm(text.skills, term) || matchesTerm(text.description, term)));
  if (titleMatches.length) result.strongTitleFit = true;
  addCapped(result, titleMatches, 8, 24, `${lane.label} title`);
  addCapped(result, bodyMatches, 3, 9, `${lane.label} context`);

  const contextTerms = lane.contextTerms.filter((term) => !lane.titleTerms.includes(term));
  addCapped(result, contextTerms.filter((term) => matchesTerm(text.title, term)), 5, 15, 'context title');
  addCapped(result, contextTerms.filter((term) => !matchesTerm(text.title, term) && matchesTerm(text.skills, term)), 3, 9, 'context skill');

  const priorityKeywords = [...new Set([...(config.ranking?.priorityKeywords || []), ...lane.priorityKeywords])];
  for (const keyword of priorityKeywords) {
    if (matchesTerm(text.title, keyword)) {
      result.strongTitleFit = true;
      addReason(result, 10, `priority title: ${keyword}`);
    } else if (matchesTerm(text.skills, keyword)) addReason(result, 5, `priority skill: ${keyword}`);
    else if (matchesTerm(text.description, keyword)) addReason(result, 2, `priority body: ${keyword}`);
  }

  const negativeKeywords = [...new Set([...(config.ranking?.negativeKeywords || []), ...lane.negativeKeywords])];
  for (const keyword of negativeKeywords) {
    if (matchesTerm(text.all, keyword)) addReason(result, -15, `negative: ${keyword}`);
  }

  if (!result.strongTitleFit) addReason(result, -12, `weak title fit for your lanes (best: ${lane.label})`);
  if (result.strongTitleFit && lane.requireContext && !lane.contextTerms.some((term) => matchesTerm(text.all, term))) {
    addReason(result, -12, `${lane.label} role lacks AI context`);
  }
  for (const penalty of lane.titlePenalties) {
    if (new RegExp(penalty.match, 'i').test(text.title) && !(penalty.unless && new RegExp(penalty.unless, 'i').test(text.title))) {
      addReason(result, penalty.points, penalty.reason || 'lane penalty');
    }
  }
  return result;
}

export function scoreJob(job, config, query = '', lanes = resolveLanes(config)) {
  const title = cleanText(job.title).toLowerCase();
  const description = cleanText(job.description).toLowerCase();
  const skills = (job.skills || []).join(' ').toLowerCase();
  const text = { title, description, skills, all: `${title} ${skills} ${description}` };
  const best = lanes
    .map((lane) => scoreLane(lane, text, config))
    .reduce((top, candidate) => (candidate.score > top.score ? candidate : top));
  const result = {
    ...job,
    lane: best.lane.id,
    laneLabel: best.lane.label,
    score: best.score,
    reasons: [...best.reasons],
  };

  const queryTerms = cleanText(query).toLowerCase().split(' ').filter((term) => term.length > 2);
  const matchedQueryTerms = queryTerms.filter((term) => matchesTerm(title, term));
  if (matchedQueryTerms.length) addReason(result, matchedQueryTerms.length * 3, 'query/title alignment');

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
  const lanes = resolveLanes(config);
  return jobs
    .map((job) => scoreJob(job, config, job.query || '', lanes))
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
    if (options.confirmedEligibleOnly && (job.eligibleForProfile !== true || !job.detailInspectedAt)) return false;
    if (options.eligibleOnly && job.eligibleForProfile === false) return false;
    const text = `${job.title} ${job.description} ${(job.skills || []).join(' ')}`.toLowerCase();
    if (excluded.some((term) => text.includes(term))) return false;
    return true;
  });
}
