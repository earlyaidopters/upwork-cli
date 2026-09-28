import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ageHours, canonicalJobUrl, ensureDirectory, stateDirectory } from './util.mjs';

const SCHEMA_VERSION = 4;

export function databasePath() {
  return path.join(stateDirectory(), 'data', 'jobs.sqlite');
}

function ensureSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      uid TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      url TEXT,
      posted_text TEXT,
      posted_at TEXT,
      age_hours REAL,
      job_type TEXT,
      hourly_min REAL,
      hourly_max REAL,
      fixed_budget REAL,
      proposals TEXT,
      proposals_max INTEGER,
      payment_verified INTEGER NOT NULL DEFAULT 0,
      client_rating REAL,
      client_spend REAL,
      client_spend_label TEXT,
      client_country TEXT,
      location_scope TEXT NOT NULL DEFAULT 'unknown',
      location_restriction TEXT,
      eligible_for_profile INTEGER,
      detail_inspected_at TEXT,
      experience_level TEXT,
      duration TEXT,
      featured INTEGER NOT NULL DEFAULT 0,
      score REAL,
      source TEXT,
      query_text TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      seen_count INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pull_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      queries_json TEXT NOT NULL DEFAULT '[]',
      options_json TEXT NOT NULL DEFAULT '{}',
      jobs_seen INTEGER NOT NULL DEFAULT 0,
      jobs_new INTEGER NOT NULL DEFAULT 0,
      jobs_refreshed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'complete'
    );

    CREATE TABLE IF NOT EXISTS sightings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES pull_runs(id) ON DELETE CASCADE,
      job_uid TEXT NOT NULL REFERENCES jobs(uid) ON DELETE CASCADE,
      seen_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      query_text TEXT NOT NULL DEFAULT '',
      page INTEGER NOT NULL DEFAULT 0,
      position INTEGER,
      posted_text TEXT,
      age_hours REAL,
      proposals TEXT,
      proposals_max INTEGER,
      score REAL,
      snapshot_json TEXT NOT NULL,
      UNIQUE(run_id, job_uid, source, query_text, page)
    );

    CREATE INDEX IF NOT EXISTS jobs_first_seen_idx ON jobs(first_seen);
    CREATE INDEX IF NOT EXISTS jobs_last_seen_idx ON jobs(last_seen);
    CREATE INDEX IF NOT EXISTS jobs_score_idx ON jobs(score);
    CREATE INDEX IF NOT EXISTS jobs_posted_at_idx ON jobs(posted_at);
    CREATE INDEX IF NOT EXISTS runs_completed_at_idx ON pull_runs(completed_at);
    CREATE INDEX IF NOT EXISTS sightings_job_uid_idx ON sightings(job_uid);
    CREATE INDEX IF NOT EXISTS sightings_query_idx ON sightings(query_text, seen_at);
  `);
  const jobColumns = new Set(db.prepare('PRAGMA table_info(jobs)').all().map((row) => row.name));
  const additions = [
    ['location_scope', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['location_restriction', 'TEXT'],
    ['eligible_for_profile', 'INTEGER'],
    ['detail_inspected_at', 'TEXT'],
  ];
  for (const [name, definition] of additions) {
    if (!jobColumns.has(name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${definition}`);
  }
  db.prepare(`
    INSERT INTO metadata (key, value) VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(SCHEMA_VERSION));
}

async function openDatabase() {
  await ensureDirectory(path.dirname(databasePath()));
  const db = new DatabaseSync(databasePath());
  try {
    ensureSchema(db);
    return db;
  } catch (error) { db.close(); throw error; }
}

function validIso(value, fallback) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function estimatePostedAt(job, fallback) {
  if (job.postedAt) return validIso(job.postedAt, null);
  const scrapedAt = validIso(job.scrapedAt, fallback);
  const age = job.ageHours ?? ageHours(job.posted);
  if (age == null || !scrapedAt) return null;
  return new Date(new Date(scrapedAt).getTime() - Number(age) * 60 * 60 * 1000).toISOString();
}

function jobValues(job, now) {
  const firstSeen = now;
  const lastSeen = now;
  const canonicalUrl = canonicalJobUrl(job.uid, job.title) || job.url || null;
  const payload = { ...job, url: canonicalUrl, firstSeen, lastSeen };
  return [
    String(job.uid),
    String(job.title || ''),
    canonicalUrl,
    job.posted || null,
    estimatePostedAt(job, lastSeen),
    job.ageHours ?? ageHours(job.posted),
    job.jobType || null,
    job.hourlyMin ?? null,
    job.hourlyMax ?? null,
    job.fixedBudget ?? null,
    job.proposals || null,
    job.proposalsMax ?? null,
    job.paymentVerified ? 1 : 0,
    job.clientRating ?? null,
    job.clientSpend ?? null,
    job.clientSpendLabel || null,
    job.clientCountry || null,
    job.locationScope || 'unknown',
    job.locationRestriction || null,
    job.eligibleForProfile == null ? null : (job.eligibleForProfile ? 1 : 0),
    job.detailInspectedAt || null,
    job.experienceLevel || null,
    job.duration || null,
    job.featured ? 1 : 0,
    job.score ?? null,
    job.source || null,
    job.query || null,
    firstSeen,
    lastSeen,
    JSON.stringify(payload),
  ];
}

const UPSERT_JOB_SQL = `
  INSERT INTO jobs (
    uid, title, url, posted_text, posted_at, age_hours, job_type, hourly_min, hourly_max,
    fixed_budget, proposals, proposals_max, payment_verified, client_rating, client_spend,
    client_spend_label, client_country, location_scope, location_restriction,
    eligible_for_profile, detail_inspected_at, experience_level, duration, featured, score, source,
    query_text, first_seen, last_seen, payload_json
  ) VALUES (${Array.from({ length: 30 }, () => '?').join(', ')})
  ON CONFLICT(uid) DO UPDATE SET
    title = excluded.title,
    url = excluded.url,
    posted_text = excluded.posted_text,
    posted_at = COALESCE(excluded.posted_at, jobs.posted_at),
    age_hours = excluded.age_hours,
    job_type = excluded.job_type,
    hourly_min = excluded.hourly_min,
    hourly_max = excluded.hourly_max,
    fixed_budget = excluded.fixed_budget,
    proposals = excluded.proposals,
    proposals_max = excluded.proposals_max,
    payment_verified = excluded.payment_verified,
    client_rating = excluded.client_rating,
    client_spend = excluded.client_spend,
    client_spend_label = excluded.client_spend_label,
    client_country = excluded.client_country,
    location_scope = CASE
      WHEN excluded.detail_inspected_at IS NOT NULL OR excluded.location_scope <> 'unknown' THEN excluded.location_scope
      ELSE jobs.location_scope
    END,
    location_restriction = CASE WHEN excluded.detail_inspected_at IS NOT NULL THEN excluded.location_restriction ELSE COALESCE(excluded.location_restriction, jobs.location_restriction) END,
    eligible_for_profile = CASE WHEN excluded.detail_inspected_at IS NOT NULL THEN excluded.eligible_for_profile ELSE COALESCE(excluded.eligible_for_profile, jobs.eligible_for_profile) END,
    detail_inspected_at = COALESCE(excluded.detail_inspected_at, jobs.detail_inspected_at),
    experience_level = excluded.experience_level,
    duration = excluded.duration,
    featured = excluded.featured,
    score = excluded.score,
    source = excluded.source,
    query_text = excluded.query_text,
    last_seen = excluded.last_seen,
    seen_count = jobs.seen_count + 1,
    payload_json = json_patch(jobs.payload_json, excluded.payload_json)
`;

function uniqueJobs(jobs) {
  const map = new Map();
  for (const job of jobs || []) {
    if (!job?.uid) continue;
    const previous = map.get(String(job.uid));
    map.set(String(job.uid), previous ? { ...previous, ...job } : job);
  }
  return [...map.values()];
}

function insertRun(db, context, counts) {
  const result = db.prepare(`
    INSERT INTO pull_runs (
      command, started_at, completed_at, queries_json, options_json,
      jobs_seen, jobs_new, jobs_refreshed, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    context.command || 'pull',
    context.startedAt,
    context.completedAt,
    JSON.stringify(context.queries || []),
    JSON.stringify(context.options || {}),
    counts.seen,
    counts.added,
    counts.updated,
    context.status || 'complete',
  );
  return Number(result.lastInsertRowid);
}

function insertSightings(db, runId, observations, jobById, seenAt) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sightings (
      run_id, job_uid, seen_at, source, query_text, page, position,
      posted_text, age_hours, proposals, proposals_max, score, snapshot_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const observation of observations || []) {
    if (!observation?.uid) continue;
    const job = { ...(jobById.get(String(observation.uid)) || {}), ...observation };
    insert.run(
      runId,
      String(observation.uid),
      seenAt,
      observation.source || '',
      observation.query || observation.feedName || '',
      Number(observation.page || 0),
      observation.position ?? null,
      observation.posted || null,
      observation.ageHours ?? ageHours(observation.posted),
      observation.proposals || null,
      observation.proposalsMax ?? null,
      job.score ?? null,
      JSON.stringify(job),
    );
  }
}

function writeJobsAndRun(db, jobs, context = {}) {
  const rows = uniqueJobs(jobs);
  const observations = context.observations || jobs || [];
  const now = validIso(context.completedAt, new Date().toISOString());
  const startedAt = validIso(context.startedAt, now);
  const existing = db.prepare('SELECT 1 FROM jobs WHERE uid = ?');

  const upsert = db.prepare(UPSERT_JOB_SQL);
  const jobById = new Map(rows.map((job) => [String(job.uid), job]));

  db.exec('BEGIN IMMEDIATE');
  try {
    const known = new Set(rows.filter(job => existing.get(String(job.uid))).map(job => String(job.uid)));
    const counts = { seen: rows.length, added: rows.length - known.size, updated: known.size };
    for (const job of rows) upsert.run(...jobValues(job, now));
    const runId = insertRun(db, {
      ...context,
      startedAt,
      completedAt: now,
    }, counts);
    insertSightings(db, runId, observations, jobById, now);
    db.exec('COMMIT');
    return { ...counts, runId };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function rowToJob(row) {
  const payload = JSON.parse(row.payload_json || '{}');
  return {
    ...payload,
    url: canonicalJobUrl(row.uid, row.title || payload.title) || row.url || payload.url || null,
    locationScope: row.location_scope || payload.locationScope || 'unknown',
    locationRestriction: row.location_restriction ?? payload.locationRestriction ?? null,
    eligibleForProfile: row.eligible_for_profile == null
      ? (payload.eligibleForProfile ?? null)
      : Boolean(row.eligible_for_profile),
    detailInspectedAt: row.detail_inspected_at ?? payload.detailInspectedAt ?? null,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    seenCount: Number(row.seen_count),
    postedAt: row.posted_at,
  };
}

export async function initializeDatabase() {
  const db = await openDatabase();
  try {
    const total = Number(db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count);
    return { path: databasePath(), schemaVersion: SCHEMA_VERSION, total };
  } finally {
    db.close();
  }
}

export async function loadJobs({ limit = null } = {}) {
  const db = await openDatabase();
  try {
    const sql = `SELECT * FROM jobs ORDER BY last_seen DESC${limit == null ? '' : ' LIMIT ?'}`;
    const rows = limit == null
      ? db.prepare(sql).all()
      : db.prepare(sql).all(Math.max(0, Number(limit)));
    return rows.map(rowToJob);
  } finally {
    db.close();
  }
}

export async function loadJobsByIds(ids) {
  const unique = [...new Set(ids.filter(value => value != null).map(String))];
  if (!unique.length) return [];
  const db = await openDatabase();
  try {
    const jobs = [];
    // Bounded batches stay below SQLite parameter limits for large hunts.
    for (let offset = 0; offset < unique.length; offset += 500) {
      const batch = unique.slice(offset, offset + 500);
      jobs.push(...db.prepare(`SELECT * FROM jobs WHERE uid IN (${batch.map(() => '?').join(',')})`).all(...batch).map(rowToJob));
    }
    return jobs;
  } finally { db.close(); }
}

export async function recordPull(jobs, context = {}) {
  const db = await openDatabase();
  try {
    const result = writeJobsAndRun(db, jobs, context);
    const total = Number(db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count);
    return { ...result, total, jobs: uniqueJobs(jobs) };
  } finally {
    db.close();
  }
}

export async function upsertJobs(jobs, context = {}) {
  return recordPull(jobs, { command: 'upsert', ...context });
}

export async function previouslySeenIds() {
  const db = await openDatabase();
  try {
    return new Set(db.prepare('SELECT uid FROM jobs').all().map((row) => String(row.uid)));
  } finally {
    db.close();
  }
}

export async function findJob(uid) {
  const db = await openDatabase();
  try {
    const value = String(uid).trim();
    const reference = value.match(/~02(\d+)/)?.[1] || value;
    const row = db.prepare('SELECT * FROM jobs WHERE uid = ?').get(reference);
    return row ? rowToJob(row) : null;
  } finally {
    db.close();
  }
}

export async function loadRuns(limit = 20) {
  const db = await openDatabase();
  try {
    return db.prepare(`
      SELECT id, command, started_at AS startedAt, completed_at AS completedAt,
             queries_json AS queriesJson, options_json AS optionsJson,
             jobs_seen AS jobsSeen, jobs_new AS jobsNew,
             jobs_refreshed AS jobsRefreshed, status
      FROM pull_runs ORDER BY id DESC LIMIT ?
    `).all(Math.max(1, Number(limit))).map((row) => ({
      ...row,
      queries: JSON.parse(row.queriesJson || '[]'),
      options: JSON.parse(row.optionsJson || '{}'),
      queriesJson: undefined,
      optionsJson: undefined,
    }));
  } finally {
    db.close();
  }
}

export async function databaseStats() {
  const db = await openDatabase();
  try {
    const scalar = (sql, ...params) => Number(db.prepare(sql).get(...params).value || 0);
    const now = Date.now();
    const since = (days) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
    return {
      path: databasePath(),
      schemaVersion: SCHEMA_VERSION,
      jobs: scalar('SELECT COUNT(*) AS value FROM jobs'),
      sightings: scalar('SELECT COUNT(*) AS value FROM sightings'),
      runs: scalar('SELECT COUNT(*) AS value FROM pull_runs'),
      newLast24Hours: scalar('SELECT COUNT(*) AS value FROM jobs WHERE first_seen >= ?', since(1)),
      newLast7Days: scalar('SELECT COUNT(*) AS value FROM jobs WHERE first_seen >= ?', since(7)),
      newLast30Days: scalar('SELECT COUNT(*) AS value FROM jobs WHERE first_seen >= ?', since(30)),
      paymentVerified: scalar('SELECT COUNT(*) AS value FROM jobs WHERE payment_verified = 1'),
      highFit: scalar('SELECT COUNT(*) AS value FROM jobs WHERE score >= 40'),
      locationInspected: scalar("SELECT COUNT(*) AS value FROM jobs WHERE detail_inspected_at IS NOT NULL"),
      locationIneligible: scalar('SELECT COUNT(*) AS value FROM jobs WHERE eligible_for_profile = 0'),
    };
  } finally {
    db.close();
  }
}

export async function loadTrends(days = 30) {
  const db = await openDatabase();
  try {
    const cutoff = new Date(Date.now() - Math.max(1, Number(days)) * 24 * 60 * 60 * 1000).toISOString();
    return db.prepare(`
      SELECT substr(first_seen, 1, 10) AS day,
             COUNT(*) AS newJobs,
             SUM(CASE WHEN payment_verified = 1 THEN 1 ELSE 0 END) AS verifiedJobs,
             SUM(CASE WHEN score >= 40 THEN 1 ELSE 0 END) AS highFitJobs,
             ROUND(AVG(score), 1) AS averageScore,
             ROUND(AVG(hourly_max), 2) AS averageHourlyCeiling,
             MAX(hourly_max) AS maximumHourlyCeiling
      FROM jobs
      WHERE first_seen >= ?
      GROUP BY substr(first_seen, 1, 10)
      ORDER BY day DESC
    `).all(cutoff);
  } finally {
    db.close();
  }
}

export async function loadQueryTrends(days = 30, limit = 25) {
  const db = await openDatabase();
  try {
    const cutoff = new Date(Date.now() - Math.max(1, Number(days)) * 24 * 60 * 60 * 1000).toISOString();
    return db.prepare(`
      SELECT query_text AS query,
             COUNT(DISTINCT job_uid) AS uniqueJobs,
             COUNT(*) AS sightings,
             ROUND(AVG(score), 1) AS averageScore,
             MAX(score) AS maximumScore
      FROM sightings
      WHERE seen_at >= ? AND query_text <> ''
      GROUP BY query_text
      ORDER BY uniqueJobs DESC, averageScore DESC
      LIMIT ?
    `).all(cutoff, Math.max(1, Number(limit)));
  } finally {
    db.close();
  }
}
