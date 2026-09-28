import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cdpConnectTimeout,
  classifyPageStateSignals,
  selectBrowserPageIndex,
} from '../src/browser.mjs';

test('allows enough time to attach to a long-lived Chrome profile', () => {
  assert.equal(cdpConnectTimeout({ browser: { timeoutMs: 30_000 } }, {}), 120_000);
  assert.equal(cdpConnectTimeout({ browser: { timeoutMs: 180_000 } }, {}), 180_000);
  assert.equal(
    cdpConnectTimeout({ browser: { timeoutMs: 30_000 } }, { UPWORK_CLI_CDP_TIMEOUT_MS: '240000' }),
    240_000,
  );
});

test('job descriptions mentioning CAPTCHA do not block a valid results page', () => {
  const state = classifyPageStateSignals({
    url: 'https://www.upwork.com/nx/search/jobs/?q=MCP',
    title: 'Search Freelance Jobs on Upwork',
    body: 'Build an MCP server that integrates a CAPTCHA provider for a customer.',
    jobCards: 50,
  });
  assert.equal(state.captcha, false);
  assert.equal(state.cloudflare, false);
  assert.equal(state.loggedOut, false);
});

test('CAPTCHA copy on a normally titled loading page is not enough to block navigation', () => {
  const state = classifyPageStateSignals({
    url: 'https://www.upwork.com/nx/search/jobs/?q=MCP',
    title: 'Search Freelance Jobs on Upwork',
    body: 'CAPTCHA integration developer job description',
    jobCards: 0,
  });
  assert.equal(state.captcha, false);
});

test('job detail copy about logging in does not masquerade as an Upwork logout', () => {
  const state = classifyPageStateSignals({
    url: 'https://www.upwork.com/jobs/~022091000000000000000',
    title: 'Create an AI Agent Skill: Bitwarden Autofill Login',
    body: 'Build a Chromium skill that can log in through Bitwarden autofill.',
    jobCards: 0,
  });
  assert.equal(state.loggedOut, false);
});

test('the real Upwork account-security login page is classified as logged out', () => {
  const state = classifyPageStateSignals({
    url: 'https://www.upwork.com/ab/account-security/login?redir=%2Fnx%2Ffind-work',
    title: 'Log In - Upwork',
    body: 'Log in to Upwork Continue with Google',
  });
  assert.equal(state.loggedOut, true);
});

test('an actual challenge page without jobs is blocked', () => {
  const state = classifyPageStateSignals({
    url: 'https://www.upwork.com/nx/search/jobs/',
    title: 'Attention Required',
    body: 'Verify you are human. Cloudflare Ray ID: abc123',
    challengeElements: 1,
    jobCards: 0,
  });
  assert.equal(state.cloudflare, true);
  assert.equal(state.challengeElements, 1);
});

test('an embedded CAPTCHA widget is blocked even before copy is visible', () => {
  const state = classifyPageStateSignals({
    url: 'https://www.upwork.com/nx/search/jobs/',
    title: 'Upwork',
    captchaElements: 1,
  });
  assert.equal(state.captcha, true);
  assert.equal(state.captchaElements, 1);
});

test('discovery never reuses a proposal tab', () => {
  const pages = [
    'https://www.upwork.com/nx/proposals/job/~01/apply/',
    'https://www.upwork.com/nx/find-work/best-matches',
  ];
  assert.equal(
    selectBrowserPageIndex(pages, 'https://www.upwork.com/nx/search/jobs/?q=claude'),
    1,
  );
  assert.equal(
    selectBrowserPageIndex([pages[0]], 'https://www.upwork.com/nx/search/jobs/?q=claude'),
    -1,
  );
  assert.equal(
    selectBrowserPageIndex(
      ['https://www.upwork.com/freelance-jobs/apply/example_~01'],
      'https://www.upwork.com/nx/search/jobs/?q=claude',
    ),
    -1,
  );
});

test('proposal submission attaches only to the exact ready proposal tab', () => {
  const pages = [
    'https://www.upwork.com/nx/proposals/job/~01/apply/',
    'https://www.upwork.com/nx/proposals/job/~02/apply/',
  ];
  assert.equal(
    selectBrowserPageIndex(pages, 'https://www.upwork.com/nx/proposals/job/~02/apply/', { exactPage: true }),
    1,
  );
  assert.equal(
    selectBrowserPageIndex(pages, 'https://www.upwork.com/nx/proposals/job/~03/apply/', { exactPage: true }),
    -1,
  );
});
