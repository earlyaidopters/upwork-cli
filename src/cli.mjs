#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { Command, Option } from 'commander';
import {
  browserStatus,
  connectBrowser,
  disconnectBrowser,
  findChromeExecutable,
  inspectPageState,
  launchBrowser,
  navigateUpwork,
  requireUsablePage,
} from './browser.mjs';
import { configPath, initializeConfig, loadConfig } from './config.mjs';
import {
  DURATION_OPTIONS,
  auditApplicationStyle,
  buildApplicationTemplate,
  confirmationPhrase,
  fillApplicationForm,
  loadApplication,
  renderApplicationReview,
  requireExplicitApproval,
  reviewFingerprint,
  submitFilledApplication,
  validateApplication,
  verifyFilledApplicationForm,
} from './application.mjs';
import { outputJobs, readJsonFile } from './output.mjs';
import { selectPullOutput } from './delta.mjs';
import { initializeProfile, loadProfile, profilePath } from './profile.mjs';
import { loadProposalRecords, proposalDatabasePath, recordProposal } from './proposal-store.mjs';
import {
  assertProposalAttemptActive,
  beginProposalAttempt,
  blockProposalWorkflow,
  ensureProposalWorkflow,
  getProposalWorkflow,
  getProposalLease,
  handoffProposalWorkflow,
  markProposalReady,
  markProposalReviewed,
  markProposalSubmitted,
  proposalNextAction,
  proposalWorkflowDatabasePath,
  resumeProposalWorkflow,
} from './proposal-workflow.mjs';
import {
  buildProposalPacket,
  extractJobDetail,
  extractProposalForm,
  PROPOSAL_COPY_PLAYBOOK,
  jobReference,
  renderProposalPacket,
} from './proposal.mjs';
import { collectFeed, collectSearch } from './scrape.mjs';
import { filterJobs, rankJobs } from './score.mjs';
import {
  databasePath,
  databaseStats,
  findJob,
  loadJobs,
  loadJobsByIds,
  loadQueryTrends,
  loadRuns,
  loadTrends,
  recordPull,
} from './store.mjs';
import { clamp, parseList, proposalMaximum, sleep, stateDirectory, uniqueBy, writeAtomic } from './util.mjs';

import { validateCommandOptions } from './validation.mjs';
import { hydrateEligibility } from './eligibility.mjs';
import { configureMember } from './setup.mjs';
import { laneCatalog, lanePresets, resolveLanes } from './lanes.mjs';

const program = new Command();

program
  .name('upwork-cli')
  .description('Find Upwork work in your lanes, keep local history, and prepare proposals from your own evidence.')
  .version('0.14.0');

const LIVE_AUTOMATION_NOTICE = [
  'Live proposal filling and submission are off. They are opt-in because Upwork’s Terms of Use (section 3.5)',
  'prohibit unapproved automation, and Upwork can warn, restrict, or permanently block accounts that use it.',
  '',
  'Without it: run proposal review, paste each block into Upwork yourself, then run proposal record-submitted.',
  'To accept that risk for your own account: upwork-cli setup --enable-live-proposals',
].join('\n');

function requireLiveAutomation(config) {
  if (config.proposals?.liveAutomation !== true) throw new Error(LIVE_AUTOMATION_NOTICE);
}

function formatLaneList(config) {
  const selected = new Set(config.lanes || []);
  return Object.entries(laneCatalog(config)).map(([id, lane], index) => {
    const mark = selected.has(id) ? '●' : '○';
    return `${mark} ${index + 1}. ${id.padEnd(15)} ${lane.label.padEnd(27)} ${lane.description || ''}`.trimEnd();
  }).join('\n');
}

function addOutputOptions(command) {
  return command
    .addOption(new Option('-f, --format <format>', 'table, json, jsonl, csv, or markdown').choices(['table', 'json', 'jsonl', 'csv', 'markdown']).default('table'))
    .option('-o, --output <file>', 'write results atomically to a file')
    .option('--limit <number>', 'maximum ranked results to print', '50')
    .option('--min-score <number>', 'minimum local relevance score')
    .option('--min-hourly <number>', 'minimum listed hourly ceiling')
    .option('--max-proposals <number>', 'maximum proposal tier')
    .option('--min-client-spend <number>', 'minimum historical client spend')
    .option('--max-age-hours <number>', 'maximum posting age in hours')
    .option('--verified', 'only payment-verified clients')
    .option('--exclude <terms>', 'comma-separated local exclusion terms')
    .option('--inspect-top <number>', 'inspect full details for the top N candidates before ranking output')
    .option('--eligible-only', 'only jobs with fresh, confirmed location eligibility')
    .option('--include-ineligible', 'include jobs confirmed incompatible with the configured freelancer location')
    .option('--all', 'include previously seen jobs; pulls show only net-new jobs by default')
    .option('--new-only', 'only jobs not present in the database before this run (default)')
    .option('--no-cache', 'do not update SQLite history');
}

async function inspectTopCandidates(page, jobs, options, config) {
  const limit = Math.max(0, Number(options.inspectTop ?? config.eligibility?.inspectTop ?? 20));
  const targets = jobs.slice(0, limit);
  const details = new Map();
  for (let index = 0; index < targets.length; index += 1) {
    const job = targets[index];
    process.stderr.write(`Inspecting eligibility ${index + 1}/${targets.length}: ${job.title}\n`);
    let detail = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await navigateUpwork(page, job.url, { waitFor: 'main' });
        detail = await extractJobDetail(page, {
          freelancerCountry: config.eligibility?.freelancerCountry,
        });
        break;
      } catch (error) {
        const message = String(error?.message || error);
        if (/browser verification|not signed in|captcha|cloudflare/i.test(message)) throw error;
        if (attempt < 2) {
          process.stderr.write(`Detail inspection retry for ${job.uid}: ${message.split('\n')[0]}\n`);
          await sleep(900);
        } else {
          process.stderr.write(`Detail inspection skipped ${job.uid}: ${message.split('\n')[0]}\n`);
        }
      }
    }
    if (!detail) continue;
    details.set(String(job.uid), {
      ...job,
      locationScope: detail.locationScope,
      locationRestriction: detail.locationRestriction,
      allowedLocations: detail.allowedLocations,
      eligibleForProfile: detail.eligibleForProfile,
      eligibilityCountry: config.eligibility.freelancerCountry,
      detailInspectedAt: detail.detailInspectedAt,
      proposals: detail.activity?.proposals || job.proposals,
      proposalsMax: proposalMaximum(detail.activity?.proposals) ?? job.proposalsMax,
      paymentVerified: detail.paymentVerified || job.paymentVerified,
      clientRating: detail.clientRating ?? job.clientRating,
      clientSpend: detail.clientSpend ?? job.clientSpend,
      clientSpendLabel: detail.clientSpendLabel || job.clientSpendLabel,
      clientCountry: detail.clientCountry || job.clientCountry,
      clientJobsPosted: detail.clientJobsPosted,
      clientHireRate: detail.clientHireRate,
      clientMemberSince: detail.clientMemberSince,
      activity: detail.activity,
    });
    if (index + 1 < targets.length) await sleep(Number(config.search?.delayMs || 650));
  }
  const blocked = [...details.values()].filter((job) => job.eligibleForProfile === false).length;
  if (targets.length) {
    process.stderr.write(`Eligibility inspection: ${details.size} checked, ${targets.length - details.size} unavailable, ${blocked} incompatible.\n`);
  }
  return details;
}

async function finishJobs(rawJobs, options, config, runContext = {}, page = null) {
  const cachedJobs = await loadJobsByIds(rawJobs.map(job => job.uid));
  const cachedById = new Map(cachedJobs.map(job => [String(job.uid), job]));
  const seenBefore = new Set(cachedById.keys());
  const hydrated = rawJobs.map(job => hydrateEligibility(job, cachedById.get(String(job.uid)), config.eligibility));
  let ranked = rankJobs(uniqueBy(hydrated, 'uid'), config);
  if (page) {
    const candidates = filterJobs(selectPullOutput(ranked, seenBefore, options), {
      ...options,
      eligibleOnly: false,
      confirmedEligibleOnly: false,
    });
    const detailById = await inspectTopCandidates(page, candidates, options, config);
    ranked = rankJobs(ranked.map((job) => detailById.get(String(job.uid)) || job), config);
  }
  const scoredById = new Map(ranked.map((job) => [String(job.uid), job]));
  const observations = rawJobs.map((job) => ({
    ...job,
    score: scoredById.get(String(job.uid))?.score ?? job.score,
    reasons: scoredById.get(String(job.uid))?.reasons ?? job.reasons,
  }));
  let databaseResult = null;
  if (options.cache !== false) {
    databaseResult = await recordPull(ranked, {
      ...runContext,
      observations,
      completedAt: new Date().toISOString(),
    });
    process.stderr.write(
      `Database run ${databaseResult.runId}: ${databaseResult.seen} observed, `
      + `${databaseResult.added} net-new, ${databaseResult.updated} refreshed, `
      + `${databaseResult.total} total.\n`,
    );
  }
  let jobs = selectPullOutput(ranked, seenBefore, options);
  jobs = filterJobs(jobs, {
    ...options,
    confirmedEligibleOnly: options.eligibleOnly,
    eligibleOnly: !options.includeIneligible && config.eligibility?.excludeIneligible !== false,
  }).slice(0, Math.max(1, Number(options.limit || 50)));
  process.stderr.write(
    `${options.all && !options.newOnly ? 'All-observed' : 'Net-new'} output: ${jobs.length} job(s) after filters and limit.\n`,
  );
  const destination = options.output ? path.resolve(options.output) : null;
  const rendered = await outputJobs(jobs, { ...options, output: destination });
  if (rendered.path) process.stderr.write(`Wrote ${rendered.count} jobs to ${rendered.path}\n`);
  return jobs;
}

async function withBrowser(config, target, action, browserOptions = {}) {
  const session = await connectBrowser(config, { target, ...browserOptions });
  try {
    return await action(session);
  } finally {
    await disconnectBrowser(session.browser);
  }
}

program.command('init')
  .description('Create the editable configuration and evidence profile.')
  .option('--force', 'overwrite the existing configuration and evidence profile')
  .action(async (options) => {
    const configResult = await initializeConfig(options);
    const profileResult = await initializeProfile(options);
    console.log(configResult.created ? `Created ${configResult.path}` : `${configResult.path} already exists`);
    console.log(profileResult.created ? `Created ${profileResult.path}` : `${profileResult.path} already exists`);
  });

program.command('setup')
  .description('Configure your country, rate, and lanes; preserve existing evidence and preferences.')
  .option('--country <country>', 'your actual country of residence')
  .option('--rate <number>', 'your default hourly proposal rate')
  .option('--lanes <lanes>', 'comma-separated lane ids or numbers from `upwork-cli lanes`')
  .option('--enable-live-proposals', 'allow proposal fill and submit to drive the browser (against Upwork’s automation rules)')
  .option('--disable-live-proposals', 'turn live proposal filling and submission back off')
  .action(async (options) => {
    if (options.enableLiveProposals && options.disableLiveProposals) {
      throw new Error('Choose either --enable-live-proposals or --disable-live-proposals.');
    }
    const settings = {
      country: options.country,
      rate: options.rate,
      lanes: options.lanes,
      liveAutomation: options.enableLiveProposals ? true : options.disableLiveProposals ? false : undefined,
    };
    if (Object.values(settings).every((value) => value === undefined)) {
      if (!process.stdin.isTTY) throw new Error('Interactive setup requires a terminal. Use setup --country "Your country" --rate 100 --lanes ai-automation, or init for empty defaults.');
      const config = await loadConfig();
      const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        console.log('Configure your private profile. Press Enter to keep an existing value or leave it unset.');
        const country = (await prompt.question('Country of residence: ')).trim();
        const rate = (await prompt.question('Default hourly proposal rate (USD): ')).trim();
        console.log(`\nLanes decide which searches run and how jobs are ranked.\n${formatLaneList(config)}\n`);
        const lanes = (await prompt.question('Your lanes (numbers or ids, comma-separated): ')).trim();
        if (country) settings.country = country;
        if (rate) settings.rate = rate;
        if (lanes) settings.lanes = lanes;
      } finally {
        prompt.close();
      }
    }
    if (settings.liveAutomation === true) process.stderr.write(`${LIVE_AUTOMATION_NOTICE.split('\n\n')[0]}\nYou enabled it for this installation.\n\n`);
    const result = await configureMember(settings);
    console.log([
      'Private settings saved.',
      `Config: ${result.configPath}`,
      `Evidence profile: ${result.profilePath}`,
      `Lanes: ${result.lanes.length ? result.lanes.join(', ') : 'all (pick yours with setup --lanes)'}`,
      `Live proposal automation: ${result.liveAutomation ? 'ON' : 'off'}`,
      '',
      'Next: run upwork-cli auth, then upwork-cli doctor.',
      'Before drafting, add your own evidence using docs/voice-workbook.md.',
    ].join('\n'));
  });

program.command('lanes')
  .description('List the kinds of work you can target. ● marks your selected lanes.')
  .option('--queries', 'also print each lane’s search queries')
  .action(async (options) => {
    const config = await loadConfig();
    console.log(formatLaneList(config));
    if (options.queries) {
      for (const lane of resolveLanes({ ...config, lanes: Object.keys(laneCatalog(config)) })) {
        console.log(`\n${lane.id}\n  ${lane.queries.join('\n  ')}`);
      }
    }
    if (!config.lanes.length) console.log('\nNo lanes selected, so every lane competes. Pick yours: upwork-cli setup --lanes 1,2');
    console.log('\nAdd your own under customLanes in the config file. See README, "Lanes".');
  });

async function proposalContext(config, input, { includeForm = true } = {}) {
  let ref;
  try {
    ref = jobReference(input);
  } catch {
    const cached = await findJob(input);
    if (!cached?.url) throw new Error(`No cached job matched ${input}`);
    ref = jobReference(cached.url);
  }
  const cached = await findJob(ref.uid);
  return withBrowser(config, ref.jobUrl, async ({ page }) => {
    if (isProposalPage(page.url())) {
      throw new Error(
        `Browser is already on a proposal page (${page.url()}). `
        + 'Read-only inspection will not navigate away from possible manual work; use proposal status or handoff first.',
      );
    }
    await navigateUpwork(page, ref.jobUrl, { waitFor: 'main' });
    const liveJob = await extractJobDetail(page, {
      freelancerCountry: config.eligibility?.freelancerCountry,
    });
    const job = {
      ...(cached || {}),
      ...liveJob,
      uid: ref.uid,
      url: ref.jobUrl,
    };
    let form = null;
    let formError = null;
    if (includeForm) {
      try {
        await navigateUpwork(page, ref.proposalUrl, { waitFor: 'textarea' });
        form = await extractProposalForm(page);
      } catch (error) {
        formError = error.message;
      } finally {
        if (normalizedPathname(page.url()) === normalizedPathname(ref.proposalUrl)) {
          await navigateUpwork(page, ref.jobUrl, { waitFor: 'main' }).catch(() => {});
        }
      }
    }
    return { ref, job, form, formError };
  });
}

function normalizedPathname(value) {
  try {
    return new URL(value).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function isProposalPage(value) {
  return /(?:\/nx\/proposals\/|\/freelance-jobs\/apply\/)/.test(normalizedPathname(value));
}

function assertNoForeignProposalPage(currentUrl, expectedUrl) {
  if (isProposalPage(currentUrl) && normalizedPathname(currentUrl) !== normalizedPathname(expectedUrl)) {
    throw new Error(
      `Browser is currently on a different proposal page (${currentUrl}). `
      + 'The CLI will not navigate away from possible manual work. Finish or cancel it, then run proposal resume once.',
    );
  }
}

async function proposalFailureSnapshot(page) {
  const inspected = await inspectPageState(page).catch(() => null);
  const form = isProposalPage(page.url())
    ? await extractProposalForm(page).catch(() => null)
    : null;
  return {
    capturedAt: new Date().toISOString(),
    page: inspected ? {
      url: inspected.url,
      title: inspected.title,
      authenticated: !inspected.loggedOut,
      cloudflare: inspected.cloudflare,
      captcha: inspected.captcha,
    } : { url: page.url() },
    form: form ? {
      title: form.title,
      submitAs: form.submitAs,
      paymentMode: form.paymentMode,
      duration: form.duration,
      durationControlPresent: Boolean(form.durationControl),
      connectsRequired: form.connectsRequired,
      boostConnects: form.boostConnects,
      totalConnects: form.totalConnects,
      questionCount: Math.max(0, (form.fields || []).length - 1),
      questions: (form.fields || []).slice(1).map((field) => field.question),
    } : null,
  };
}

async function withProposalFailureSnapshot(page, action) {
  try {
    return await action();
  } catch (error) {
    error.proposalSnapshot = await proposalFailureSnapshot(page);
    throw error;
  }
}

async function withApplicationPage(config, application, action) {
  const ref = jobReference(application.job?.url || application.job?.uid);
  return withBrowser(config, ref.proposalUrl, async ({ page }) => {
    return withProposalFailureSnapshot(page, async () => {
      assertNoForeignProposalPage(page.url(), ref.proposalUrl);
      if (normalizedPathname(page.url()) === normalizedPathname(ref.proposalUrl)) {
        await requireUsablePage(page);
        await page.locator('textarea').first().waitFor({ state: 'attached', timeout: 10_000 });
        return action(page, { ref, job: { ...application.job, uid: ref.uid, url: ref.jobUrl } });
      }
      await navigateUpwork(page, ref.jobUrl, { waitFor: 'main' });
      const job = await extractJobDetail(page, {
        freelancerCountry: config.eligibility?.freelancerCountry,
      });
      await navigateUpwork(page, ref.proposalUrl, { waitFor: 'textarea' });
      return action(page, { ref, job: { ...job, uid: ref.uid, url: ref.jobUrl } });
    });
  });
}

async function withReadyApplicationPage(config, application, action) {
  const ref = jobReference(application.job?.url || application.job?.uid);
  return withBrowser(config, ref.proposalUrl, async ({ page }) => {
    return withProposalFailureSnapshot(page, async () => {
      await requireUsablePage(page);
      if (normalizedPathname(page.url()) !== normalizedPathname(ref.proposalUrl)) {
        throw new Error(
          `The ready browser checkpoint moved to ${page.url()}. Expected ${ref.proposalUrl}. `
          + 'The CLI will not navigate or refill during submit.',
        );
      }
      await page.locator('textarea').first().waitFor({ state: 'attached', timeout: 10_000 });
      return action(page, { ref, job: { ...application.job, uid: ref.uid, url: ref.jobUrl } });
    });
  }, { exactPage: true });
}

async function trackedProposal(application, source) {
  const records = await loadProposalRecords();
  const submittedRecord = records.find((record) => record.success && record.jobUid === application.job?.uid) || null;
  const workflow = await ensureProposalWorkflow({
    application,
    applicationSource: source,
    fingerprint: reviewFingerprint(application),
    submittedRecord,
  });
  return { workflow, submittedRecord };
}

function workflowSummary(workflow, lease = null) {
  return {
    path: proposalWorkflowDatabasePath(),
    jobUid: workflow?.jobUid || null,
    state: workflow?.state || null,
    owner: workflow?.owner || null,
    fingerprint: workflow?.fingerprint || null,
    reviewedFingerprint: workflow?.reviewedFingerprint || null,
    activeAttempt: workflow?.activeAttempt || null,
    browserLease: lease,
    lastCheckpoint: workflow?.lastCheckpoint || null,
    lastError: workflow?.lastError || null,
    nextAction: proposalNextAction(workflow),
  };
}

async function settleProposalAttemptFailure(workflow, error) {
  const latest = await getProposalWorkflow(workflow.jobUid);
  if (latest?.state === 'MANUAL_CONTROL' || latest?.state === 'SUBMITTED') {
    return { workflow: latest, blocked: false };
  }
  const blocked = await blockProposalWorkflow(latest || workflow, error, error.proposalSnapshot || null);
  return { workflow: blocked, blocked: true };
}

const browserCommand = program.command('browser').description('Manage the dedicated real-Chrome session.');

browserCommand.command('start')
  .description('Start or reuse the dedicated Chrome profile.')
  .option('--url <url>', 'initial URL', 'https://www.upwork.com/nx/find-work/best-matches')
  .action(async (options) => {
    const config = await loadConfig();
    const result = await launchBrowser(config, options.url);
    console.log(`${result.launched ? 'Started' : 'Reused'} Chrome at ${result.endpoint}`);
    console.log(`Profile: ${result.profileDirectory}`);
  });

browserCommand.command('status')
  .description('Show local CDP and profile status.')
  .action(async () => {
    const config = await loadConfig();
    console.log(JSON.stringify(await browserStatus(config), null, 2));
  });

program.command('auth')
  .description('Open the dedicated Chrome profile and wait for you to finish Upwork sign-in.')
  .option('--no-wait', 'open Chrome without waiting for Enter')
  .action(async (options) => {
    const config = await loadConfig();
    const result = await launchBrowser(config, 'https://www.upwork.com/nx/find-work/best-matches');
    console.log(`${result.launched ? 'Opened' : 'Reused'} the dedicated Chrome profile.`);
    console.log('Sign in to Upwork and complete any browser verification in that window.');
    if (options.wait !== false && process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      await rl.question('Press Enter when the job feed is visible...');
      rl.close();
      await withBrowser(config, 'https://www.upwork.com/nx/find-work/best-matches', async ({ page }) => {
        const state = await inspectPageState(page);
        if (state.cloudflare || state.captcha || state.loggedOut) {
          throw new Error('Sign-in or browser verification is not complete yet.');
        }
        console.log(`Authenticated page ready: ${state.url}`);
      }, { allowAnyPage: true });
    }
  });

addOutputOptions(program.command('search <keywords...>')
  .description('Search Upwork by arbitrary keywords and traverse up to 50 jobs per page.')
  .option('-p, --pages <number>', 'number of search pages', '1')
  .option('--per-page <number>', 'jobs per search page: 10, 20, or 50', '50')
  .addOption(new Option('--sort <sort>', 'best or recent').choices(['best', 'recent']).default('best'))
  .addOption(new Option('--job-type <type>', 'all, hourly, or fixed').choices(['all', 'hourly', 'fixed']).default('all'))
  .action(async (keywords, options) => {
    const startedAt = new Date().toISOString();
    const config = await loadConfig();
    const query = keywords.join(' ').trim();
    const pages = clamp(options.pages, 1, config.search.maxPages);
    const perPage = [10, 20, 50].includes(Number(options.perPage)) ? Number(options.perPage) : 50;
    await withBrowser(config, 'https://www.upwork.com/nx/find-work/best-matches', async ({ page }) => {
      await requireUsablePage(page);
      const jobs = await collectSearch(page, query, {
        pages,
        perPage,
        sort: options.sort,
        jobType: options.jobType === 'all' ? null : options.jobType,
        verified: options.verified,
        delayMs: config.search.delayMs,
      });
      await finishJobs(jobs, options, config, {
        command: 'search',
        queries: [query],
        startedAt,
        options: { pages, perPage, sort: options.sort, jobType: options.jobType },
      }, page);
    });
  }));

addOutputOptions(program.command('feed [feed]')
  .description('Pull a personalized feed; feed is best, recent, or mine.')
  .option('-b, --batches <number>', 'Load More Jobs clicks; each normally adds 10 jobs', '3')
  .action(async (feed = 'best', options) => {
    validateCommandOptions({ feed });
    const startedAt = new Date().toISOString();
    const config = await loadConfig();
    const batches = clamp(options.batches, 0, config.search.maxFeedBatches);
    await withBrowser(config, 'https://www.upwork.com/nx/find-work/best-matches', async ({ page }) => {
      const jobs = await collectFeed(page, feed, { batches, delayMs: config.search.delayMs });
      await finishJobs(jobs, options, config, {
        command: 'feed',
        queries: [feed],
        startedAt,
        options: { feed, batches },
      }, page);
    });
  }));

addOutputOptions(program.command('hunt [preset]')
  .description('Search every query in a lane or preset, deduplicate, and rank. Defaults to all your lanes.')
  .option('-p, --pages <number>', 'pages per query', '1')
  .option('--queries <queries>', 'override preset queries with a comma-separated list')
  .addOption(new Option('--sort <sort>', 'best or recent').choices(['best', 'recent']).default('recent'))
  .action(async (preset = 'lanes', options) => {
    const startedAt = new Date().toISOString();
    const config = await loadConfig();
    const presets = lanePresets(config);
    const queries = parseList(options.queries).length
      ? parseList(options.queries)
      : presets[preset]?.queries;
    if (!queries?.length) {
      throw new Error(`Unknown lane or preset "${preset}". Available: ${Object.keys(presets).join(', ')}`);
    }
    const pages = clamp(options.pages, 1, config.search.maxPages);
    await withBrowser(config, 'https://www.upwork.com/nx/find-work/best-matches', async ({ page }) => {
      const all = [];
      for (const query of [...new Set(queries.map(value => value.trim()))]) {
        process.stderr.write(`Searching: ${query}\n`);
        const jobs = await collectSearch(page, query, {
          pages,
          perPage: config.search.perPage,
          sort: options.sort,
          delayMs: config.search.delayMs,
        });
        all.push(...jobs);
      }
      await finishJobs(all, options, config, {
        command: 'hunt',
        queries,
        startedAt,
        options: { preset, pages, sort: options.sort },
      }, page);
    });
  }));

const proposalCommand = program.command('proposal')
  .description('Prepare and audit proposals. Submission requires exact-content review and explicit user consent.');

proposalCommand.command('inspect <job>')
  .description('Read the live job and proposal form, including questions, price, identity, duration, fee, boost, and Connects.')
  .option('--no-form', 'inspect the public job detail without opening its application form')
  .action(async (job, options) => {
    const config = await loadConfig();
    const context = await proposalContext(config, job, { includeForm: options.form !== false });
    console.log(JSON.stringify(context, null, 2));
  });

proposalCommand.command('packet <job>')
  .description('Build a Markdown decision brief and answer scaffold from live requirements and verified evidence.')
  .option('--no-form', 'build from the job detail without opening its application form')
  .option('-o, --output <file>', 'Markdown output file')
  .action(async (job, options) => {
    const config = await loadConfig();
    const profile = await loadProfile();
    const context = await proposalContext(config, job, { includeForm: options.form !== false });
    const packet = buildProposalPacket({ job: context.job, form: context.form, profile, lanes: resolveLanes(config) });
    const markdown = renderProposalPacket(packet);
    if (context.formError) {
      process.stderr.write(`Proposal form could not be inspected: ${context.formError}\n`);
    }
    if (options.output) {
      const destination = path.resolve(options.output);
      await writeAtomic(destination, markdown);
      console.log(`Wrote proposal packet to ${destination}`);
    } else {
      process.stdout.write(markdown);
    }
  });

proposalCommand.command('profile')
  .description('Show the editable evidence-profile path used for proposal grounding.')
  .action(async () => {
    console.log(profilePath());
  });

proposalCommand.command('playbook')
  .description('Show the proposal writing guide with evidence and editing instructions.')
  .action(async () => {
    console.log(PROPOSAL_COPY_PLAYBOOK);
  });

proposalCommand.command('template <job>')
  .description('Create a replayable JSON application from the live questions and terms.')
  .option('--rate <number>', 'initial hourly bid; defaults to the evidence profile rate')
  .option('-o, --output <file>', 'application JSON output file')
  .action(async (job, options) => {
    const config = await loadConfig();
    const profile = await loadProfile();
    const context = await proposalContext(config, job, { includeForm: true });
    const application = buildApplicationTemplate({
      job: context.job,
      form: context.form,
      profile,
      hourlyRate: options.rate,
    });
    const existingSubmission = (await loadProposalRecords())
      .find((record) => record.success && record.jobUid === application.job.uid);
    if (existingSubmission) {
      throw new Error(`Job ${application.job.uid} already has submitted proposal ${existingSubmission.proposalId}; no template was created.`);
    }
    const destination = path.resolve(options.output || `proposal-${application.job.uid}.json`);
    await writeAtomic(destination, `${JSON.stringify(application, null, 2)}\n`);
    const { workflow } = await trackedProposal(application, destination);
    console.log(`Created application template: ${destination}`);
    console.log(`Workflow: ${workflow.state}`);
    if (context.formError) process.stderr.write(`Form inspection warning: ${context.formError}\n`);
    if (!application.terms.duration) {
      process.stderr.write(
        `Required choice: set terms.duration to one of ${[...DURATION_OPTIONS].join(', ')} before review or filling.\n`,
      );
    }
    if (application.terms.paymentMode === 'milestone') {
      process.stderr.write('Blocked choice: milestone filling is not implemented; use project or add explicit milestone fields first.\n');
    }
    if (application.job.hourlyMax && application.terms.hourlyRate > application.job.hourlyMax) {
      process.stderr.write(
        `Rate guard: $${application.terms.hourlyRate}/hr exceeds the client ceiling of $${application.job.hourlyMax}/hr. `
        + 'Edit the rate or explicitly set terms.allowRateAboveBudget to true.\n',
      );
    }
  });

proposalCommand.command('validate <application>')
  .description('Validate a completed application offline, or against the current live Upwork form.')
  .option('--live', 'also verify current questions, Connects, and budget in the authenticated browser')
  .action(async (applicationFile, options) => {
    const { application, source } = await loadApplication(applicationFile);
    let result;
    if (options.live) {
      const config = await loadConfig();
      result = await withApplicationPage(config, application, async (page, context) => {
        const liveForm = await extractProposalForm(page);
        return validateApplication(application, { liveForm, job: context.job });
      });
    } else {
      result = validateApplication(application);
    }
    console.log(JSON.stringify({ application: source, ...result }, null, 2));
    if (!result.valid) process.exitCode = 1;
  });

proposalCommand.command('lint <application>')
  .description('Audit every proposal response for named No AI Slop patterns without changing the draft.')
  .action(async (applicationFile) => {
    const { application, source } = await loadApplication(applicationFile);
    const findings = auditApplicationStyle(application);
    const errors = findings.filter((finding) => finding.severity === 'error');
    console.log(JSON.stringify({
      application: source,
      sourceRules: [
        'https://github.com/petergyang/no-ai-slop',
        'docs/proposal-writing.md',
      ],
      passed: errors.length === 0,
      findings,
    }, null, 2));
    if (errors.length) process.exitCode = 1;
  });

proposalCommand.command('review <application>')
  .description('Print the cover letter and each answer in separate code blocks, then issue a content-bound approval phrase.')
  .action(async (applicationFile) => {
    const { application, source } = await loadApplication(applicationFile);
    const review = renderApplicationReview(application);
    if (review.validation.valid && application.status === 'draft') {
      const { workflow } = await trackedProposal(application, source);
      await markProposalReviewed(workflow, review.fingerprint);
    }
    process.stdout.write(review.markdown);
    if (!review.validation.valid) process.exitCode = 1;
  });

proposalCommand.command('status <application-or-job>')
  .description('Show the one authoritative local workflow state without opening Upwork.')
  .action(async (target) => {
    if (path.extname(target).toLowerCase() === '.json' || path.isAbsolute(target) || target.startsWith('.')) {
      const { application, source } = await loadApplication(target);
      const { workflow, submittedRecord } = await trackedProposal(application, source);
      const lease = await getProposalLease(workflow.jobUid);
      console.log(JSON.stringify({
        application: source,
        applicationStatus: application.status || null,
        workflow: workflowSummary(workflow, lease),
        submission: submittedRecord || workflow.submission || null,
      }, null, 2));
      return;
    }
    const ref = jobReference(target);
    const workflow = await getProposalWorkflow(ref.uid);
    const lease = await getProposalLease(ref.uid);
    const submittedRecord = (await loadProposalRecords())
      .find((record) => record.success && record.jobUid === ref.uid) || null;
    console.log(JSON.stringify({
      jobUid: ref.uid,
      workflow: workflowSummary(workflow, lease),
      submission: submittedRecord || workflow?.submission || null,
    }, null, 2));
  });

proposalCommand.command('handoff <application>')
  .description('Yield proposal browser ownership to the user and block all CLI fill/submit actions.')
  .action(async (applicationFile) => {
    const { application, source } = await loadApplication(applicationFile);
    const { workflow } = await trackedProposal(application, source);
    const handedOff = await handoffProposalWorkflow(workflow);
    console.log(JSON.stringify({
      status: 'manual-control',
      workflow: workflowSummary(handedOff),
      instruction: 'The CLI will not fill or submit this proposal until proposal resume is run explicitly.',
    }, null, 2));
  });

proposalCommand.command('resume <application>')
  .description('Explicitly release a blocked/manual workflow for one new reviewed attempt.')
  .action(async (applicationFile) => {
    const { application, source } = await loadApplication(applicationFile);
    const fingerprint = reviewFingerprint(application);
    const { workflow } = await trackedProposal(application, source);
    const resumed = ['BLOCKED', 'MANUAL_CONTROL'].includes(workflow.state) || workflow.activeAttempt
      ? await resumeProposalWorkflow(workflow, fingerprint)
      : workflow;
    console.log(JSON.stringify({
      status: resumed === workflow ? 'resume-not-needed' : 'resumed',
      workflow: workflowSummary(resumed),
    }, null, 2));
  });

proposalCommand.command('fill <application>')
  .description('Opt-in: fill and verify the live proposal form from JSON without submitting it.')
  .action(async (applicationFile) => {
    const { application, source } = await loadApplication(applicationFile);
    if (application.status !== 'draft') {
      throw new Error(`Application status must be draft before filling; saw ${application.status || 'missing'}`);
    }
    const config = await loadConfig();
    requireLiveAutomation(config);
    const offlineValidation = validateApplication(application);
    if (!offlineValidation.valid) {
      throw new Error(`Application is blocked before a live attempt:\n- ${offlineValidation.errors.join('\n- ')}`);
    }
    let { workflow } = await trackedProposal(application, source);
    workflow = await beginProposalAttempt(workflow, 'fill', ['REVIEWED']);
    let preview;
    try {
      preview = await withApplicationPage(config, application, async (page, context) => {
        return fillApplicationForm(page, application, {
          job: context.job,
          guard: () => assertProposalAttemptActive(workflow),
        });
      });
    } catch (error) {
      const settled = await settleProposalAttemptFailure(workflow, error);
      if (!settled.blocked) {
        throw new Error(`${error.message}\nWorkflow remains ${settled.workflow.state}; no retry was started.`);
      }
      throw new Error(`${error.message}\nWorkflow is now BLOCKED (${settled.workflow.lastError.category}). ${settled.workflow.lastError.requiredAction}`);
    }
    let ready;
    try {
      ready = await markProposalReady(workflow, {
        url: preview.form.url,
        fingerprint: reviewFingerprint(application),
        submitAs: preview.form.submitAs,
        paymentMode: preview.form.paymentMode,
        duration: preview.form.duration,
        price: application.terms.pricingBasis === 'fixed' ? preview.form.fixedPrice : preview.form.bidRate,
        baseConnects: preview.form.connectsRequired,
        boostConnects: preview.form.boostConnects,
        totalConnects: preview.form.totalConnects,
        questionCount: Math.max(0, preview.form.fields.length - 1),
      });
    } catch (error) {
      const settled = await settleProposalAttemptFailure(workflow, error);
      throw new Error(
        `The form was filled, but its READY checkpoint could not be recorded. Do not submit or refill. `
        + `${settled.blocked ? proposalNextAction(settled.workflow) : `Workflow remains ${settled.workflow.state}.`}`,
      );
    }
    console.log(JSON.stringify({
      application: source,
      status: 'ready-not-submitted',
      pricingBasis: application.terms.pricingBasis || 'hourly',
      price: application.terms.pricingBasis === 'fixed' ? preview.form.fixedPrice : preview.form.bidRate,
      submitAs: preview.form.submitAs,
      paymentMode: preview.form.paymentMode,
      duration: preview.form.duration,
      estimatedReceive: preview.form.estimatedReceive,
      connectsRequired: preview.form.connectsRequired,
      boostConnects: preview.form.boostConnects,
      totalConnects: preview.form.totalConnects,
      connectsRemaining: preview.form.connectsRemaining,
      answers: Math.max(0, preview.form.fields.length - 1),
      boost: preview.boost,
      submitReady: preview.submitReady,
      warnings: preview.validation.warnings,
      workflow: workflowSummary(ready),
    }, null, 2));
  });

proposalCommand.command('submit <application>')
  .description('Opt-in: submit only with exact-content user approval and a separate live Connects confirmation.')
  .requiredOption('--approval <phrase>', 'exact phrase emitted by `proposal review` after the user approves every code block')
  .requiredOption('--confirm <phrase>', 'for example: "SUBMIT 13 CONNECTS"')
  .action(async (applicationFile, options) => {
    const { application, source } = await loadApplication(applicationFile);
    if (application.status !== 'draft') {
      throw new Error(`Application status must be draft before CLI submission; saw ${application.status || 'missing'}`);
    }
    const offlineValidation = validateApplication(application);
    if (!offlineValidation.valid) {
      throw new Error(`Application is blocked before consent:\n- ${offlineValidation.errors.join('\n- ')}`);
    }
    const config = await loadConfig();
    requireLiveAutomation(config);
    const approval = requireExplicitApproval(application, options.approval);
    let { workflow } = await trackedProposal(application, source);
    if (workflow.state !== 'READY') {
      throw new Error(`Proposal submit requires a READY checkpoint; saw ${workflow.state}. ${proposalNextAction(workflow)}`);
    }
    if (workflow.lastCheckpoint?.fingerprint !== approval.fingerprint) {
      throw new Error('The READY checkpoint fingerprint does not match the approved content. Run proposal review and fill once again.');
    }
    const checkpointConfirmation = confirmationPhrase(
      workflow.lastCheckpoint.baseConnects,
      workflow.lastCheckpoint.boostConnects,
    );
    if (options.confirm !== checkpointConfirmation) {
      throw new Error(`Confirmation mismatch. The READY checkpoint requires: --confirm "${checkpointConfirmation}"`);
    }
    workflow = await beginProposalAttempt(workflow, 'submit', ['READY']);
    let result;
    try {
      result = await withReadyApplicationPage(config, application, async (page, context) => {
        const preview = await verifyFilledApplicationForm(page, application);
        const connectsRequired = preview.form.connectsRequired;
        const boostConnects = preview.form.boostConnects;
        const requiredPhrase = confirmationPhrase(connectsRequired, boostConnects);
        if (options.confirm !== requiredPhrase) {
          throw new Error(`Confirmation mismatch. The live form requires: --confirm "${requiredPhrase}"`);
        }
        await assertProposalAttemptActive(workflow);
        const submitted = await submitFilledApplication(page, {
          confirmation: options.confirm,
          connectsRequired,
          boostConnects,
          terms: application.terms,
          guard: () => assertProposalAttemptActive(workflow),
        });
        return { submitted, job: context.job };
      });
    } catch (error) {
      const settled = await settleProposalAttemptFailure(workflow, error);
      if (!settled.blocked) {
        throw new Error(`${error.message}\nWorkflow remains ${settled.workflow.state}; no retry was started.`);
      }
      throw new Error(`${error.message}\nWorkflow is now BLOCKED (${settled.workflow.lastError.category}). ${settled.workflow.lastError.requiredAction}`);
    }
    const recordPayload = {
      ...result.submitted,
      jobUid: application.job.uid,
      jobTitle: application.job.title || result.job.title,
      jobUrl: application.job.url,
      applicationSource: source,
      contentFingerprint: approval.fingerprint,
      explicitApprovalVerified: true,
      answerCount: application.answers.length,
    };
    let submittedWorkflow = null;
    let record = null;
    const finalizationErrors = [];
    try {
      submittedWorkflow = await markProposalSubmitted(workflow, recordPayload);
    } catch (error) {
      finalizationErrors.push(`workflow: ${error.message}`);
    }
    try {
      record = await recordProposal(recordPayload);
    } catch (error) {
      finalizationErrors.push(`audit record: ${error.message}`);
    }
    application.status = 'submitted';
    application.submission = {
      method: 'cli',
      proposalId: result.submitted.proposalId,
      url: result.submitted.url,
      submittedAt: result.submitted.submittedAt,
      contentFingerprint: approval.fingerprint,
    };
    try {
      await writeAtomic(source, `${JSON.stringify(application, null, 2)}\n`);
    } catch (error) {
      finalizationErrors.push(`application file: ${error.message}`);
    }
    if (finalizationErrors.length) {
      throw new Error(
        `Upwork proposal ${result.submitted.proposalId} was submitted successfully, but local finalization had errors: `
        + `${finalizationErrors.join('; ')}. DO NOT RESUBMIT. Reconcile the local record only.`,
      );
    }
    console.log(JSON.stringify({
      status: 'submitted',
      record,
      workflow: workflowSummary(submittedWorkflow),
      auditDatabase: proposalDatabasePath(),
    }, null, 2));
  });

proposalCommand.command('record-submitted <application>')
  .description('Reconcile a proposal submitted manually; this never opens or changes Upwork.')
  .requiredOption('--proposal-id <id>', 'proposal ID visible in the submitted proposal URL')
  .requiredOption('--confirm <phrase>', 'exactly "RECORD SUBMITTED <proposal-id>"')
  .option('--submitted-at <iso>', 'submission timestamp; defaults to the reconciliation time')
  .option('--boost <number>', 'actual boost Connects; defaults to application terms')
  .action(async (applicationFile, options) => {
    const { application, source } = await loadApplication(applicationFile);
    const expected = `RECORD SUBMITTED ${options.proposalId}`;
    if (options.confirm !== expected) throw new Error(`Manual reconciliation requires --confirm "${expected}"`);
    const existing = (await loadProposalRecords())
      .find((record) => record.success && record.jobUid === application.job.uid);
    if (existing) {
      console.log(JSON.stringify({ status: 'already-recorded', record: existing }, null, 2));
      return;
    }
    const submittedAt = options.submittedAt || new Date().toISOString();
    if (!Number.isFinite(Date.parse(submittedAt))) throw new Error('--submitted-at must be a valid ISO timestamp');
    const baseConnects = Number(application.terms.expectedConnects || 0);
    const boostConnects = options.boost == null
      ? Number(application.terms.boostConnects || 0)
      : Number(options.boost);
    if (!Number.isInteger(boostConnects) || boostConnects < 0) throw new Error('--boost must be a non-negative integer');
    const record = await recordProposal({
      proposalId: String(options.proposalId),
      url: `https://www.upwork.com/nx/proposals/${options.proposalId}`,
      success: true,
      pricingBasis: application.terms.pricingBasis || null,
      submitAs: application.terms.submitAs || null,
      paymentMode: application.terms.paymentMode || null,
      duration: application.terms.duration || null,
      hourlyRate: application.terms.pricingBasis === 'hourly' ? application.terms.hourlyRate : null,
      fixedPrice: application.terms.pricingBasis === 'fixed' ? application.terms.fixedPrice : null,
      baseConnects,
      boostConnects,
      connectsSpent: baseConnects + boostConnects,
      submittedAt,
      jobUid: application.job.uid,
      jobTitle: application.job.title,
      jobUrl: application.job.url,
      applicationSource: source,
      contentFingerprint: reviewFingerprint(application),
      explicitApprovalVerifiedByCli: false,
      answerCount: application.answers.length,
      submissionMethod: 'user-manual-reconciled',
    });
    let { workflow } = await trackedProposal(application, source);
    workflow = await markProposalSubmitted(workflow, record);
    application.status = 'submitted-manually';
    application.submission = {
      method: 'manual',
      proposalId: record.proposalId,
      url: record.url,
      submittedAt,
      contentFingerprint: record.contentFingerprint,
    };
    await writeAtomic(source, `${JSON.stringify(application, null, 2)}\n`);
    console.log(JSON.stringify({ status: 'submitted-manually-recorded', record, workflow: workflowSummary(workflow) }, null, 2));
  });

proposalCommand.command('records')
  .description('Show the local audit history of CLI and manually reconciled proposals.')
  .action(async () => {
    console.log(JSON.stringify({ path: proposalDatabasePath(), proposals: await loadProposalRecords() }, null, 2));
  });

program.command('cache')
  .description('Inspect canonical jobs in the local SQLite history.')
  .option('--limit <number>', 'maximum jobs', '50')
  .addOption(new Option('-f, --format <format>').choices(['table', 'json', 'jsonl', 'csv', 'markdown']).default('table'))
  .option('-o, --output <file>')
  .action(async (options) => {
    const config = await loadConfig();
    const stored = await loadJobs({ limit: Number(options.limit) });
    const jobs = stored.map(job => hydrateEligibility(job, null, config.eligibility));
    await outputJobs(jobs, { ...options, output: options.output ? path.resolve(options.output) : null });
  });

function outputHistoryRows(rows, format = 'table') {
  if (format === 'json') console.log(JSON.stringify(rows, null, 2));
  else console.table(rows);
}

const historyCommand = program.command('history')
  .description('Inspect SQLite job history, pull deltas, and trends.');

historyCommand.command('stats')
  .description('Show database totals and recent net-new counts.')
  .action(async () => {
    console.log(JSON.stringify(await databaseStats(), null, 2));
  });

historyCommand.command('runs')
  .description('Show recent pull runs with observed, new, and refreshed counts.')
  .option('--limit <number>', 'maximum runs', '20')
  .addOption(new Option('-f, --format <format>').choices(['table', 'json']).default('table'))
  .action(async (options) => {
    outputHistoryRows(await loadRuns(options.limit), options.format);
  });

historyCommand.command('trends')
  .description('Show daily new-job, quality, verification, and hourly-rate trends.')
  .option('--days <number>', 'lookback window', '30')
  .addOption(new Option('-f, --format <format>').choices(['table', 'json']).default('table'))
  .action(async (options) => {
    outputHistoryRows(await loadTrends(options.days), options.format);
  });

historyCommand.command('queries')
  .description('Show which search queries are producing unique and high-scoring jobs.')
  .option('--days <number>', 'lookback window', '30')
  .option('--limit <number>', 'maximum queries', '25')
  .addOption(new Option('-f, --format <format>').choices(['table', 'json']).default('table'))
  .action(async (options) => {
    outputHistoryRows(await loadQueryTrends(options.days, options.limit), options.format);
  });

historyCommand.command('import <file>')
  .description('Import a JSON job array into SQLite as one historical run.')
  .action(async (file) => {
    const source = path.resolve(file);
    const data = await readJsonFile(source);
    const rawJobs = Array.isArray(data) ? data : data.jobs;
    if (!Array.isArray(rawJobs)) throw new Error('Import JSON must be an array or an object with a jobs array.');
    const config = await loadConfig();
    const ranked = rankJobs(uniqueBy(rawJobs, 'uid'), config);
    const result = await recordPull(ranked, {
      command: 'history-import',
      queries: [...new Set(rawJobs.map((job) => job.query).filter(Boolean))],
      observations: rawJobs,
      options: { source },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    console.log(JSON.stringify({ source, ...result, jobs: undefined }, null, 2));
  });

program.command('show <uid>')
  .description('Show one cached job with its full score explanation.')
  .action(async (uid) => {
    const job = await findJob(uid);
    if (!job) throw new Error(`No cached job matched ${uid}`);
    console.log(JSON.stringify(job, null, 2));
  });

program.command('open <uid>')
  .description('Open one cached job in the dedicated Chrome profile.')
  .action(async (uid) => {
    const job = await findJob(uid);
    if (!job?.url) throw new Error(`No cached job matched ${uid}`);
    const config = await loadConfig();
    const result = await launchBrowser(config, job.url);
    if (!result.launched) {
      const session = await connectBrowser(config, { target: job.url });
      try {
        await session.page.goto(job.url, { waitUntil: 'domcontentloaded' });
      } finally {
        await disconnectBrowser(session.browser);
      }
    }
    console.log(`Opened ${job.title}: ${job.url}`);
  });

program.command('doctor')
  .description('Check Node, Chrome, configuration, local profile, cache, and authentication state.')
  .option('--offline', 'check local readiness without connecting to Chrome')
  .action(async (options) => {
    const config = await loadConfig();
    const chrome = await findChromeExecutable().catch((error) => `ERROR: ${error.message}`);
    const status = options.offline ? { running: false, checked: false } : await browserStatus(config);
    const profile = await loadProfile();
    const nextSteps = [];
    if (!config.eligibility.freelancerCountry) nextSteps.push('Run upwork-cli setup to set your country.');
    if (!config.lanes.length) nextSteps.push('Pick your lanes with upwork-cli setup --lanes (see upwork-cli lanes).');
    if (!profile.defaultHourlyRate) nextSteps.push('Set your own default proposal rate with upwork-cli setup.');
    if (!profile.proof.length && !profile.facts.length) nextSteps.push('Add verified evidence using docs/voice-workbook.md before drafting.');
    if (!options.offline && !status.running) nextSteps.push('Run upwork-cli auth to start your dedicated Chrome session.');
    const history = await databaseStats();
    const report = {
      node: process.version,
      nextSteps,
      readiness: {
        countryConfigured: Boolean(config.eligibility.freelancerCountry),
        rateConfigured: Boolean(profile.defaultHourlyRate),
        lanes: config.lanes.length ? config.lanes : 'all',
        liveProposalAutomation: config.proposals.liveAutomation,
        evidenceCount: profile.proof.length,
        factCount: profile.facts.length,
      },
      chrome,
      config: configPath(),
      profile: profilePath(),
      stateDirectory: stateDirectory(),
      cache: databasePath(),
      history,
      proposals: proposalDatabasePath(),
      proposalWorkflows: proposalWorkflowDatabasePath(),
      browser: status,
      page: null,
    };
    if (status.running) {
      await withBrowser(config, 'https://www.upwork.com/nx/find-work/best-matches', async ({ page }) => {
        const state = await inspectPageState(page);
        report.page = {
          url: state.url,
          title: state.title,
          authenticated: !state.loggedOut,
          cloudflare: state.cloudflare,
          captcha: state.captcha,
          feedCards: state.feedCards,
          searchCards: state.jobCards,
        };
      }, { allowAnyPage: true });
    }
    console.log(JSON.stringify(report, null, 2));
  });

program.configureOutput({
  outputError: (string, write) => write(`Error: ${string.replace(/^error:\s*/i, '')}`),
});

program.hook('preAction', (_command, action) => validateCommandOptions(action.opts()));

try {
  await program.parseAsync(process.argv);
} catch (error) {
  process.stderr.write(`\nError: ${error.message}\n`);
  process.exitCode = 1;
}
