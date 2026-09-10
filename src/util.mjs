import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const UPWORK_ORIGIN = 'https://www.upwork.com';

export function stateDirectory() {
  return path.resolve(
    process.env.UPWORK_JOBS_HOME || path.join(os.homedir(), '.upwork-jobs'),
  );
}

export async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

export function cleanText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

export function absoluteUpworkUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, UPWORK_ORIGIN);
    url.searchParams.delete('referrer_url_path');
    return url.toString();
  } catch {
    return null;
  }
}

export function canonicalJobUrl(uid) {
  const digits = String(uid || '').match(/\d+/)?.[0];
  if (!digits) return null;
  return `https://www.upwork.com/jobs/~02${digits}/`;
}

export function parseMoney(value) {
  if (!value) return null;
  const normalized = String(value).replace(/,/g, '').toUpperCase();
  const match = normalized.match(/\$?\s*(\d+(?:\.\d+)?)\s*([KMB])?/);
  if (!match) return null;
  const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[match[2]] || 1;
  return Number(match[1]) * multiplier;
}

export function parseRating(value) {
  const match = String(value || '').match(/(\d(?:\.\d+)?)\s*(?:out of 5|Stars?)/i);
  return match ? Number(match[1]) : null;
}

export function proposalMaximum(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return null;
  if (/fewer than\s*5/.test(text)) return 4;
  if (/50\+/.test(text)) return 999;
  const values = [...text.matchAll(/\d+/g)].map((match) => Number(match[0]));
  return values.length ? Math.max(...values) : null;
}

export function ageHours(value) {
  const text = String(value || '').toLowerCase();
  const number = Number(text.match(/\d+/)?.[0] || 1);
  if (text.includes('minute')) return number / 60;
  if (text.includes('hour')) return number;
  if (text.includes('yesterday')) return 24;
  if (text.includes('day')) return number * 24;
  if (text.includes('week')) return number * 24 * 7;
  if (text.includes('month')) return number * 24 * 30;
  return null;
}

export function csvCell(value) {
  const string = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

export async function writeAtomic(filePath, content) {
  await ensureDirectory(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, content, { mode: 0o600 });
  await fs.rename(temporary, filePath);
}

export function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function uniqueBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const id = typeof key === 'function' ? key(item) : item[key];
    if (!id) continue;
    if (!map.has(id)) map.set(id, item);
    else map.set(id, { ...map.get(id), ...item });
  }
  return [...map.values()];
}
