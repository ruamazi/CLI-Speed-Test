import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { abortError, isAbortError, sanitizeText } from './util.js';

const HOST = 'speed.cloudflare.com';
const USER_AGENT = 'speed-test-cli/1.0.0';

export class HttpError extends Error {
  constructor(statusCode, path) {
    super(`HTTP ${statusCode} from ${path}`);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export class CloudflareClient {
  #agent;
  #signal;

  constructor({ connections = 6, signal } = {}) {
    this.#signal = signal;
    this.#agent = new https.Agent({
      keepAlive: true,
      maxSockets: Math.max(connections, 4) + 2,
      maxFreeSockets: 8,
      timeout: 30_000,
    });
  }

  destroy() {
    this.#agent.destroy();
  }

  /**
   * Make an HTTP request and resolve when response headers are available.
   */
  request(
    path,
    {
      method = 'GET',
      headers = {},
      body,
      signal = this.#signal,
      timeoutMs = 20_000,
    } = {},
  ) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }

      const request = https.request({
        hostname: HOST,
        path,
        method,
        agent: this.#agent,
        headers: {
          'user-agent': USER_AGENT,
          accept: '*/*',
          ...headers,
        },
      });

      let settled = false;

      const onAbort = () => request.destroy(abortError());
      const timer = setTimeout(() => {
        request.destroy(
          new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`),
        );
      }, timeoutMs);

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        callback(value);
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      request.once('response', (response) => finish(resolve, response));
      request.once('error', (error) =>
        finish(reject, isAbortError(error) && signal?.aborted ? abortError() : error),
      );

      request.end(body);
    });
  }

  async getMeta({ signal = this.#signal, timeoutMs = 5000 } = {}) {
    const response = await this.request('/meta', {
      signal,
      timeoutMs,
      headers: {
        accept: 'application/json',
        referer: 'https://speed.cloudflare.com/',
      },
    });

    if (response.statusCode !== 200) {
      response.resume();
      throw new HttpError(response.statusCode, '/meta');
    }

    const text = await readBody(response, {
      signal,
      maxBytes: 128 * 1024,
    });

    try {
      return normalizeMeta(JSON.parse(text));
    } catch (error) {
      if (isAbortError(error)) throw error;
      return null;
    }
  }

  async latencyOnce({ signal = this.#signal, timeoutMs = 3000 } = {}) {
    const started = performance.now();
    const response = await this.request(
      `/__down?bytes=0&r=${Math.random().toString(36).slice(2)}`,
      {
        signal,
        timeoutMs,
        headers: { 'cache-control': 'no-store' },
      },
    );
    const elapsed = performance.now() - started;

    if (response.statusCode !== 200) {
      response.resume();
      throw new HttpError(response.statusCode, '/__down');
    }

    await drain(response, { signal });
    return elapsed;
  }
}

/**
 * Read a response body into a string, with an upper size limit.
 */
export async function readBody(response, { signal, maxBytes = 1024 * 1024 } = {}) {
  const onAbort = () => response.destroy(abortError());
  signal?.addEventListener('abort', onAbort, { once: true });

  const chunks = [];
  let total = 0;

  try {
    for await (const chunk of response) {
      total += chunk.length;
      if (total > maxBytes) {
        response.destroy();
        throw new Error('Response was too large');
      }
      chunks.push(chunk);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Consume and discard a response body.
 */
export function drain(response, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (response.readableEnded || response.destroyed) {
      resolve();
      return;
    }

    const onAbort = () => response.destroy(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    response.once('end', () => {
      cleanup();
      resolve();
    });
    response.once('close', () => {
      cleanup();
      resolve();
    });
    response.once('error', (error) => {
      cleanup();
      if (isAbortError(error)) resolve();
      else reject(error);
    });
    response.resume();
  });
}

function normalizeMeta(data) {
  if (!data || typeof data !== 'object') return null;

  const colo = data.colo && typeof data.colo === 'object' ? data.colo : {};
  const clean = (value) => {
    if (typeof value !== 'string') return value ?? null;
    return sanitizeText(value) || null;
  };

  return {
    ip: clean(data.clientIp),
    isp: clean(data.asOrganization),
    asn: clean(data.asn),
    city: clean(data.city),
    region: clean(data.region),
    country: clean(data.country),
    colo: clean(colo.iata),
    coloCity: clean(colo.city),
    coloCountry: clean(colo.cca2),
    protocol: clean(data.httpProtocol),
  };
}
