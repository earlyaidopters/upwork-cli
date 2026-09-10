import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchUrl, normalizeRawJob, paginationAvailable } from '../src/scrape.mjs';

test('normalizes a search-card payload', () => {
  const job = normalizeRawJob({
    uid: '1111111111111111102',
    title: 'AI Trainer & AI Data Specialist',
    url: '/jobs/AI-Trainer_~021111111111111111102/?referrer_url_path=/nx/search/jobs/',
    posted: 'Posted 6 hours ago',
    proposals: 'Proposals: 15 to 20',
    jobType: 'Hourly: $70.00 - $120.00',
    payment: 'Verified Payment verified',
    clientRating: 'Rating is 5.0 out of 5.',
    clientSpend: '$100+ spent',
    clientCountry: 'Location India',
    skills: ['AI Development', 'Artificial Intelligence'],
  }, { source: 'search', query: 'ai trainer', page: 1 });

  assert.equal(job.hourlyMin, 70);
  assert.equal(job.hourlyMax, 120);
  assert.equal(job.proposalsMax, 20);
  assert.equal(job.paymentVerified, true);
  assert.equal(job.clientRating, 5);
  assert.equal(job.clientSpend, 100);
  assert.equal(job.clientCountry, 'India');
  assert.equal(job.url, 'https://www.upwork.com/jobs/~021111111111111111102/');
});

test('replaces highlighted search-result markup with a canonical title URL', () => {
  const job = normalizeRawJob({
    uid: '1111111111111111104',
    title: 'AI Agent Developer – Claude / Microsoft Copilot',
    url: '/jobs/span-class-highlight-span-Agent-Developer-Claude-Microsoft-Copilot_~021111111111111111104/',
  });
  assert.equal(
    job.url,
    'https://www.upwork.com/jobs/~021111111111111111104/',
  );
});

test('builds stable fifty-result recency URLs', () => {
  const url = new URL(buildSearchUrl('ai trainer', { perPage: 50, sort: 'recent', page: 3 }));
  assert.equal(url.searchParams.get('q'), 'ai trainer');
  assert.equal(url.searchParams.get('per_page'), '50');
  assert.equal(url.searchParams.get('sort'), 'recency');
  assert.equal(url.searchParams.get('page'), '3');
});

test('does not click a visible but disabled next-page control', async () => {
  const disabled = {
    isVisible: async () => true,
    isEnabled: async () => false,
    getAttribute: async () => 'true',
  };
  const enabled = {
    isVisible: async () => true,
    isEnabled: async () => true,
    getAttribute: async () => null,
  };
  assert.equal(await paginationAvailable(disabled), false);
  assert.equal(await paginationAvailable(enabled), true);
});
