import { writeAtomic } from './util.mjs';

function operationNames(postData) {
  if (!postData) return [];
  try {
    const parsed = JSON.parse(postData);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.flatMap((value) => {
      if (value?.operationName) return [String(value.operationName)];
      const match = String(value?.query || '').match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/);
      return match ? [match[1]] : [];
    });
  } catch {
    return [];
  }
}

function sanitizedUrl(value) {
  try {
    const url = new URL(value);
    const allowed = new Set(['page', 'per_page', 'sort', 'q', 'topic_id', 'job_type']);
    const params = {};
    for (const [key, item] of url.searchParams.entries()) {
      params[key] = allowed.has(key) ? item : '<redacted>';
    }
    return { origin: url.origin, path: url.pathname, params };
  } catch {
    return { origin: '', path: String(value), params: {} };
  }
}

export function startSanitizedTrace(page) {
  const entries = [];
  const byRequest = new WeakMap();
  const onRequest = (request) => {
    const url = sanitizedUrl(request.url());
    if (!url.origin.includes('upwork.com')) return;
    const entry = {
      timestamp: new Date().toISOString(),
      method: request.method(),
      resourceType: request.resourceType(),
      ...url,
      operations: operationNames(request.postData()),
      status: null,
    };
    entries.push(entry);
    byRequest.set(request, entry);
  };
  const onResponse = (response) => {
    const entry = byRequest.get(response.request());
    if (entry) entry.status = response.status();
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  return {
    entries,
    stop() {
      page.off('request', onRequest);
      page.off('response', onResponse);
      const unique = new Map();
      for (const entry of entries) {
        const key = JSON.stringify([entry.method, entry.path, entry.operations, entry.params]);
        const previous = unique.get(key);
        unique.set(key, previous
          ? { ...previous, count: (previous.count || 1) + 1, status: entry.status ?? previous.status }
          : { ...entry, count: 1 });
      }
      return [...unique.values()].sort((a, b) => b.count - a.count);
    },
  };
}

export async function saveTrace(filePath, entries, metadata = {}) {
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    privacy: 'Headers, cookies, tokens, request variables, and response bodies are intentionally excluded.',
    metadata,
    requests: entries,
  };
  await writeAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}
