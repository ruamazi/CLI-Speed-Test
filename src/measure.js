import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { HttpError, drain } from './cloudflare.js';
import { abortError, anySignal, isAbortError } from './util.js';
import { round, summarizeLatency, toMbps } from './stats.js';

const LATENCY_SAMPLES = 12;
const LATENCY_WARMUP = 2;
const LATENCY_TIMEOUT_MS = 3000;
const LATENCY_BUDGET_MS = 12_000;

const DOWNLOAD_REQUEST_BYTES = 8_000_000;
const DOWNLOAD_WARMUP_MS = 1500;

const UPLOAD_MIN_CHUNK_BYTES = 64 * 1024;
const UPLOAD_MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const UPLOAD_TARGET_REQUEST_MS = 3000;
const UPLOAD_REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_SAFETY_EXTRA_MS = 35_000;

export async function measureLatency(
  client,
  { signal, count = LATENCY_SAMPLES, onProgress } = {},
) {
  const deadline = performance.now() + LATENCY_BUDGET_MS;
  const samples = [];
  let lastError = null;
  let consecutiveFailures = 0;

  const pingOnce = () =>
    client.latencyOnce({
      signal,
      timeoutMs: Math.max(
        250,
        Math.min(LATENCY_TIMEOUT_MS, deadline - performance.now()),
      ),
    });

  // Warm up the TLS connection and throw away the first measurements.
  for (let index = 0; index < LATENCY_WARMUP; index += 1) {
    if (signal?.aborted) throw abortError();
    if (performance.now() >= deadline) break;

    try {
      await pingOnce();
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw abortError();
      lastError = error;
    }
  }

  for (let index = 0; index < count; index += 1) {
    if (signal?.aborted) throw abortError();
    if (performance.now() >= deadline) break;

    try {
      const milliseconds = await pingOnce();
      if (signal?.aborted) throw abortError();

      samples.push(milliseconds);
      consecutiveFailures = 0;
      onProgress?.({
        ms: milliseconds,
        sample: samples.length,
        count,
        fraction: samples.length / count,
      });
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw abortError();
      lastError = error;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3 && samples.length === 0) throw error;
    }
  }

  if (samples.length < 3) {
    throw lastError || new Error('Not enough latency samples');
  }

  return summarizeLatency(samples);
}

export async function measureDownload(
  client,
  {
    signal,
    durationMs,
    connections = 6,
    onProgress,
    warmupMs = DOWNLOAD_WARMUP_MS,
  } = {},
) {
  const controller = new AbortController();
  const combined = anySignal([signal, controller.signal]);

  const start = performance.now();
  const measureStart = start + warmupMs;
  const end = measureStart + durationMs;

  let measuredBytes = 0;
  let firstError = null;
  let stopped = false;

  const activeResponses = new Set();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    for (const response of activeResponses) response.destroy(abortError());
  };

  const endTimer = setTimeout(stop, Math.max(0, end - performance.now()) + 50);
  const progressTimer = setInterval(() => {
    if (signal?.aborted) return;

    const now = performance.now();
    if (now >= measureStart) {
      const elapsed = Math.min(now, end) - measureStart;
      onProgress?.({
        mbps:
          elapsed >= 750 ? toMbps(measuredBytes, elapsed) : null,
        fraction: Math.min(1, Math.max(0, elapsed / durationMs)),
        warmingUp: elapsed < 750,
      });
    } else {
      onProgress?.({ mbps: null, fraction: 0, warmingUp: true });
    }
  }, 200);

  async function worker() {
    while (!combined.aborted && !stopped) {
      if (performance.now() >= end) return;

      let response;
      try {
        response = await client.request(
          `/__down?bytes=${DOWNLOAD_REQUEST_BYTES}&r=${Math.random()
            .toString(36)
            .slice(2)}`,
          {
            signal: combined,
            timeoutMs: Math.max(5000, end - performance.now() + 5000),
            headers: { 'cache-control': 'no-store' },
          },
        );
      } catch (error) {
        if (combined.aborted || isAbortError(error)) return;
        if (!firstError) firstError = error;
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        if (!firstError) {
          firstError = new HttpError(response.statusCode, '/__down');
        }
        return;
      }

      activeResponses.add(response);
      const onAbort = () => response.destroy(abortError());
      combined.addEventListener('abort', onAbort, { once: true });

      try {
        for await (const chunk of response) {
          const receivedAt = performance.now();
          if (receivedAt >= measureStart && receivedAt < end) {
            measuredBytes += chunk.length;
          }
          if (receivedAt >= end) break;
        }
      } catch (error) {
        if (!combined.aborted && !isAbortError(error) && !firstError) {
          firstError = error;
        }
      } finally {
        combined.removeEventListener('abort', onAbort);
        activeResponses.delete(response);
        if (!response.readableEnded) response.destroy();
      }
    }
  }

  try {
    const results = await Promise.allSettled(
      Array.from({ length: connections }, () => worker()),
    );
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected && !firstError) firstError = rejected.reason;
  } finally {
    clearTimeout(endTimer);
    clearInterval(progressTimer);
    for (const response of activeResponses) response.destroy();
    activeResponses.clear();
  }

  if (signal?.aborted) throw abortError();
  if (measuredBytes <= 0) {
    throw firstError || new Error('No download data received');
  }

  const mbps = toMbps(measuredBytes, durationMs);
  onProgress?.({ mbps, fraction: 1, warmingUp: false });

  return {
    mbps: round(mbps, 2),
    bytes: measuredBytes,
    durationMs: Math.round(durationMs),
    connections,
    requestBytes: DOWNLOAD_REQUEST_BYTES,
    ...(firstError ? { partial: true } : {}),
  };
}

export async function measureUpload(
  client,
  { signal, durationMs, connections = 4, latencyMs = null, onProgress } = {},
) {
  if (signal?.aborted) throw abortError();

  const controller = new AbortController();
  const combined = anySignal([signal, controller.signal]);
  const body = randomBytes(UPLOAD_MAX_CHUNK_BYTES);

  const start = performance.now();
  const deadline = start + durationMs;

  let confirmedBytes = 0;
  let successfulRequests = 0;
  let lastResponseAt = start;
  let firstError = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
  };

  const safetyTimer = setTimeout(stop, durationMs + UPLOAD_SAFETY_EXTRA_MS);

  const progressTimer = setInterval(() => {
    if (signal?.aborted) return;

    const now = performance.now();
    const elapsed = Math.max(1, now - start);
    onProgress?.({
      mbps: confirmedBytes > 0 ? toMbps(confirmedBytes, elapsed) : null,
      fraction: Math.min(1, Math.max(0, elapsed / durationMs)),
      warmingUp: confirmedBytes === 0,
      finishing: now >= deadline,
    });
  }, 200);

  async function worker() {
    let chunkBytes = UPLOAD_MIN_CHUNK_BYTES;

    while (!combined.aborted && !stopped) {
      if (performance.now() >= deadline) return;

      let result;
      try {
        result = await uploadOnce(client, body, chunkBytes, combined);
      } catch (error) {
        if (combined.aborted || isAbortError(error)) return;
        if (!firstError) firstError = error;
        return;
      }

      confirmedBytes += result.bytes;
      successfulRequests += 1;
      lastResponseAt = performance.now();

      // Size the next request from this one. Subtract at most half of the
      // request time as latency; this prevents a high-latency connection
      // from producing a wildly oversized next request.
      const latency = Number.isFinite(latencyMs)
        ? Math.min(Math.max(0, latencyMs), result.elapsedMs * 0.5)
        : 0;
      const transferMs = Math.max(1, result.elapsedMs - latency);
      const rateMbps = toMbps(result.bytes, transferMs);

      if (Number.isFinite(rateMbps) && rateMbps > 0) {
        const targetBytes =
          ((rateMbps * 1_000_000) / 8) *
          (UPLOAD_TARGET_REQUEST_MS / 1000);
        chunkBytes = Math.min(
          UPLOAD_MAX_CHUNK_BYTES,
          Math.max(
            UPLOAD_MIN_CHUNK_BYTES,
            Math.round(targetBytes / 1024) * 1024,
          ),
        );
      }
    }
  }

  try {
    const results = await Promise.allSettled(
      Array.from({ length: connections }, () => worker()),
    );
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected && !firstError) firstError = rejected.reason;
  } finally {
    clearTimeout(safetyTimer);
    clearInterval(progressTimer);
  }

  if (signal?.aborted) throw abortError();
  if (confirmedBytes <= 0) {
    throw firstError || new Error('Upload measurement failed');
  }

  const elapsedMs = Math.max(1, lastResponseAt - start);
  const mbps = toMbps(confirmedBytes, elapsedMs);
  onProgress?.({
    mbps,
    fraction: 1,
    warmingUp: false,
    finishing: false,
  });

  return {
    mbps: round(mbps, 2),
    bytes: confirmedBytes,
    durationMs: Math.round(elapsedMs),
    requests: successfulRequests,
    connections,
    ...(firstError || stopped ? { partial: true } : {}),
  };
}

async function uploadOnce(client, source, size, signal) {
  const started = performance.now();
  const response = await client.request(
    `/__up?r=${Math.random().toString(36).slice(2)}`,
    {
      method: 'POST',
      signal,
      timeoutMs: UPLOAD_REQUEST_TIMEOUT_MS,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(size),
        'cache-control': 'no-store',
      },
      body: source.subarray(0, size),
    },
  );
  const elapsedMs = performance.now() - started;

  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.resume();
    throw new HttpError(response.statusCode, '/__up');
  }

  const reported = Number(response.headers['cf-meta-upload-bytes']);
  await drain(response, { signal });

  return {
    bytes: Number.isFinite(reported) ? reported : size,
    elapsedMs,
  };
}
