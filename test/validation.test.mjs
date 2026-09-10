import test from 'node:test';
import assert from 'node:assert/strict';
import { object, validateCommandOptions } from '../src/validation.mjs';
import { validateConfig, DEFAULT_CONFIG } from '../src/config.mjs';
import { validateProfile, DEFAULT_PROFILE } from '../src/profile.mjs';

test('invalid command options fail before browser work', () => {
  for (const options of [{pages:'NaN'}, {pages:'1.5'}, {batches:'-1'}, {limit:'0'}, {rate:'Infinity'}, {perPage:'25'}, {inspectTop:''}, {feed:'unknown'}, {eligibleOnly:true, includeIneligible:true}]) {
    assert.throws(() => validateCommandOptions(options));
  }
  validateCommandOptions({pages:'2', inspectTop:'0', minScore:'-10', perPage:'20'});
});

test('configuration validation identifies malformed fields and prototype keys', () => {
  for (const [section, key, value] of [['browser','port',99999], ['search','delayMs',-1], ['ranking','priorityKeywords','AI'], ['eligibility','excludeIneligible','yes']]) {
    const config = structuredClone(DEFAULT_CONFIG);
    config[section][key] = value;
    assert.throws(() => validateConfig(config), new RegExp(`${section}.${key}`));
  }
  assert.throws(() => object(JSON.parse('{"__proto__":{"polluted":true}}'), 'config'), /allowed key/);
  assert.equal({}.polluted, undefined);
});

test('profile validation rejects malformed evidence and credential-bearing links', () => {
  assert.throws(() => validateProfile({...DEFAULT_PROFILE, facts:'a string'}), /facts/);
  const proof = {id:'demo', title:'Demo', summary:'A supplied example', tags:[], urls:['https://user:secret@example.com/demo']};
  assert.throws(() => validateProfile({...DEFAULT_PROFILE, proof:[proof]}), /credentials/);
  assert.throws(() => validateProfile({...DEFAULT_PROFILE, proof:[{...proof, urls:[]}, {...proof, urls:[]}]}), /Duplicate/);
});
