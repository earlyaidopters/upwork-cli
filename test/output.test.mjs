import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeJobs, eligibilityLabel } from '../src/output.mjs';
import { csvCell } from '../src/util.mjs';

test('unknown inspected eligibility is not labeled eligible', () => {
  const job = {title:'Example', eligibleForProfile:null, detailInspectedAt:new Date().toISOString()};
  assert.equal(eligibilityLabel(job), 'location unknown');
  assert.match(serializeJobs([job], 'markdown'), /Eligibility: location unknown/);
  assert.equal(serializeJobs([], 'jsonl'), '');
});

test('CSV protects spreadsheet formulas while retaining numeric values and quoting', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell(' +SUM(A1)'), "' +SUM(A1)");
  assert.equal(csvCell(-20), '-20');
  assert.equal(csvCell('a,b'), '"a,b"');
});
