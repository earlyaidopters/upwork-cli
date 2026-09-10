import { cleanText } from './util.mjs';

const COUNTRY_ALIASES = new Map([
  ['u.s.', 'United States'],
  ['u.s', 'United States'],
  ['us', 'United States'],
  ['usa', 'United States'],
  ['u.s.a', 'United States'],
  ['united states', 'United States'],
  ['united states of america', 'United States'],
  ['ca', 'Canada'],
  ['can', 'Canada'],
  ['canada', 'Canada'],
  ['uk', 'United Kingdom'],
  ['u.k', 'United Kingdom'],
  ['united kingdom', 'United Kingdom'],
]);

export function canonicalLocation(value) {
  const cleaned = cleanText(value).replace(/^the\s+/i, '').replace(/[.]+$/, '').trim();
  const alias = COUNTRY_ALIASES.get(cleaned.toLowerCase());
  if (alias) return alias;
  if (/^[a-z]{2}$/i.test(cleaned)) return new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(cleaned.toUpperCase()) || cleaned;
  return cleaned;
}

export function extractLocationRequirement(text) {
  const compact = cleanText(text);
  const citizenship = compact.match(/\b(?:[A-Z.]+\s+)?citizens?\s+only\b|\bmust\s+be\s+(?:a\s+)?(?:[A-Z.]+\s+)?citizen\b/i);
  if (citizenship) return { locationScope: 'unknown', locationRestriction: 'Citizenship requirement needs manual verification', allowedLocations: [] };
  // Explicit body/title restrictions override a generic Worldwide location label.
  const country = '(?:U\\.S\\.A?\\.?|USA?|United States(?: of America)?|Canada|United Kingdom|UK|U\\.K\\.?)';
  const hardPatterns = [
    new RegExp(`\\b(${country})[ -]+(?:residents?|freelancers?|applicants?|candidates?)\\s+only\\b`, 'i'),
    new RegExp(`\\b(${country})[ -]+only\\b`, 'i'),
    new RegExp(`\\bonly\\s+(?:accepting\\s+)?(?:freelancers?|applicants?|candidates?)\\s+(?:based|located|residing)\\s+in\\s+(?:the\\s+)?(${country})(?=[\\s.;!)]|$)(?!\\s+(?:or|and)\\b)`, 'i'),
    new RegExp(`\\bmust\\s+(?:be|reside|live)\\s+(?:(?:based|located)\\s+)?in\\s+(?:the\\s+)?(${country})(?=[\\s.;!)]|$)(?!\\s+(?:or|and)\\b)`, 'i'),
  ];
  for (const pattern of hardPatterns) {
    const match = compact.match(pattern);
    if (match) return {
      locationScope: 'restricted',
      locationRestriction: match[0],
      allowedLocations: [canonicalLocation(match[1])],
    };
  }
  const restricted = compact.match(/Only freelancers located in\s+(.+?)\s+may apply\.?/i);
  if (restricted) {
    const locations = restricted[1].split(/\s*(?:,|\bor\b|\band\b)\s*/i).map(canonicalLocation).filter(Boolean);
    return {
      locationScope: 'restricted',
      locationRestriction: cleanText(restricted[0]),
      allowedLocations: locations,
    };
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
  const country = canonicalLocation(freelancerCountry);
  if (!country) return null;
  return requirement.allowedLocations.some((location) => canonicalLocation(location).toLowerCase() === country.toLowerCase());
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
