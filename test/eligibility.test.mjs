import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateLocationEligibility,
  extractLocationRequirement,
  locationEligibility,
} from '../src/eligibility.mjs';

test('extracts and evaluates a U.S.-only hard restriction', () => {
  const requirement = extractLocationRequirement(
    'Posted 3 days ago Only freelancers located in the U.S. may apply. Summary',
  );
  assert.equal(requirement.locationScope, 'restricted');
  assert.deepEqual(requirement.allowedLocations, ['United States']);
  assert.equal(evaluateLocationEligibility(requirement, 'Canada'), false);
  assert.equal(evaluateLocationEligibility(requirement, 'USA'), true);
});

test('treats worldwide jobs as eligible and unknown pages as unconfirmed', () => {
  assert.equal(locationEligibility('Posted today Worldwide Summary', 'Canada').eligibleForProfile, true);
  const unknown = locationEligibility('Posted today Summary', 'Canada');
  assert.equal(unknown.locationScope, 'unknown');
  assert.equal(unknown.eligibleForProfile, null);
});

test('explicit title and body restrictions override Worldwide', () => {
  for (const restriction of ['U.S. residents only', 'US-only', 'United States applicants only', 'Must be based in the USA', 'Only freelancers located in the US']) {
    assert.equal(locationEligibility(`Worldwide ${restriction}`, 'Canada').eligibleForProfile, false, restriction);
    assert.equal(locationEligibility(`Worldwide ${restriction}`, 'United States').eligibleForProfile, true, restriction);
  }
});

test('does not mistake ordinary client geography for a hiring restriction', () => {
  for (const text of ['Worldwide Our clients are in the US', 'Worldwide You will work with Canada residents', 'Worldwide US timezone preferred']) {
    assert.equal(locationEligibility(text, 'Canada').eligibleForProfile, true);
  }
});

test('supports multiple platform locations and case-insensitive country names', () => {
  const text = 'Only freelancers located in Canada or United Kingdom may apply.';
  assert.equal(locationEligibility(text, 'canada').eligibleForProfile, true);
  assert.equal(locationEligibility(text, 'UK').eligibleForProfile, true);
  assert.equal(locationEligibility(text, 'United States').eligibleForProfile, false);
});
