import { configPath, initializeConfig, loadConfig } from './config.mjs';
import { initializeProfile, loadProfile, profilePath } from './profile.mjs';
import { canonicalLocation } from './eligibility.mjs';
import { parseLaneSelection } from './lanes.mjs';
import { writeAtomic } from './util.mjs';

export async function configureMember({ country, rate, lanes, liveAutomation } = {}) {
  // Validate all supplied fields before creating or changing any file.
  if (country !== undefined && (typeof country !== 'string' || !country.trim())) {
    throw new Error('Country must be a non-empty country name.');
  }
  if (rate !== undefined && (String(rate).trim() === '' || !Number.isFinite(Number(rate)) || Number(rate) <= 0)) {
    throw new Error('Hourly rate must be a positive number.');
  }
  if (liveAutomation !== undefined && typeof liveAutomation !== 'boolean') {
    throw new Error('Live proposal automation must be true or false.');
  }
  const config = await loadConfig();
  const profile = await loadProfile();
  const selectedLanes = lanes === undefined ? undefined : parseLaneSelection(lanes, config);
  if (selectedLanes !== undefined && !selectedLanes.length) throw new Error('Pick at least one lane.');
  if (country !== undefined) config.eligibility.freelancerCountry = canonicalLocation(country);
  if (selectedLanes !== undefined) config.lanes = selectedLanes;
  if (liveAutomation !== undefined) config.proposals.liveAutomation = liveAutomation;
  if (rate !== undefined) profile.defaultHourlyRate = Number(rate);
  const configChanged = country !== undefined || selectedLanes !== undefined || liveAutomation !== undefined;
  if (configChanged) await writeAtomic(configPath(), `${JSON.stringify(config, null, 2)}\n`);
  else await initializeConfig();
  if (rate !== undefined) await writeAtomic(profilePath(), `${JSON.stringify(profile, null, 2)}\n`);
  else await initializeProfile();
  return { configPath: configPath(), profilePath: profilePath(), lanes: config.lanes, liveAutomation: config.proposals.liveAutomation };
}
