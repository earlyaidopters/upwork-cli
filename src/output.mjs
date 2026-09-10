import fs from 'node:fs/promises';
import Table from 'cli-table3';
import { csvCell, writeAtomic } from './util.mjs';

const FIELDS = [
  'score', 'uid', 'title', 'posted', 'proposals', 'jobType', 'hourlyMin', 'hourlyMax',
  'fixedBudget', 'paymentVerified', 'clientRating', 'clientSpend', 'clientCountry',
  'locationScope', 'locationRestriction', 'eligibleForProfile', 'detailInspectedAt',
  'experienceLevel', 'duration', 'skills', 'description', 'url', 'query', 'source',
];

function money(value) {
  return value == null ? '' : `$${Number(value).toLocaleString('en-US')}`;
}

function compactJobType(job) {
  if (job.hourlyMax != null) return `$${job.hourlyMin ?? job.hourlyMax}–$${job.hourlyMax}/h`;
  if (job.fixedBudget != null) return `${money(job.fixedBudget)} fixed`;
  return job.jobType || '';
}

function truncate(value, width) {
  const text = String(value || '');
  return text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text;
}

export function renderTable(jobs) {
  const table = new Table({
    head: ['#', 'Score', 'Job', 'Budget', 'Posted', 'Props', 'Client', 'Query'],
    colWidths: [4, 7, 47, 16, 14, 12, 21, 19],
    wordWrap: true,
    style: { head: ['green'], border: ['grey'] },
  });
  jobs.forEach((job, index) => {
    const eligibility = job.eligibleForProfile === false
      ? 'LOCATION BLOCKED'
      : (job.detailInspectedAt ? 'location checked' : 'location unknown');
    const client = [job.paymentVerified ? '✓' : '○', money(job.clientSpend), job.clientCountry, eligibility]
      .filter(Boolean).join(' ');
    table.push([
      index + 1,
      job.score ?? '',
      `${job.title}\n${job.url}`,
      compactJobType(job),
      job.posted || '',
      job.proposals || '',
      truncate(client, 32),
      job.query || job.feedName || '',
    ]);
  });
  return table.toString();
}

export function serializeJobs(jobs, format = 'table') {
  if (format === 'json') return `${JSON.stringify(jobs, null, 2)}\n`;
  if (format === 'jsonl') return `${jobs.map((job) => JSON.stringify(job)).join('\n')}\n`;
  if (format === 'csv') {
    return `${FIELDS.join(',')}\n${jobs.map((job) => FIELDS.map((field) => csvCell(job[field])).join(',')).join('\n')}\n`;
  }
  if (format === 'markdown' || format === 'md') {
    const lines = jobs.map((job, index) => [
      `## ${index + 1}. ${job.title}`,
      '',
      `- Score: **${job.score ?? 0}**`,
      `- Budget: ${compactJobType(job) || 'Not listed'}`,
      `- Posted: ${job.posted || 'Unknown'} · Proposals: ${job.proposals || 'Unknown'}`,
      `- Client: ${job.paymentVerified ? 'Payment verified' : 'Payment unverified'} · ${money(job.clientSpend) || 'No spend shown'} · ${job.clientCountry || 'Unknown'}`,
      `- Eligibility: ${job.eligibleForProfile === false ? `Blocked (${job.locationRestriction || 'location restriction'})` : (job.detailInspectedAt ? `${job.locationRestriction || 'No hard restriction found'} · checked` : 'Unknown · full detail not inspected')}`,
      `- Skills: ${(job.skills || []).join(', ') || 'None listed'}`,
      `- Why it ranked: ${(job.reasons || []).slice(0, 6).join('; ') || 'No score explanation'}`,
      '',
      job.description || '',
      '',
      `[Open job](${job.url})`,
      '',
    ].join('\n'));
    return `# Upwork job results\n\n${lines.join('\n')}`;
  }
  return `${renderTable(jobs)}\n`;
}

export async function outputJobs(jobs, options = {}) {
  const format = options.format || (options.output ? 'json' : 'table');
  const content = serializeJobs(jobs, format);
  if (options.output) {
    await writeAtomic(options.output, content);
    return { path: options.output, format, count: jobs.length };
  }
  process.stdout.write(content);
  return { path: null, format, count: jobs.length };
}

export async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}
