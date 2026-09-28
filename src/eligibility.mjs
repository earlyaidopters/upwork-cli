import { cleanText } from './util.mjs';
import { findLocations, LOCATION_SOURCE, REGIONS, resolveLocation } from './regions.mjs';

const displayNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

export function canonicalLocation(value) {
  const cleaned = cleanText(value).replace(/^the\s+/i, '').replace(/[.]+$/, '').trim();
  const known = resolveLocation(cleaned);
  if (known) return known.name;
  if (/^[a-z]{2}$/i.test(cleaned)) return displayNames.of(cleaned.toUpperCase()) || cleaned;
  return cleaned;
}

const SEPARATOR = String.raw`\s*(?:,|\/|&|\bor\b|\band\b)\s*(?:the\s+)?`;
const LIST = `${LOCATION_SOURCE}\\.?(?:${SEPARATOR}${LOCATION_SOURCE}\\.?)*`;
// A list that continues past what we recognize ("US or Narnia") is not a confirmed restriction.
const LIST_END = String.raw`(?!\s*(?:\/|&|\bor\b|\band\b)\s*(?:the\s+)?[a-z])`;
const NOUN = String.raw`(?:residents?|freelancers?|applicants?|candidates?|talent|contractors?|developers?|people)`;

// Explicit body/title restrictions override a generic Worldwide location label.
const HARD_PATTERNS = [
  new RegExp(String.raw`(?<![a-z])(${LIST})(?:[ -]+based)?[ -]+(?:${NOUN}\s+)?only\b`, 'i'),
  new RegExp(String.raw`\bonly\s+(?:(?:accepting|hiring|considering)\s+)?${NOUN}\s+(?:(?:who\s+are\s+)?(?:based|located|residing|living)\s+)?(?:in|from)\s+(?:the\s+)?(${LIST})${LIST_END}`, 'i'),
  new RegExp(String.raw`\bmust\s+(?:be\s+(?:based|located|residing|living)\s+in|be\s+in|reside\s+in|live\s+in|be\s+from)\s+(?:the\s+)?(${LIST})${LIST_END}`, 'i'),
];

function restriction(text, allowedLocations) {
  return { locationScope: 'restricted', locationRestriction: cleanText(text), allowedLocations };
}

export function extractLocationRequirement(text) {
  const compact = cleanText(text);
  const citizenship = compact.match(/\b(?:[A-Z.]+\s+)?citizens?\s+only\b|\bmust\s+be\s+(?:a\s+)?(?:[A-Z.]+\s+)?citizen\b/i);
  if (citizenship) return { locationScope: 'unknown', locationRestriction: 'Citizenship requirement needs manual verification', allowedLocations: [] };
  for (const pattern of HARD_PATTERNS) {
    const match = compact.match(pattern);
    if (!match) continue;
    const locations = findLocations(match[1]);
    if (locations.length && locations.every(Boolean)) return restriction(match[0], [...new Set(locations.map((item) => item.name))]);
  }
  const label = compact.match(/Only freelancers located in\s+(.+?)\s+may apply\.?/i);
  if (label) {
    const known = findLocations(label[1]).filter(Boolean).map((item) => item.name);
    // Keep unrecognized entries so eligibility stays unknown rather than blocked.
    const unrecognized = label[1]
      .replace(new RegExp(LOCATION_SOURCE, 'gi'), ' ')
      .split(/\s*(?:,|\/|&|\bor\b|\band\b)\s*/i)
      .map((item) => cleanText(item).replace(/^the\s+/i, '').replace(/[.]+$/, ''))
      .filter((item) => /[a-z]/i.test(item));
    return restriction(label[0], [...new Set([...known, ...unrecognized])]);
  }
  if (/\bWorldwide\b/i.test(compact)) {
    return {
      locationScope: 'worldwide',
      locationRestriction: 'Worldwide',
      allowedLocations: [],
    };
  }
  return {
    locationScope: 'unknown',
    locationRestriction: null,
    allowedLocations: [],
  };
}

export function evaluateLocationEligibility(requirement, freelancerCountry) {
  if (requirement.locationScope === 'worldwide') return true;
  if (requirement.locationScope !== 'restricted' || !requirement.allowedLocations?.length) return null;
  const home = resolveLocation(canonicalLocation(freelancerCountry || ''));
  if (home?.kind !== 'country') return null;
  let uncertain = false;
  for (const location of requirement.allowedLocations) {
    const allowed = resolveLocation(canonicalLocation(location));
    if (!allowed) uncertain = true;
    else if (allowed.kind === 'country' && allowed.code === home.code) return true;
    else if (allowed.kind === 'region') {
      const region = REGIONS[allowed.name];
      if (region.members.includes(home.code)) return true;
      if (region.ambiguous?.includes(home.code)) uncertain = true;
    }
  }
  return uncertain ? null : false;
}

export function locationEligibility(text, freelancerCountry, inspectedAt = new Date().toISOString()) {
  const requirement = extractLocationRequirement(text);
  return {
    ...requirement,
    eligibleForProfile: evaluateLocationEligibility(requirement, freelancerCountry),
    detailInspectedAt: inspectedAt,
  };
}

export function hydrateEligibility(job, cached, config, now = Date.now()) {
  const detail = job.detailInspectedAt ? job : cached;
  const age = now - Date.parse(detail?.detailInspectedAt || '');
  const fresh = Number.isFinite(age) && age >= 0 && age <= (config.maxDetailAgeHours ?? 24) * 3600000;
  if (!fresh) return { ...job, eligibleForProfile: null, detailInspectedAt: null };
  // Legacy records without structured allowed locations cannot be safely recomputed.
  const requirement = {
    locationScope: detail.locationScope,
    locationRestriction: detail.locationRestriction,
    allowedLocations: detail.allowedLocations || [],
  };
  if (requirement.locationScope === 'restricted' && !requirement.allowedLocations.length) {
    Object.assign(requirement, extractLocationRequirement(detail.locationRestriction || ''));
  }
  return {
    ...job,
    ...requirement,
    eligibleForProfile: evaluateLocationEligibility(requirement, config.freelancerCountry),
    eligibilityCountry: config.freelancerCountry,
    detailInspectedAt: detail.detailInspectedAt,
  };
}
