import fs from 'node:fs/promises';
import Table from 'cli-table3';
import { csvCell, writeAtomic } from './util.mjs';

const FIELDS = [
  'score', 'lane', 'uid', 'title', 'posted', 'proposals', 'jobType', 'hourlyMin', 'hourlyMax',
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
    head: ['#', 'Score', 'Job', 'Budget', 'Posted', 'Props', 'Client', 'Lane / query'],
    colWidths: [4, 7, 47, 16, 14, 12, 21, 19],
    wordWrap: true,
    style: { head: ['green'], border: ['grey'] },
  });
  jobs.forEach((job, index) => {
    const eligibility = eligibilityLabel(job);
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
      [job.lane, job.query || job.feedName].filter(Boolean).join('\n'),
    ]);
  });
  return table.toString();
}

export function serializeJobs(jobs, format = 'table') {
  if (format === 'json') return `${JSON.stringify(jobs, null, 2)}\n`;
  if (format === 'jsonl') return jobs.map(job => `${JSON.stringify(job)}\n`).join('');
  if (format === 'csv') {
    return `${FIELDS.join(',')}\n${jobs.map((job) => FIELDS.map((field) => csvCell(job[field])).join(',')).join('\n')}\n`;
  }
  if (format === 'markdown' || format === 'md') {
    const lines = jobs.map((job, index) => [
      `## ${index + 1}. ${job.title}`,
      '',
      `- Score: **${job.score ?? 0}**${job.laneLabel ? ` · Lane: ${job.laneLabel}` : ''}`,
      `- Budget: ${compactJobType(job) || 'Not listed'}`,
      `- Posted: ${job.posted || 'Unknown'} · Proposals: ${job.proposals || 'Unknown'}`,
      `- Client: ${job.paymentVerified ? 'Payment verified' : 'Payment not confirmed'} · ${money(job.clientSpend) || 'No spend shown'} · ${job.clientCountry || 'Unknown'}`,
      `- Eligibility: ${eligibilityLabel(job)}${job.locationRestriction ? ` (${job.locationRestriction})` : ''}`,
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

export function eligibilityLabel(job) {
  if (job.eligibleForProfile === false) return 'LOCATION BLOCKED';
  if (job.eligibleForProfile === true && job.detailInspectedAt) return 'location eligible';
  return 'location unknown';
}
