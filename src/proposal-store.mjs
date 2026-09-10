import fs from 'node:fs/promises';
import path from 'node:path';
import { stateDirectory, writeAtomic } from './util.mjs';

export function proposalDatabasePath() {
  return path.join(stateDirectory(), 'data', 'proposals.json');
}

export async function loadProposalRecords() {
  try {
    const data = JSON.parse(await fs.readFile(proposalDatabasePath(), 'utf8'));
    return Array.isArray(data.proposals) ? data.proposals : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`Could not read proposal records: ${error.message}`);
  }
}

export async function recordProposal(record) {
  const existing = await loadProposalRecords();
  const byId = new Map(existing.map((item) => [item.proposalId, item]));
  byId.set(record.proposalId, { ...byId.get(record.proposalId), ...record });
  const proposals = [...byId.values()].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  await writeAtomic(proposalDatabasePath(), `${JSON.stringify({ version: 1, proposals }, null, 2)}\n`);
  return record;
}
