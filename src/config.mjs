import fs from 'node:fs/promises';
import path from 'node:path';
import { stateDirectory, writeAtomic } from './util.mjs';

import { object, numeric, stringList } from './validation.mjs';

export const DEFAULT_CONFIG = {
  browser: {
    port: 9322,
    timeoutMs: 30_000,
    profileDirectory: null,
  },
  search: {
    perPage: 50,
    delayMs: 650,
    maxPages: 5,
    maxFeedBatches: 20,
  },
  eligibility: {
    freelancerCountry: null,
    inspectTop: 20,
    excludeIneligible: true,
    maxDetailAgeHours: 24,
  },
  ranking: {
    priorityKeywords: [
      'ai trainer',
      'ai training',
      'claude trainer',
      'copilot trainer',
      'ai consultant',
      'ai adoption',
      'ai workshop',
      'ai workflow',
      'agentic ai',
      'claude code',
      'codex',
      'rag',
      'multi-agent',
      'prompt engineering',
      'responsible ai',
    ],
    negativeKeywords: ['commission only', 'unpaid trial', 'data entry'],
    minimumHourlyTarget: 75,
  },
  presets: {
    'ai-trainers': {
      queries: [
        'ai trainer',
        'ai training',
        'claude trainer',
        'copilot trainer',
        'ai workshop',
        'ai adoption consultant',
        'ai workflow coach',
      ],
    },
    'ai-consulting': {
      queries: [
        'ai consultant',
        'generative ai consultant',
        'ai implementation consultant',
        'fractional ai leader',
        'ai strategy',
      ],
    },
    'agentic-systems': {
      queries: [
        'agentic ai',
        'ai agent development',
        'multi-agent system',
        'claude code',
        'codex',
        'mcp server',
        'rag automation',
      ],
    },
  },
};

function mergeConfig(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeConfig(base[key] || {}, value)
      : value;
  }
  return result;
}

export function configPath() {
  return process.env.UPWORK_JOBS_CONFIG
    ? path.resolve(process.env.UPWORK_JOBS_CONFIG)
    : path.join(stateDirectory(), 'config.json');
}

export async function loadConfig() {
  try {
    const data = JSON.parse(await fs.readFile(configPath(), 'utf8'));
    object(data, 'Config');
    return validateConfig(mergeConfig(DEFAULT_CONFIG, data));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(DEFAULT_CONFIG);
    throw new Error(`Could not read ${configPath()}: ${error.message}`);
  }
}

export async function initializeConfig({ force = false } = {}) {
  const destination = configPath();
  if (!force) {
    try {
      await fs.access(destination);
      return { created: false, path: destination };
    } catch {}
  }
  await writeAtomic(destination, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  return { created: true, path: destination };
}

export function validateConfig(config) {
  for (const section of ['browser', 'search', 'eligibility', 'ranking', 'presets']) object(config[section], section);
  for (const [section, key, rules] of [
    ['browser', 'port', {min: 1, max: 65535, integer: true}],
    ['browser', 'timeoutMs', {min: 1, integer: true}],
    ['search', 'delayMs', {integer: true}],
    ['search', 'maxPages', {min: 1, max: 50, integer: true}],
    ['search', 'maxFeedBatches', {integer: true}],
    ['eligibility', 'inspectTop', {integer: true}],
    ['eligibility', 'maxDetailAgeHours', {}],
    ['ranking', 'minimumHourlyTarget', {}],
  ]) config[section][key] = numeric(config[section][key], `${section}.${key}`, rules);
  if (![10, 20, 50].includes(config.search.perPage)) throw new Error('search.perPage must be 10, 20, or 50.');
  for (const [key, value] of [['browser.profileDirectory', config.browser.profileDirectory], ['eligibility.freelancerCountry', config.eligibility.freelancerCountry]]) {
    if (value !== null && (typeof value !== 'string' || !value.trim())) throw new Error(`${key} must be a non-empty string or null.`);
  }
  if (typeof config.eligibility.excludeIneligible !== 'boolean') throw new Error('eligibility.excludeIneligible must be true or false.');
  stringList(config.ranking.priorityKeywords, 'ranking.priorityKeywords');
  stringList(config.ranking.negativeKeywords, 'ranking.negativeKeywords');
  for (const [name, preset] of Object.entries(config.presets)) {
    object(preset, `presets.${name}`);
    stringList(preset.queries, `presets.${name}.queries`);
    if (!preset.queries.length) throw new Error(`presets.${name}.queries must include at least one query.`);
  }
  return config;
}
