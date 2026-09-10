import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateEligibility } from '../src/eligibility.mjs';
import { filterJobs } from '../src/score.mjs';
import { selectEvidence, assessOpportunity } from '../src/proposal.mjs';
import { DEFAULT_PROFILE } from '../src/profile.mjs';

test('cached eligibility expires and is recomputed for the current country', () => {
  const now = Date.parse('2026-09-10T12:00:00Z');
  const cached = {locationScope:'restricted', allowedLocations:['Canada'], eligibleForProfile:true, detailInspectedAt:'2026-09-10T11:00:00Z'};
  assert.equal(hydrateEligibility({uid:'1'}, cached, {freelancerCountry:'USA'}, now).eligibleForProfile, false);
  assert.equal(hydrateEligibility({uid:'1'}, cached, {freelancerCountry:'Canada'}, now).eligibleForProfile, true);
  const expired = hydrateEligibility({uid:'1'}, cached, {freelancerCountry:'Canada'}, now + 48*3600000);
  assert.equal(expired.eligibleForProfile, null);
  assert.equal(expired.detailInspectedAt, null);
});

test('actionable filtering requires an inspection and confirmed eligibility', () => {
  const jobs = [{uid:'1', eligibleForProfile:true}, {uid:'2', eligibleForProfile:null, detailInspectedAt:'today'}, {uid:'3', eligibleForProfile:true, detailInspectedAt:'today'}];
  assert.deepEqual(filterJobs(jobs, {confirmedEligibleOnly:true}).map(job => job.uid), ['3']);
});

test('proposal packets do not invent expertise or recommend unverified jobs', () => {
  const profile = {...DEFAULT_PROFILE, proof:[{id:'design', title:'Logo design', summary:'A supplied branding example', tags:['design'], urls:[]}]};
  assert.deepEqual(selectEvidence('Kubernetes infrastructure', profile), []);
  assert.equal(assessOpportunity({title:'AI training', eligibleForProfile:null}, profile).verdict, 'inspect eligibility');
  assert.equal(assessOpportunity({title:'AI training', eligibleForProfile:true, detailInspectedAt:'today'}, DEFAULT_PROFILE).verdict, 'add your evidence');
});
