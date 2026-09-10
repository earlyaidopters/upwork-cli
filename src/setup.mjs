import { configPath, initializeConfig, loadConfig } from './config.mjs';
import { initializeProfile, loadProfile, profilePath } from './profile.mjs';
import { canonicalLocation } from './eligibility.mjs';
import { writeAtomic } from './util.mjs';

export async function configureMember({ country, rate } = {}) {
  // Validate all supplied fields before creating or changing any file.
  if (country !== undefined && (typeof country !== 'string' || !country.trim())) {
    throw new Error('Country must be a non-empty country name.');
  }
  if (rate !== undefined && (String(rate).trim() === '' || !Number.isFinite(Number(rate)) || Number(rate) <= 0)) {
    throw new Error('Hourly rate must be a positive number.');
  }
  const config = await loadConfig();
  const profile = await loadProfile();
  if (country !== undefined) config.eligibility.freelancerCountry = canonicalLocation(country);
  if (rate !== undefined) profile.defaultHourlyRate = Number(rate);
  if (country !== undefined) await writeAtomic(configPath(), `${JSON.stringify(config, null, 2)}\n`);
  else await initializeConfig();
  if (rate !== undefined) await writeAtomic(profilePath(), `${JSON.stringify(profile, null, 2)}\n`);
  else await initializeProfile();
  return { configPath: configPath(), profilePath: profilePath() };
}
