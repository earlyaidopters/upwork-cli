export function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`${label}.${key} is not an allowed key.`);
    if (child && typeof child === 'object' && !Array.isArray(child)) object(child, `${label}.${key}`);
  }
  return value;
}

export function numeric(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const validType = typeof value === 'number' || typeof value === 'string';
  const result = Number(value);
  if (!validType || String(value).trim() === '' || !Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) {
    throw new Error(`${label} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`);
  }
  return result;
}

export function stringList(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
}

export function validateCommandOptions(options) {
  const rules = {
    pages: { min: 1, integer: true }, batches: { integer: true }, limit: { min: 1, integer: true },
    inspectTop: { integer: true }, maxProposals: { integer: true }, minScore: { min: -10000 },
    minHourly: {}, minClientSpend: {}, maxAgeHours: {}, days: { min: 1, integer: true },
    rate: { min: 0.01 }, boost: { integer: true },
  };
  for (const [key, rule] of Object.entries(rules)) {
    if (options[key] !== undefined) numeric(options[key], `--${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`, rule);
  }
  if (options.perPage !== undefined && ![10, 20, 50].includes(Number(options.perPage))) throw new Error('--per-page must be 10, 20, or 50.');
  if (options.feed !== undefined && !['best', 'recent', 'mine'].includes(options.feed)) throw new Error('Feed must be best, recent, or mine.');
  if (options.eligibleOnly && options.includeIneligible) throw new Error('--eligible-only cannot be combined with --include-ineligible.');
}
