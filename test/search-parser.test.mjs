import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { findChromeExecutable } from '../src/browser.mjs';
import { extractSearchJobs, normalizeRawJob, parserWarnings, searchCardToRaw } from '../src/scrape.mjs';

// Synthetic cards mirroring Upwork's search markup. The first uses the current
// multi-token data-test values; the second uses the earlier single-token values.
const CURRENT_CARD = `
<article data-test="JobTile" data-ev-job-uid="1111111111111111201" data-ev-position="1">
  <div data-test="JobTile15in24Header">
    <div data-test="job-pubilshed-date UpCBadge">Posted 3 days ago · Proposals: Fewer than 5</div>
  </div>
  <h2><a data-test="job-tile-title-link UpCLink" href="/jobs/Synthetic-Workflow-Build_~021111111111111111201/">Synthetic n8n Workflow Build</a></h2>
  <ul data-test="JobInfo">
    <li data-test="job-type-label">Fixed price</li>
    <li data-test="experience-level">Intermediate</li>
    <li data-test="is-fixed-price">Est. budget: $1,250.00</li>
  </ul>
  <div data-test="UpCLineClamp JobDescription"><p>Connect a form to a CRM with a review step.</p></div>
  <div data-test="TokenClamp JobAttrs"><span data-test="token">n8n</span><span data-test="token">API Integration</span></div>
  <ul data-test="JobInfoClient">
    <li data-test="payment-verified">Verified Payment verified</li>
    <li data-test="total-feedback">Rating is 0 out of 5. No feedback yet</li>
    <li data-test="total-spent">$0 spent</li>
    <li data-test="location">Location Germany</li>
  </ul>
</article>`;

const EARLIER_CARD = `
<article data-test="JobTile" data-test-key="1111111111111111202" data-ev-position="2">
  <div data-test="job-pubilshed-date">Posted 2 hours ago</div>
  <h2><a data-test="job-tile-title-link UpLink" href="/jobs/Synthetic-Agent_~021111111111111111202/">Synthetic AI Agent Engineer</a></h2>
  <span data-test="proposals-tier">Proposals: 10 to 15</span>
  <ul>
    <li data-test="job-type-label">Hourly: $60.00 - $90.00</li>
    <li data-test="experience-level">Expert</li>
    <li data-test="duration-label">Est. time: 1 to 3 months</li>
  </ul>
  <div data-test="payment-verified">Payment verified</div>
  <div data-test="total-feedback">Rating is 4.9 out of 5.</div>
  <div data-test="total-spent">$20K+ spent</div>
  <div data-test="location">Location Canada</div>
</article>`;

const chrome = await findChromeExecutable().catch(() => null);

test('parses current and earlier search-card markup in a real browser', { skip: !chrome && 'Chrome not installed' }, async () => {
  const browser = await chromium.launch({ executablePath: chrome });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>${CURRENT_CARD}${EARLIER_CARD}</main>`);
    const [current, earlier] = await extractSearchJobs(page, { source: 'search', query: 'synthetic', page: 1 });
    assert.equal(current.uid, '1111111111111111201');
    assert.equal(current.title, 'Synthetic n8n Workflow Build');
    assert.equal(current.posted, '3 days ago');
    assert.equal(current.proposals, 'Fewer than 5');
    assert.equal(current.fixedBudget, 1250);
    assert.equal(current.clientRating, null);
    assert.equal(current.clientSpend, 0);
    assert.equal(current.clientCountry, 'Germany');
    assert.deepEqual(current.skills, ['n8n', 'API Integration']);
    assert.equal(current.paymentVerified, true);
    assert.equal(earlier.uid, '1111111111111111202');
    assert.equal(earlier.title, 'Synthetic AI Agent Engineer');
    assert.equal(earlier.proposals, '10 to 15');
    assert.deepEqual([earlier.hourlyMin, earlier.hourlyMax], [60, 90]);
    assert.equal(earlier.clientRating, 4.9);
    assert.deepEqual(parserWarnings([current, earlier], { minimumCards: 1 }), []);
  } finally {
    await browser.close();
  }
});

test('falls back to the card header for posted time and proposal count', () => {
  const raw = searchCardToRaw({ posted: '', header: 'Posted 13 minutes ago · Proposals: 20 to 50', proposals: '' });
  assert.equal(raw.posted, 'Posted 13 minutes ago');
  const job = normalizeRawJob({ ...raw, uid: '1111111111111111203', title: 'Synthetic' });
  assert.equal(job.posted, '13 minutes ago');
  assert.equal(job.proposalsMax, 50);
});

test('warns when most cards lose a field so a markup change is not silent', () => {
  const healthy = { title: 'Synthetic', posted: '1 hour ago', proposals: 'Fewer than 5', jobType: 'Hourly', clientCountry: 'Canada' };
  const blankTitles = Array.from({ length: 10 }, () => ({ ...healthy, title: '' }));
  assert.deepEqual(parserWarnings(blankTitles), ['title missing on 10/10 cards']);
  assert.deepEqual(parserWarnings(Array.from({ length: 10 }, () => healthy)), []);
  assert.deepEqual(parserWarnings(blankTitles.slice(0, 3)), []);
});
