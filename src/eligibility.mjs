import { cleanText } from './util.mjs';

const COUNTRY_ALIASES = new Map([
  ['u.s.', 'United States'],
  ['u.s', 'United States'],
  ['us', 'United States'],
  ['usa', 'United States'],
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
  return COUNTRY_ALIASES.get(cleaned.toLowerCase()) || cleaned;
}

export function extractLocationRequirement(text) {
  const compact = cleanText(text);
  // Explicit body/title restrictions override a generic Worldwide location label.
  const country = '(?:U\\.S\\.A?\\.?|USA?|United States(?: of America)?|Canada|United Kingdom|UK|U\\.K\\.?)';
  const hardPatterns = [
    new RegExp(`\\b(${country})[ -]+(?:residents?|citizens?|freelancers?|applicants?|candidates?)\\s+only\\b`, 'i'),
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
  if (requirement.locationScope !== 'restricted') return null;
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
