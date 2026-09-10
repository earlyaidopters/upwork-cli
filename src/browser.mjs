import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { ensureDirectory, sleep, stateDirectory, UPWORK_ORIGIN } from './util.mjs';

const DEFAULT_TARGET = `${UPWORK_ORIGIN}/nx/find-work/best-matches`;

function chromeCandidates() {
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      path.join(process.env.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    ];
  }
  if (process.platform === 'win32') {
    return [
      path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    ];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
}

export async function findChromeExecutable() {
  if (process.env.UPWORK_JOBS_CHROME) return path.resolve(process.env.UPWORK_JOBS_CHROME);
  for (const candidate of chromeCandidates()) {
    if (!candidate) continue;
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error('Google Chrome was not found. Set UPWORK_JOBS_CHROME to its executable path.');
}

export function browserProfileDirectory(config) {
  return path.resolve(
    config.browser.profileDirectory || path.join(stateDirectory(), 'chrome-profile'),
  );
}

export function cdpEndpoint(config) {
  const port = Number(process.env.UPWORK_JOBS_PORT || config.browser.port || 9322);
  return `http://127.0.0.1:${port}`;
}

export function cdpConnectTimeout(config, env = process.env) {
  const explicit = Number(env.UPWORK_JOBS_CDP_TIMEOUT_MS);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const configured = Number(config.browser.timeoutMs || 30_000);
  return Math.max(configured, 120_000);
}

function normalizedPagePath(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

function proposalPage(value) {
  try {
    return new URL(value).origin === 'https://www.upwork.com'
      && /(?:\/nx\/proposals\/|\/freelance-jobs\/apply\/)/.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

export function selectBrowserPageIndex(pageUrls, target, { exactPage = false } = {}) {
  const expected = normalizedPagePath(target);
  const exact = pageUrls.findIndex((value) => normalizedPagePath(value) === expected);
  if (exact >= 0) return exact;
  if (exactPage || proposalPage(target)) return -1;
  return pageUrls.findIndex((value) => {
    try {
      return new URL(value).origin === 'https://www.upwork.com' && !proposalPage(value);
    } catch {
      return false;
    }
  });
}

async function endpointStatus(endpoint) {
  try {
    const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(900) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function endpointTargets(endpoint) {
  try {
    const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(900) });
    if (!response.ok) return [];
    const targets = await response.json();
    return Array.isArray(targets) ? targets : [];
  } catch {
    return [];
  }
}

async function ensurePageTarget(endpoint, target) {
  const pages = (await endpointTargets(endpoint)).filter((item) => item.type === 'page');
  if (pages.length) return pages[0];
  const response = await fetch(`${endpoint}/json/new?${encodeURIComponent(target)}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`Chrome was running without a tab and could not open one (${response.status}).`);
  return response.json();
}

export async function browserStatus(config) {
  const endpoint = cdpEndpoint(config);
  const version = await endpointStatus(endpoint);
  return {
    running: Boolean(version?.webSocketDebuggerUrl),
    endpoint,
    browser: version?.Browser || null,
    profileDirectory: browserProfileDirectory(config),
  };
}

export async function launchBrowser(config, target = DEFAULT_TARGET) {
  const existing = await browserStatus(config);
  if (existing.running) {
    await ensurePageTarget(existing.endpoint, target);
    return { ...existing, launched: false };
  }

  const executable = await findChromeExecutable();
  const profile = await ensureDirectory(browserProfileDirectory(config));
  const port = Number(new URL(cdpEndpoint(config)).port);
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    target,
  ], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const deadline = Date.now() + Number(config.browser.timeoutMs || 30_000);
  while (Date.now() < deadline) {
    const status = await browserStatus(config);
    if (status.running) {
      await ensurePageTarget(status.endpoint, target);
      return { ...status, launched: true, pid: child.pid };
    }
    await sleep(200);
  }
  throw new Error(`Chrome did not expose its local debugging endpoint at ${cdpEndpoint(config)}.`);
}

export async function connectBrowser(config, {
  target = DEFAULT_TARGET,
  launch = true,
  exactPage = false,
  allowAnyPage = false,
} = {}) {
  if (launch) await launchBrowser(config, target);
  const endpoint = cdpEndpoint(config);
  await ensurePageTarget(endpoint, target);
  const browser = await chromium.connectOverCDP(endpoint, {
    timeout: cdpConnectTimeout(config),
  });
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    throw new Error('Chrome connected, but no browser context was available.');
  }

  const pages = context.pages();
  const selectedIndex = selectBrowserPageIndex(pages.map((candidate) => candidate.url()), target, { exactPage });
  if (exactPage && selectedIndex < 0) {
    await browser.close().catch(() => {});
    throw new Error(`The exact ready browser checkpoint is not open: ${target}`);
  }
  let page = selectedIndex >= 0 ? pages[selectedIndex] : (allowAnyPage ? pages[0] : null);
  if (!page) page = await context.newPage();
  page.setDefaultTimeout(Number(config.browser.timeoutMs || 30_000));
  page.setDefaultNavigationTimeout(Number(config.browser.timeoutMs || 30_000));
  return { browser, context, page, endpoint };
}

export function classifyPageStateSignals({
  url = '',
  title = '',
  body = '',
  challengeElements = 0,
  captchaElements = 0,
  jobCards = 0,
  feedCards = 0,
} = {}) {
  const hasJobs = Number(jobCards) > 0 || Number(feedCards) > 0;
  const challengeCopy = /Cloudflare Ray ID|verify you are human|checking your browser|attention required/i;
  const cloudflare = Number(challengeElements) > 0
    || (!hasJobs && (challengeCopy.test(body) || challengeCopy.test(title)));
  const captcha = Number(captchaElements) > 0
    || (!hasJobs && /captcha|security verification/i.test(title));
  const loginPageCopy = /Log in to Upwork|Continue with (?:Google|Apple)|Don.t have an Upwork account|Sign up for Upwork/i;
  const loggedOut = /\/ab\/account-security\/login|\/signup/.test(url)
    || (!hasJobs && (loginPageCopy.test(body) || /Log In.*Upwork|Sign Up.*Upwork/i.test(title)));
  return {
    url,
    title,
    body,
    cloudflare,
    captcha,
    loggedOut,
    challengeElements: Number(challengeElements) || 0,
    captchaElements: Number(captchaElements) || 0,
    jobCards: Number(jobCards) || 0,
    feedCards: Number(feedCards) || 0,
  };
}

export async function inspectPageState(page) {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const body = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  const countVisible = async (locator) => {
    const count = await locator.count().catch(() => 0);
    let visible = 0;
    for (let index = 0; index < count; index += 1) {
      if (await locator.nth(index).isVisible().catch(() => false)) visible += 1;
    }
    return visible;
  };
  const [challengeElements, captchaElements, jobCards, feedCards] = await Promise.all([
    countVisible(page.locator([
      'iframe[src*="challenges.cloudflare.com"]',
      '#challenge-running',
      '#challenge-stage',
      '[data-testid="challenge-stage"]',
    ].join(','))),
    countVisible(page.locator([
      'iframe[src*="hcaptcha.com"]',
      'iframe[src*="recaptcha"]',
      'textarea[name="h-captcha-response"]',
      'textarea[name="g-recaptcha-response"]',
      '[data-hcaptcha-widget-id]',
    ].join(','))),
    page.locator('[data-test="JobTile"]').count().catch(() => 0),
    page.locator('section[data-ev-opening_uid]').count().catch(() => 0),
  ]);
  return classifyPageStateSignals({
    url,
    title,
    body,
    challengeElements,
    captchaElements,
    jobCards,
    feedCards,
  });
}

export async function requireUsablePage(page, { verificationSettleMs = 8_000 } = {}) {
  let state = await inspectPageState(page);
  if ((state.cloudflare || state.captcha) && verificationSettleMs > 0) {
    const deadline = Date.now() + verificationSettleMs;
    while (Date.now() < deadline && (state.cloudflare || state.captcha)) {
      await sleep(400);
      state = await inspectPageState(page);
      if (state.loggedOut) break;
    }
  }
  if (state.cloudflare || state.captcha) {
    throw new Error(
      `Upwork browser verification persisted for ${verificationSettleMs}ms `
      + `(title: "${state.title}", challenge elements: ${state.challengeElements}, CAPTCHA elements: ${state.captchaElements}). `
      + 'Complete it manually in the dedicated Chrome window, then rerun the command.',
    );
  }
  if (state.loggedOut) {
    throw new Error('The dedicated Chrome profile is not signed in. Run `upwork-jobs auth` first.');
  }
  return state;
}

export async function navigateUpwork(page, url, { waitFor } = {}) {
  if (page.url() !== url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
  await requireUsablePage(page);
  if (waitFor) {
    await page.locator(waitFor).first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {});
  }
  return requireUsablePage(page);
}

export async function disconnectBrowser(browser) {
  await browser.close().catch(() => {});
}
