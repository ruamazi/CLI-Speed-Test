import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { measureUpload } from '../src/measure.js';

function fakeResponse(statusCode, bodyLength) {
  const response = Readable.from([]);
  response.statusCode = statusCode;
  response.headers = {
    'cf-meta-upload-bytes': String(bodyLength),
  };
  return response;
}

test('measureUpload uses server-reported byte counts', async () => {
  const client = {
    async request(_path, { body }) {
      await new Promise((resolve) => setImmediate(resolve));
      return fakeResponse(200, body.length);
    },
  };

  const result = await measureUpload(client, {
    durationMs: 300,
    connections: 2,
    latencyMs: 0,
  });

  assert.ok(result.bytes >= 64 * 1024);
  assert.ok(result.requests >= 1);
  assert.ok(result.mbps > 0);
  assert.equal(result.connections, 2);
  assert.ok(result.durationMs >= 250);
});

test('measureUpload surfaces an HTTP rejection', async () => {
  const client = {
    async request() {
      return fakeResponse(429, 0);
    },
  };

  await assert.rejects(
    measureUpload(client, {
      durationMs: 50,
      connections: 1,
      latencyMs: 0,
    }),
    (error) => {
      assert.equal(error.statusCode, 429);
      return true;
    },
  );
});
