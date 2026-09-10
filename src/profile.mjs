import fs from 'node:fs/promises';
import path from 'node:path';
import { stateDirectory, writeAtomic } from './util.mjs';

export const DEFAULT_PROFILE = {
  "name": "",
  "positioning": "",
  "defaultHourlyRate": null,
  "voice": [
    "Use plain language and concrete examples.",
    "Preserve the writer’s natural cadence.",
    "Vary sentence length when the thought calls for it."
  ],
  "proposalVoice": {
    "version": 2,
    "objective": "Communicate your relevant experience with verified evidence. Let the reader judge fit without repeating the posting.",
    "coverLetterWordRange": [
      130,
      220
    ],
    "screeningAnswerWordRange": [
      70,
      170
    ],
    "coverLetterOrder": [
      "Open with the strongest relevant proof or a genuine shared detail.",
      "Give one real example with a concrete mechanism.",
      "State relevant terms directly.",
      "Include only useful proof links and your name."
    ],
    "screeningAnswerOrder": [
      "Answer the question directly.",
      "Support the answer with your strongest relevant evidence.",
      "Explain the mechanism or artifact.",
      "Distinguish observed outcomes from intended outcomes."
    ],
    "cadenceExamples": [],
    "rejectedMoves": [
      "Do not paraphrase the posting as an opener.",
      "Do not invent personas, achievements, clients, or metrics.",
      "Do not turn the cover letter into a biography.",
      "Do not copy someone else’s voice examples as your own facts."
    ]
  },
  "truthRules": [
    "Never submit without explicit consent for the exact final version.",
    "Show the cover letter and every screening answer separately before requesting consent.",
    "Never invent facts, metrics, clients, attendance, revenue, or outcomes.",
    "Use only evidence supplied by the user.",
    "Distinguish measured outcomes from intended outcomes.",
    "Do not include off-platform contact requests.",
    "Run proposal lint and inspect warnings in context.",
    "Avoid em dashes in proposal copy."
  ],
  "facts": [],
  "proof": []
};

export function profilePath() {
  return process.env.UPWORK_JOBS_PROFILE
    ? path.resolve(process.env.UPWORK_JOBS_PROFILE)
    : path.join(stateDirectory(), 'profile.json');
}

export async function loadProfile() {
  try {
    const profile = JSON.parse(await fs.readFile(profilePath(), 'utf8'));
    return { ...structuredClone(DEFAULT_PROFILE), ...profile };
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(DEFAULT_PROFILE);
    throw new Error(`Could not read ${profilePath()}: ${error.message}`);
  }
}

export async function initializeProfile({ force = false } = {}) {
  const destination = profilePath();
  if (!force) {
    try {
      await fs.access(destination);
      return { created: false, path: destination };
    } catch {}
  }
  await writeAtomic(destination, `${JSON.stringify(DEFAULT_PROFILE, null, 2)}\n`);
  return { created: true, path: destination };
}
