import {
  absoluteUpworkUrl,
  ageHours,
  canonicalJobUrl,
  cleanText,
  parseMoney,
  parseRating,
  proposalMaximum,
  sleep,
  uniqueBy,
} from './util.mjs';
import { navigateUpwork, requireUsablePage } from './browser.mjs';

function rateRange(text) {
  const source = String(text || '').replaceAll(',', '');
  const hourly = source.match(/Hourly:?\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*\$?\s*(\d+(?:\.\d+)?)/i);
  if (hourly) return { hourlyMin: Number(hourly[1]), hourlyMax: Number(hourly[2]) };
  const oneRate = source.match(/Hourly:?\s*\$?\s*(\d+(?:\.\d+)?)/i);
  if (oneRate) return { hourlyMin: Number(oneRate[1]), hourlyMax: Number(oneRate[1]) };
  return { hourlyMin: null, hourlyMax: null };
}

function uidFromUrl(url) {
  return String(url || '').match(/(?:_|\/)~0?2(\d+)/)?.[1] || null;
}

export function normalizeRawJob(raw, metadata = {}) {
  const detailText = cleanText(raw.detailText || raw.fullText || '');
  const posted = cleanText(raw.posted || '').replace(/^Posted\s+/i, '');
  const proposals = cleanText(raw.proposals || '').replace(/^Proposals:\s*/i, '');
  const paymentText = cleanText(raw.payment || '');
  const spendText = cleanText(raw.clientSpend || '');
  const sourceUrl = absoluteUpworkUrl(raw.url);
  const uid = raw.uid || uidFromUrl(sourceUrl);
  const url = canonicalJobUrl(uid, raw.title) || sourceUrl;
  const rates = rateRange(raw.jobType || detailText);
  const fixedBudget = /fixed/i.test(raw.jobType || '')
    ? parseMoney(raw.budget || raw.jobType)
    : null;
  return {
    uid,
    title: cleanText(raw.title),
    url,
    source: metadata.source || raw.source || 'unknown',
    query: metadata.query || raw.query || null,
    page: metadata.page || raw.page || null,
    position: Number.isFinite(Number(raw.position)) ? Number(raw.position) : null,
    posted,
    ageHours: ageHours(posted),
    proposals,
    proposalsMax: proposalMaximum(proposals),
    description: cleanText(raw.description),
    skills: [...new Set((raw.skills || []).map(cleanText).filter(Boolean))],
    jobType: cleanText(raw.jobType),
    experienceLevel: cleanText(raw.experienceLevel),
    duration: cleanText(raw.duration),
    hourlyMin: rates.hourlyMin,
    hourlyMax: rates.hourlyMax,
    fixedBudget,
    paymentVerified: /payment verified/i.test(paymentText) && !/unverified/i.test(paymentText),
    clientRating: parseRating(raw.clientRating),
    clientSpend: parseMoney(spendText),
    clientSpendLabel: spendText,
    clientCountry: cleanText(raw.clientCountry).replace(/^Location\s*/i, ''),
    featured: Boolean(raw.featured),
    feedName: cleanText(raw.feedName),
    scrapedAt: new Date().toISOString(),
  };
}

export async function extractFeedJobs(page, metadata = {}) {
  const rows = await page.locator('section[data-ev-opening_uid]').evaluateAll((cards) => {
    const text = (root, selector) => root.querySelector(selector)?.textContent?.trim() || '';
    const texts = (root, selector) => [...root.querySelectorAll(selector)]
      .map((element) => element.textContent?.trim() || '')
      .filter(Boolean);
    return cards.map((card) => {
      const link = card.querySelector('h3 a[href^="/jobs/"], h3 a[href*="upwork.com/jobs/"]');
      return {
        uid: card.getAttribute('data-ev-opening_uid'),
        position: card.getAttribute('data-ev-position'),
        feedName: card.getAttribute('data-ev-feed_name'),
        featured: card.getAttribute('data-ev-featured') === 'true',
        title: link?.textContent || '',
        url: link?.getAttribute('href') || '',
        posted: text(card, '[data-test~="posted-on"]'),
        proposals: text(card, '[data-test~="proposals-tier"]'),
        description: text(card, '[data-test~="job-description-text"]')
          || text(card, '[data-test~="job-description-line-clamp"]'),
        skills: texts(card, 'a[data-test~="attr-item"]'),
        jobType: [
          text(card, '[data-test~="job-type"]'),
          text(card, '[data-test~="hourly-rate"]'),
          text(card, '[data-test~="budget"]'),
        ].filter(Boolean).join(' '),
        budget: text(card, '[data-test~="budget"]'),
        experienceLevel: text(card, '[data-test~="contractor-tier"]'),
        duration: text(card, '[data-test~="duration"]'),
        payment: text(card, '[data-test~="payment-verification-status"]'),
        clientRating: text(card, '[data-test~="js-feedback"]'),
        clientSpend: text(card, '[data-test~="client-spendings"]'),
        clientCountry: text(card, '[data-test~="client-country"]'),
        fullText: card.textContent || '',
      };
    });
  });
  return rows.map((row) => normalizeRawJob(row, metadata));
}

// Upwork's data-test values now carry extra tokens ("job-pubilshed-date UpCBadge",
// "job-tile-title-link UpCLink"), so every lookup matches one token with ~=.
export const SEARCH_CARD_SELECTOR = '[data-test~="JobTile"]';
export const SEARCH_CARD_FIELDS = {
  title: '[data-test~="job-tile-title-link"]',
  posted: '[data-test~="job-pubilshed-date"], [data-test~="job-published-date"]',
  header: '[data-test~="JobTile15in24Header"], [data-test~="JobTileHeader"]',
  proposals: '[data-test~="proposals-tier"]',
  description: '[data-test~="JobDescription"]',
  jobType: '[data-test~="job-type-label"]',
  budget: '[data-test~="is-fixed-price"]',
  experienceLevel: '[data-test~="experience-level"]',
  duration: '[data-test~="duration-label"]',
  payment: '[data-test~="payment-verified"]',
  clientRating: '[data-test~="total-feedback"]',
  clientSpend: '[data-test~="total-spent"]',
  clientCountry: '[data-test~="location"]',
  badges: '[data-test~="JobTileBadges"]',
  skills: '[data-test~="token"]',
};

// Runs inside the page, so it must stay self-contained. It only collects text;
// interpretation happens in searchCardToRaw, which tests can exercise directly.
export function readSearchCards(cards, fields) {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  return cards.map((card) => {
    const link = card.querySelector(fields.title)
      || card.querySelector('h2 a[href*="/jobs/"], h3 a[href*="/jobs/"], a[href*="/jobs/"][href*="~0"]');
    const row = {
      uid: card.getAttribute('data-ev-job-uid') || card.getAttribute('data-ev-opening_uid') || card.getAttribute('data-test-key'),
      position: card.getAttribute('data-ev-position'),
      title: clean(link?.textContent),
      url: link?.getAttribute('href') || '',
      skills: [...card.querySelectorAll(fields.skills)].map((element) => clean(element.textContent)).filter(Boolean),
      fullText: clean(card.textContent),
    };
    for (const [key, selector] of Object.entries(fields)) {
      if (key === 'title' || key === 'skills') continue;
      row[key] = clean(card.querySelector(selector)?.textContent);
    }
    return row;
  });
}

export function searchCardToRaw(row) {
  const header = row.posted || row.header || '';
  return {
    ...row,
    posted: (header.split(/[·•]/)[0] || '').trim(),
    proposals: row.proposals || header.match(/Proposals:\s*([^·•]+)/i)?.[1] || '',
    featured: /featured/i.test(row.badges || ''),
    clientRating: /no feedback/i.test(row.clientRating || '') ? '' : row.clientRating,
  };
}

const HEALTH_FIELDS = [
  ['title', (job) => job.title],
  ['posted time', (job) => job.posted],
  ['proposal count', (job) => job.proposals],
  ['job type', (job) => job.jobType],
  ['client details', (job) => job.clientSpendLabel || job.clientCountry],
];

// A silent markup change once blanked titles for eleven days. Flag it on the first pull instead.
export function parserWarnings(jobs, { minimumCards = 5, threshold = 0.5 } = {}) {
  if (jobs.length < minimumCards) return [];
  return HEALTH_FIELDS
    .map(([name, read]) => ({ name, missing: jobs.filter((job) => !read(job)).length }))
    .filter(({ missing }) => missing / jobs.length > threshold)
    .map(({ name, missing }) => `${name} missing on ${missing}/${jobs.length} cards`);
}

export async function extractSearchJobs(page, metadata = {}) {
  const rows = await page.locator(SEARCH_CARD_SELECTOR).evaluateAll(readSearchCards, SEARCH_CARD_FIELDS);
  return rows.map((row) => normalizeRawJob(searchCardToRaw(row), metadata));
}

export function buildSearchUrl(query, options = {}) {
  const url = new URL('/nx/search/jobs/', 'https://www.upwork.com');
  url.searchParams.set('q', query);
  url.searchParams.set('per_page', String(options.perPage || 50));
  if (options.sort === 'recent' || options.sort === 'recency') url.searchParams.set('sort', 'recency');
  if (options.page && Number(options.page) > 1) url.searchParams.set('page', String(options.page));
  if (options.hourlyMin != null) url.searchParams.set('hourly_rate', `${options.hourlyMin}-`);
  if (options.jobType === 'hourly') url.searchParams.set('job_type', 'hourly');
  if (options.jobType === 'fixed') url.searchParams.set('job_type', 'fixed');
  if (options.verified) url.searchParams.set('payment_verified', '1');
  return url.toString();
}

async function waitForSearch(page) {
  await Promise.race([
    page.locator(SEARCH_CARD_SELECTOR).first().waitFor({ state: 'attached', timeout: 20_000 }),
    page.getByText(/no jobs found|there are no results/i).first().waitFor({ state: 'visible', timeout: 20_000 }),
  ]).catch(() => {});
  await requireUsablePage(page);
  await page.waitForFunction(
    (selector) => document.querySelectorAll(selector).length > 0
      && document.querySelectorAll('[data-test~="JobsList"] .air3-skeleton-shape').length === 0,
    SEARCH_CARD_SELECTOR,
    { timeout: 12_000 },
  ).catch(() => {});
}

export async function collectSearch(page, query, options = {}) {
  const pages = Math.max(1, Number(options.pages || 1));
  const perPage = Math.min(50, Math.max(10, Number(options.perPage || 50)));
  const url = buildSearchUrl(query, { ...options, perPage, page: 1 });
  await navigateUpwork(page, url);
  await waitForSearch(page);

  const all = [];
  const warnings = new Set();
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const current = await extractSearchJobs(page, {
      source: 'search',
      query,
      page: pageNumber,
    });
    all.push(...current);
    for (const warning of parserWarnings(current)) warnings.add(warning);
    if (pageNumber >= pages) break;

    const next = page.getByRole('link', { name: 'Next page', exact: true });
    if (!(await paginationAvailable(next))) break;
    const previousFirstUid = current[0]?.uid;
    await next.click();
    await page.waitForURL(/(?:[?&])page=\d+/, { timeout: 20_000 }).catch(() => {});
    await page.waitForFunction(
      ([selector, uid]) => {
        const card = document.querySelector(selector);
        return (card?.getAttribute('data-ev-job-uid') || card?.getAttribute('data-test-key')) !== uid;
      },
      [SEARCH_CARD_SELECTOR, previousFirstUid],
      { timeout: 20_000 },
    ).catch(() => {});
    await sleep(Number(options.delayMs || 650));
    await requireUsablePage(page);
  }
  if (warnings.size) {
    process.stderr.write(
      `Warning: Upwork's search page may have changed for "${query}": ${[...warnings].join('; ')}. `
      + 'Rankings will be unreliable until the parser is updated. Please report it at https://github.com/earlyaidopters/upwork-cli/issues\n',
    );
  }
  return uniqueBy(all, 'uid');
}

export async function paginationAvailable(locator) {
  const [visible, enabled, ariaDisabled] = await Promise.all([
    locator.isVisible().catch(() => false),
    locator.isEnabled().catch(() => false),
    locator.getAttribute('aria-disabled').catch(() => null),
  ]);
  return visible && enabled && ariaDisabled !== 'true';
}

const FEED_URLS = {
  best: 'https://www.upwork.com/nx/find-work/best-matches',
  'best-matches': 'https://www.upwork.com/nx/find-work/best-matches',
  recent: 'https://www.upwork.com/nx/find-work/most-recent',
  'most-recent': 'https://www.upwork.com/nx/find-work/most-recent',
  mine: 'https://www.upwork.com/nx/find-work/',
  'my-feed': 'https://www.upwork.com/nx/find-work/',
};

export async function collectFeed(page, feed = 'best', options = {}) {
  const url = FEED_URLS[feed];
  if (!url) throw new Error(`Unknown feed "${feed}". Use best, recent, or mine.`);
  await navigateUpwork(page, url);
  await page.locator('section[data-ev-opening_uid]').first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {});
  await requireUsablePage(page);
  await page.waitForFunction(
    () => document.querySelectorAll('section[data-ev-opening_uid]').length > 0
      && document.querySelectorAll('.air3-skeleton-shape').length === 0,
    null,
    { timeout: 18_000 },
  ).catch(() => {});
  const initialCards = await page.locator('section[data-ev-opening_uid]').count();
  const remainingSkeletons = await page.locator('.air3-skeleton-shape').count();
  if (remainingSkeletons > 0 && initialCards < 5) {
    throw new Error(
      `The ${feed} feed stalled with ${initialCards} real cards and ${remainingSkeletons} loading placeholders. `
      + 'Reload the dedicated Chrome window, complete any browser check, and retry.',
    );
  }

  const batches = Math.max(0, Number(options.batches || 0));
  let stalls = 0;
  for (let batch = 0; batch < batches; batch += 1) {
    const button = page.getByRole('button', { name: 'Load More Jobs', exact: true });
    if (!(await button.isVisible().catch(() => false))) break;
    const before = await page.locator('section[data-ev-opening_uid]').count();
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await page.waitForFunction(
      (count) => document.querySelectorAll('section[data-ev-opening_uid]').length > count,
      before,
      { timeout: 15_000 },
    ).catch(() => {});
    const after = await page.locator('section[data-ev-opening_uid]').count();
    stalls = after > before ? 0 : stalls + 1;
    if (stalls >= 2) break;
    await sleep(Number(options.delayMs || 650));
    await requireUsablePage(page);
  }
  return extractFeedJobs(page, { source: `feed:${feed}`, query: null, page: 1 });
}
