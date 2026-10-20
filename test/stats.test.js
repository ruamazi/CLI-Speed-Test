import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatMbps,
  formatMs,
  jitter,
  median,
  round,
  summarizeLatency,
  toMbps,
} from '../src/stats.js';
import {
  anySignal,
  describeError,
  isAbortError,
  sanitizeText,
} from '../src/util.js';

test('median handles odd, even and empty samples', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([Number.NaN]), null);
});

test('jitter is the mean difference between consecutive samples', () => {
  assert.equal(jitter([10, 10, 10]), 0);
  assert.equal(jitter([10, 20, 10]), 10);
  assert.equal(jitter([10]), null);
});

test('toMbps converts bytes and milliseconds', () => {
  assert.equal(toMbps(1_000_000, 1000), 8);
  assert.equal(toMbps(12_500_000, 1000), 100);
  assert.equal(toMbps(1000, 0), null);
  assert.equal(toMbps(Number.NaN, 1000), null);
});

test('format helpers produce readable values', () => {
  assert.equal(formatMbps(94.24), '94.2 Mbps');
  assert.equal(formatMbps(1234.5), '1.23 Gbps');
  assert.equal(formatMbps(null), 'n/a');
  assert.equal(formatMs(18.44), '18.4 ms');
  assert.equal(formatMs(undefined), 'n/a');
  assert.equal(round(1.235, 2), 1.24);
});

test('summarizeLatency reports median, jitter and range', () => {
  const summary = summarizeLatency([10, 20, 30, 40]);
  assert.deepEqual(summary, {
    ms: 25,
    jitterMs: 10,
    minMs: 10,
    maxMs: 40,
    samples: 4,
  });
  assert.equal(summarizeLatency([]), null);
});

test('anySignal aborts when either source aborts', () => {
  const first = new AbortController();
  const second = new AbortController();
  const combined = anySignal([first.signal, second.signal]);

  second.abort();
  assert.equal(combined.aborted, true);
});

test('anySignal returns an already aborted signal', () => {
  const controller = new AbortController();
  controller.abort();
  const combined = anySignal([controller.signal]);

  assert.equal(combined.aborted, true);
});

test('isAbortError recognises both standard shapes', () => {
  const error = new Error('cancelled');
  error.name = 'AbortError';
  assert.equal(isAbortError(error), true);
  assert.equal(isAbortError({ code: 'ABORT_ERR' }), true);
  assert.equal(isAbortError(new Error('nope')), false);
});

test('sanitizeText removes terminal control sequences', () => {
  assert.equal(sanitizeText('\u001B[31mred\u001B[0m'), 'red');
  assert.equal(sanitizeText('a\u001B]0;title\u0007b'), 'ab');
  assert.equal(sanitizeText('line one\nline two'), 'line one line two');
  assert.equal(sanitizeText('  spaced  '), 'spaced');
  assert.equal(sanitizeText(null), null);
});

test('describeError returns useful messages', () => {
  assert.equal(describeError({ statusCode: 429 }), 'rate limited by the server (try again in a few minutes)');
  assert.equal(describeError({ statusCode: 403 }), 'request blocked by the server (HTTP 403)');
  assert.equal(describeError({ code: 'ENOTFOUND' }), 'DNS lookup failed');
  assert.equal(describeError({ code: 'ETIMEDOUT' }), 'request timed out');
  assert.equal(describeError(new Error('something broke')), 'something broke');
  assert.equal(describeError(new Error('\u001B[31mboom\u001B[0m')), 'boom');
});
