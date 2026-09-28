// Country and region vocabulary for location restrictions. Country names come from
// the runtime's ISO 3166 data; regions follow the UN M49 groupings Upwork uses,
// plus common hiring shorthand (EU, LATAM, North America).

const displayNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
// Groupings, pseudo-codes, and deprecated duplicates (FX is an old code for France).
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ', 'FX', 'DG', 'EA', 'IC', 'CP', 'TA', 'AC']);

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const COUNTRY_NAMES = new Map();
for (const first of letters) {
  for (const second of letters) {
    const code = `${first}${second}`;
    // Skip retired codes (DD, SU, YU) that canonicalize to a current one.
    const current = Intl.getCanonicalLocales(`und-${code}`)[0].split('-')[1] === code;
    const name = current && !NOT_COUNTRIES.has(code) && displayNames.of(code);
    if (name && name !== code) COUNTRY_NAMES.set(code, name);
  }
}

// Extra spellings seen in postings. Two-letter codes are excluded from free-text
// matching, except the unambiguous ones below, so "CA residents" stays unknown.
const COUNTRY_ALIASES = {
  US: ['us', 'u.s', 'u.s.', 'usa', 'u.s.a', 'u.s.a.', 'united states of america', 'america'],
  GB: ['uk', 'u.k', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland'],
  TR: ['turkey'],
  CZ: ['czech republic'],
  KR: ['korea', 'republic of korea'],
  CI: ['ivory coast', "cote d'ivoire", 'côte d’ivoire'],
  MM: ['myanmar', 'burma'],
  CD: ['democratic republic of the congo', 'drc'],
  CG: ['republic of the congo'],
  SZ: ['swaziland'],
  MK: ['macedonia'],
  PS: ['palestine'],
  VA: ['vatican'],
  AE: ['uae', 'u.a.e'],
  NL: ['holland'],
  VN: ['viet nam'],
  RU: ['russian federation'],
};

const M49 = {
  'Northern Africa': 'DZ EG LY MA SD TN EH',
  'Eastern Africa': 'BI KM DJ ER ET KE MG MW MU YT MZ RE RW SC SO SS UG TZ ZM ZW IO TF',
  'Middle Africa': 'AO CM CF TD CG CD GQ GA ST',
  'Southern Africa': 'BW SZ LS NA ZA',
  'Western Africa': 'BJ BF CV CI GM GH GN GW LR ML MR NE NG SH SN SL TG',
  'Central Asia': 'KZ KG TJ TM UZ',
  'Eastern Asia': 'CN HK MO KP JP MN KR TW',
  'South-eastern Asia': 'BN KH ID LA MY MM PH SG TH TL VN',
  'Southern Asia': 'AF BD BT IN IR MV NP PK LK',
  'Western Asia': 'AM AZ BH CY GE IQ IL JO KW LB OM QA SA PS SY TR AE YE',
  'Eastern Europe': 'BY BG CZ HU PL MD RO RU SK UA',
  'Northern Europe': 'AX DK EE FO FI GG IS IE IM JE LV LT NO SJ SE GB',
  'Southern Europe': 'AL AD BA HR GI GR VA IT MT ME MK PT SM RS SI ES XK',
  'Western Europe': 'AT BE FR DE LI LU MC NL CH',
  'Northern America': 'BM CA GL PM US',
  Caribbean: 'AI AG AW BS BB BQ VG KY CU CW DM DO GD GP HT JM MQ MS PR BL KN LC MF VC SX TT TC VI',
  'Central America': 'BZ CR SV GT HN MX NI PA',
  'South America': 'AR BO BV BR CL CO EC FK GF GY PY PE GS SR UY VE',
  'Australia and New Zealand': 'AU NZ NF',
  Melanesia: 'FJ NC PG SB VU',
  Micronesia: 'GU KI MH FM NR MP PW',
  Polynesia: 'AS CK PF NU PN WS TK TO TV WF',
};

const codes = (...groups) => groups.flatMap((group) => (M49[group] || group).split(' '));

// Ambiguous members are countries a posting's author may or may not mean.
// They make eligibility unknown instead of confirmed either way.
export const REGIONS = {
  Africa: { members: codes('Northern Africa', 'Eastern Africa', 'Middle Africa', 'Southern Africa', 'Western Africa') },
  Asia: { members: codes('Central Asia', 'Eastern Asia', 'South-eastern Asia', 'Southern Asia', 'Western Asia'), ambiguous: codes('CY TR RU') },
  Europe: { members: codes('Eastern Europe', 'Northern Europe', 'Southern Europe', 'Western Europe'), ambiguous: codes('CY TR GE AM AZ KZ RU BY') },
  'European Union': {
    aliases: ['eu', 'e.u', 'e.u.'],
    members: codes('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'),
  },
  Oceania: { members: codes('Australia and New Zealand', 'Melanesia', 'Micronesia', 'Polynesia') },
  Americas: { members: codes('Northern America', 'Caribbean', 'Central America', 'South America') },
  'North America': { members: codes('US CA MX'), ambiguous: codes('GL BM PM') },
  'Latin America': {
    aliases: ['latam', 'latin america and the caribbean'],
    members: codes('MX GT HN SV NI CR PA CU DO PR HT CO VE EC PE BO CL AR UY PY BR'),
    ambiguous: codes('BZ GY SR GF JM TT'),
  },
  ...Object.fromEntries(Object.keys(M49).map((name) => [name, { members: codes(name) }])),
};

const normalize = (value) => String(value || '').toLowerCase().replace(/\s*&\s*/g, ' and ').replace(/\s+/g, ' ')
  .replace(/^the /, '').replace(/[.]+$/, '').trim();

const LOOKUP = new Map();
for (const [code, name] of COUNTRY_NAMES) {
  if (!LOOKUP.has(normalize(name))) LOOKUP.set(normalize(name), { kind: 'country', code, name });
}
for (const [code, aliases] of Object.entries(COUNTRY_ALIASES)) {
  for (const alias of aliases) LOOKUP.set(normalize(alias), { kind: 'country', code, name: COUNTRY_NAMES.get(code) });
}
for (const [name, region] of Object.entries(REGIONS)) {
  for (const alias of [name, ...(region.aliases || [])]) LOOKUP.set(normalize(alias), { kind: 'region', name });
}

export function resolveLocation(value) {
  return LOOKUP.get(normalize(value)) || null;
}

// Names that are also US states or cities stay out of free-text matching.
const TEXT_EXCLUDED = new Set(['georgia', 'jersey', 'guernsey', 'isle of man', 'america', 'chad', 'jordan', 'niger']);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TEXT_NAMES = [...LOOKUP.keys()]
  .filter((key) => !TEXT_EXCLUDED.has(key) && (key.length > 2 || ['us', 'uk', 'eu'].includes(key)))
  .sort((a, b) => b.length - a.length);

// One location mention: whole words only, and never the tail of "New Mexico" or "New Jersey".
export const LOCATION_SOURCE = `(?<![a-z])(?<!new )(?:${TEXT_NAMES.map((key) => escapeRegex(key).replace(/ and /g, ' (?:and|&) ').replace(/ /g, '\\s+')).join('|')})(?![a-z])`;

// "us", "uk", and "eu" only count in capitals, so "contact us only" is not a restriction.
const SHOUTED = new Set(['us', 'u.s', 'uk', 'u.k', 'eu', 'e.u']);

export function findLocations(text) {
  const matcher = new RegExp(LOCATION_SOURCE, 'gi');
  return [...String(text || '').matchAll(matcher)].map((match) => {
    const raw = match[0].replace(/\s+/g, ' ');
    if (SHOUTED.has(normalize(raw)) && raw !== raw.toUpperCase()) return null;
    return resolveLocation(raw);
  });
}
