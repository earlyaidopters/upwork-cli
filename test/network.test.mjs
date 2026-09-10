import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startSanitizedTrace } from '../src/network.mjs';

test('trace excludes lookalike hosts and redacts search terms and tokens', () => {
  const page = new EventEmitter();
  const trace = startSanitizedTrace(page);
  const request = url => ({url:()=>url, method:()=> 'GET', resourceType:()=> 'fetch', postData:()=>null});
  page.emit('request', request('https://upwork.com.evil.example/api?token=secret'));
  page.emit('request', request('https://notupwork.com/api'));
  page.emit('request', request('https://www.upwork.com/api?q=private-client&token=secret&page=2'));
  const entries = trace.stop();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].params.page, '2');
  assert.equal(entries[0].params.q, '<redacted>');
  assert.doesNotMatch(JSON.stringify(entries), /private-client|secret|evil/);
  assert.equal(page.listenerCount('request'), 0);
});
