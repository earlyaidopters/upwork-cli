import { object, stringList } from './validation.mjs';

// Shared signals that a posting involves AI work. Lanes that require AI context
// penalize title matches (for example "trainer") when none of these appear.
export const AI_CONTEXT_TERMS = [
  'ai', 'a.i', 'artificial intelligence', 'generative ai', 'genai', 'llm*', 'gpt*', 'chatgpt',
  'openai', 'claude', 'anthropic', 'gemini', 'copilot', 'codex', 'agentic', 'ai agent*',
  'machine learning', 'rag', 'retrieval augmented generation', 'prompt engineer*', 'langchain',
  'langgraph', 'mcp', 'chatbot*', 'vector database*', 'embedding*',
];

// Terms ending in * match as prefixes ("automat*" matches automation and automate).
// Everything else matches whole words, with an optional plural "s".
export const BUILT_IN_LANES = {
  'ai-automation': {
    label: 'AI automation',
    description: 'n8n, Make, Zapier, and AI-powered business workflows',
    titleTerms: ['automat*', 'n8n', 'make.com', 'zapier', 'workflow*', 'integration*', 'airtable', 'gohighlevel', 'ghl', 'crm'],
    contextTerms: ['n8n', 'make.com', 'zapier', 'api*', 'webhook*', 'airtable', 'hubspot', 'google sheets', ...AI_CONTEXT_TERMS],
    requireContext: false,
    priorityKeywords: ['ai automation', 'n8n', 'ai workflow', 'workflow automation', 'ai agent'],
    negativeKeywords: ['data entry', 'virtual assistant', 'cold calling'],
    queries: ['n8n automation', 'ai automation', 'make.com automation', 'zapier automation', 'ai workflow automation', 'n8n ai agent'],
  },
  'ai-agents': {
    label: 'AI agents and LLM apps',
    description: 'Agents, RAG, chatbots, MCP servers, and LLM integrations',
    titleTerms: ['ai agent*', 'agentic', 'llm*', 'rag', 'chatbot*', 'mcp', 'langchain', 'langgraph', 'openai', 'claude', 'gpt*', 'ai developer', 'ai engineer', 'voice agent*', 'multi-agent'],
    contextTerms: AI_CONTEXT_TERMS,
    requireContext: false,
    priorityKeywords: ['ai agent', 'rag', 'mcp server', 'multi-agent', 'claude code', 'llm integration'],
    negativeKeywords: ['data annotation', 'data labeling'],
    queries: ['ai agent development', 'rag chatbot', 'mcp server', 'llm integration', 'multi-agent system', 'claude code'],
  },
  'ai-apps': {
    label: 'AI-built apps and MVPs',
    description: 'Full-stack apps, SaaS MVPs, and prototypes built fast with AI coding tools',
    titleTerms: ['mvp', 'saas', 'web app*', 'mobile app*', 'full stack', 'full-stack', 'prototype*', 'next.js', 'nextjs', 'react', 'supabase', 'lovable', 'bolt', 'cursor', 'vibe cod*'],
    contextTerms: ['supabase', 'vercel', 'next.js', 'react', 'stripe', 'firebase', 'typescript', ...AI_CONTEXT_TERMS],
    requireContext: false,
    priorityKeywords: ['ai app', 'saas mvp', 'claude code', 'cursor', 'lovable', 'supabase'],
    negativeKeywords: ['wordpress theme', 'shopify theme'],
    queries: ['saas mvp', 'ai app development', 'supabase next.js', 'lovable app', 'cursor developer', 'ai mvp'],
  },
  'ai-training': {
    label: 'AI training and workshops',
    description: 'Teaching teams to use AI tools through workshops, courses, and coaching',
    titleTerms: ['trainer*', 'training', 'workshop*', 'coach*', 'mentor*', 'facilitator*', 'instructional', 'instructor*', 'enablement', 'adoption', 'course*', 'teach*', 'tutor*'],
    contextTerms: AI_CONTEXT_TERMS,
    requireContext: true,
    priorityKeywords: ['ai trainer', 'ai training', 'claude trainer', 'copilot trainer', 'ai workshop', 'ai adoption', 'prompt engineering'],
    negativeKeywords: ['data annotation', 'data labeling', 'rlhf'],
    titlePenalties: [{
      match: '\\b(model training|training data|train(?:ing)? (?:an? )?model|computer vision|ai training data)\\b',
      unless: '\\b(trainer|workshop|coach|mentor|facilitator|instructional|learning content)\\b',
      points: -15,
      reason: 'model/data training rather than human enablement',
    }],
    queries: ['ai trainer', 'ai training', 'claude trainer', 'copilot trainer', 'ai workshop', 'ai adoption consultant', 'ai workflow coach'],
  },
  'ai-consulting': {
    label: 'AI strategy and consulting',
    description: 'Advisory, roadmaps, audits, and fractional AI leadership',
    titleTerms: ['consultant*', 'consulting', 'consultation', 'advisor*', 'adviser*', 'strategist*', 'strategy', 'fractional', 'audit*', 'implementation', 'roadmap*'],
    contextTerms: AI_CONTEXT_TERMS,
    requireContext: true,
    priorityKeywords: ['ai consultant', 'ai strategy', 'ai implementation', 'fractional ai', 'ai audit', 'responsible ai'],
    negativeKeywords: [],
    queries: ['ai consultant', 'generative ai consultant', 'ai implementation consultant', 'fractional ai leader', 'ai strategy'],
  },
  'ai-creative': {
    label: 'AI content and creative',
    description: 'AI video, images, voice, and content production',
    titleTerms: ['ai video*', 'ai image*', 'ai art*', 'ai voice*', 'ai content', 'ai ugc', 'ai avatar*', 'midjourney', 'runway', 'heygen', 'elevenlabs', 'kling', 'veo', 'sora', 'prompt engineer*'],
    contextTerms: ['midjourney', 'runway', 'heygen', 'elevenlabs', 'stable diffusion', 'comfyui', 'kling', 'veo', 'sora', ...AI_CONTEXT_TERMS],
    requireContext: false,
    priorityKeywords: ['ai video', 'ai ugc', 'ai avatar', 'ai content'],
    negativeKeywords: ['onlyfans', 'nsfw'],
    queries: ['ai video creator', 'ai ugc', 'ai content creation', 'ai avatar video', 'ai image generation'],
  },
};

const LANE_KEYS = new Set(['label', 'description', 'titleTerms', 'contextTerms', 'requireContext', 'priorityKeywords', 'negativeKeywords', 'titlePenalties', 'queries']);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const matcherCache = new Map();

// Whole-word matching stops short terms like "rag" or "ai" matching "storage" or "email".
export function termMatcher(term) {
  const key = String(term).toLowerCase().trim();
  if (!matcherCache.has(key)) {
    const prefix = key.endsWith('*');
    const body = escapeRegex(prefix ? key.slice(0, -1) : key).replace(/\\?[ -]/g, '[\\s-]+');
    const pattern = prefix ? `(?<![a-z0-9])${body}` : `(?<![a-z0-9])${body}(?:e?s)?(?![a-z0-9])`;
    matcherCache.set(key, new RegExp(pattern, 'i'));
  }
  return matcherCache.get(key);
}

export function matchesTerm(text, term) {
  return termMatcher(term).test(text);
}

export function validateLane(lane, label) {
  object(lane, label);
  for (const key of Object.keys(lane)) {
    if (!LANE_KEYS.has(key)) throw new Error(`${label}.${key} is not a lane field. Allowed: ${[...LANE_KEYS].join(', ')}.`);
  }
  if (typeof lane.label !== 'string' || !lane.label.trim()) throw new Error(`${label}.label must be a non-empty string.`);
  stringList(lane.titleTerms, `${label}.titleTerms`);
  if (!lane.titleTerms.length) throw new Error(`${label}.titleTerms must include at least one term.`);
  stringList(lane.queries, `${label}.queries`);
  if (!lane.queries.length) throw new Error(`${label}.queries must include at least one search.`);
  for (const key of ['contextTerms', 'priorityKeywords', 'negativeKeywords']) {
    if (lane[key] !== undefined) stringList(lane[key], `${label}.${key}`);
  }
  if (lane.requireContext !== undefined && typeof lane.requireContext !== 'boolean') {
    throw new Error(`${label}.requireContext must be true or false.`);
  }
  for (const [index, penalty] of (lane.titlePenalties || []).entries()) {
    object(penalty, `${label}.titlePenalties[${index}]`);
    for (const key of ['match', 'unless']) {
      if (penalty[key] === undefined) continue;
      try { new RegExp(penalty[key], 'i'); } catch (error) {
        throw new Error(`${label}.titlePenalties[${index}].${key} is not a valid pattern: ${error.message}`);
      }
    }
    if (!Number.isFinite(penalty.points)) throw new Error(`${label}.titlePenalties[${index}].points must be a number.`);
  }
  return lane;
}

export function laneCatalog(config = {}) {
  return { ...BUILT_IN_LANES, ...(config.customLanes || {}) };
}

// No selection means every lane competes; setup narrows this to the member's work.
export function resolveLanes(config = {}) {
  const catalog = laneCatalog(config);
  const selected = config.lanes?.length ? config.lanes : Object.keys(catalog);
  return selected.map((id) => {
    const lane = catalog[id];
    if (!lane) throw new Error(`Unknown lane "${id}". Available: ${Object.keys(catalog).join(', ')}`);
    return { id, contextTerms: [], priorityKeywords: [], negativeKeywords: [], titlePenalties: [], requireContext: false, ...lane };
  });
}

export function parseLaneSelection(value, config = {}) {
  const catalog = laneCatalog(config);
  const ids = Object.keys(catalog);
  const picked = String(value || '').split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    if (/^\d+$/.test(item) && ids[Number(item) - 1]) return ids[Number(item) - 1];
    if (catalog[item]) return item;
    throw new Error(`Unknown lane "${item}". Available: ${ids.join(', ')}`);
  });
  return [...new Set(picked)];
}

export function lanePresets(config = {}) {
  const lanes = resolveLanes(config);
  const presets = Object.fromEntries(lanes.map((lane) => [lane.id, { queries: lane.queries }]));
  presets.lanes = { queries: [...new Set(lanes.flatMap((lane) => lane.queries))] };
  return { ...presets, ...(config.presets || {}) };
}
