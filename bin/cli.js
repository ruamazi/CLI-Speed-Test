#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { CloudflareClient } from '../src/cloudflare.js';
import { measureDownload, measureLatency, measureUpload } from '../src/measure.js';
import { Reporter } from '../src/render.js';
import { formatMbps, formatMs } from '../src/stats.js';
import { abortError, describeError, isAbortError } from '../src/util.js';

const DEFAULT_DURATION_SECONDS = 8;
const DEFAULT_CONNECTIONS = 6;

async function main() {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );

  let values;
  try {
    ({ values } = parseArgs({
      options: {
        duration: { type: 'string', short: 'd' },
        connections: { type: 'string', short: 'c' },
        json: { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    process.stderr.write(`Error: ${describeError(error)}\n\n`);
    printHelp(pkg);
    return 1;
  }

  if (values.help) {
    printHelp(pkg);
    return 0;
  }

  if (values.version) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  let durationSeconds;
  let connections;
  try {
    durationSeconds = parseNumberOption(
      values.duration,
      '--duration',
      DEFAULT_DURATION_SECONDS,
      { min: 1, max: 120, integer: false },
    );
    connections = parseNumberOption(
      values.connections,
      '--connections',
      DEFAULT_CONNECTIONS,
      { min: 1, max: 16, integer: true },
    );
  } catch (error) {
    process.stderr.write(`Error: ${describeError(error)}\n\n`);
    printHelp(pkg);
    return 1;
  }

  const durationMs = Math.round(durationSeconds * 1000);
  const json = values.json;
  const tty = Boolean(process.stdout.isTTY);
  const color =
    !json &&
    !values['no-color'] &&
    !('NO_COLOR' in process.env) &&
    tty &&
    process.env.TERM !== 'dumb';

  const reporter = new Reporter({ tty, color, silent: json });
  const abortController = new AbortController();
  const signal = abortController.signal;
  let sigintCount = 0;
  let client = null;
  let startedAt = null;

  const onSigint = () => {
    sigintCount += 1;
    if (sigintCount > 1) {
      reporter.cancel();
      process.exit(130);
    }
    abortController.abort();
  };
  process.on('SIGINT', onSigint);

  try {
    reporter.start();

    startedAt = new Date();
    const errors = {};
    const warnings = [];

    client = new CloudflareClient({ connections, signal });

    let meta = null;
    try {
      meta = await client.getMeta();
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw abortError();
      warnings.push(
        `Connection details unavailable: ${describeError(error)}`,
      );
    }

    const runPhase = async (name, task, formatDone) => {
      if (signal.aborted) throw abortError();

      try {
        const result = await task();
        if (signal.aborted) throw abortError();
        reporter.done(name, formatDone(result));
        return result;
      } catch (error) {
        if (signal.aborted || isAbortError(error)) throw abortError();
        const message = describeError(error);
        errors[name.toLowerCase()] = message;
        reporter.fail(name, message);
        return null;
      }
    };

    const ping = await runPhase(
      'Ping',
      () =>
        measureLatency(client, {
          signal,
          onProgress: ({ ms, fraction }) => {
            reporter.progress('Ping', formatMs(ms), fraction);
          },
        }),
      (result) => {
        if (!Number.isFinite(result.jitterMs)) return formatMs(result.ms);
        return `${formatMs(result.ms)}  ·  jitter ${formatMs(result.jitterMs)}`;
      },
    );

    const download = await runPhase(
      'Download',
      () =>
        measureDownload(client, {
          signal,
          durationMs,
          connections,
          onProgress: ({ mbps, fraction, warmingUp }) => {
            reporter.progress(
              'Download',
              warmingUp || !Number.isFinite(mbps) ? 'warming up…' : formatMbps(mbps),
              fraction,
            );
          },
        }),
      (result) => formatMbps(result.mbps),
    );

    const upload = await runPhase(
      'Upload',
      () =>
        measureUpload(client, {
          signal,
          durationMs,
          connections,
          latencyMs: ping?.ms ?? null,
          onProgress: ({ mbps, fraction, warmingUp, finishing }) => {
            const text = finishing
              ? 'finishing…'
              : warmingUp || !Number.isFinite(mbps)
                ? 'measuring…'
                : formatMbps(mbps);
            reporter.progress('Upload', text, fraction);
          },
        }),
      (result) => formatMbps(result.mbps),
    );

    reporter.blank();

    if (download?.partial) {
      warnings.push('Download finished with one or more connection errors.');
    }
    if (upload?.partial) {
      warnings.push('Upload finished with one or more connection errors.');
    }

    if (meta) {
      const isp = meta.isp
        ? meta.asn
          ? `${meta.isp} (AS${meta.asn})`
          : meta.isp
        : null;

      let edge = null;
      if (meta.colo) {
        const place = [meta.coloCity, meta.coloCountry]
          .filter(Boolean)
          .join(', ');
        edge = place ? `${place} (${meta.colo})` : meta.colo;
      }

      reporter.detail('ISP', isp);
      reporter.detail('IP', meta.ip);
      reporter.detail('Edge', edge);
    }

    reporter.detail(
      'Tested',
      new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );

    if (warnings.length > 0) {
      reporter.blank();
      for (const warning of warnings) reporter.warning(warning);
    }

    const finishedAt = new Date();
    const output = {
      server: meta
        ? {
            ip: meta.ip,
            isp: meta.isp,
            asn: meta.asn,
            city: meta.city,
            region: meta.region,
            country: meta.country,
            colo: meta.colo,
            coloCity: meta.coloCity,
            coloCountry: meta.coloCountry,
            protocol: meta.protocol,
          }
        : null,
      ping,
      download,
      upload,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      totalDurationMs: finishedAt.getTime() - startedAt.getTime(),
      warnings,
    };

    if (Object.keys(errors).length > 0) output.errors = errors;

    if (json) {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    }

    if (!download && !upload) return 1;
    if (!ping || !download || !upload) return 2;
    return 0;
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      reporter.cancel();
      process.stderr.write('  Test cancelled.\n');
      return 130;
    }

    reporter.cancel();
    process.stderr.write(`  Error: ${describeError(error)}\n`);
    return 1;
  } finally {
    process.off('SIGINT', onSigint);
    client?.destroy();
  }
}

function parseNumberOption(value, name, fallback, { min, max, integer }) {
  if (value === undefined) return fallback;

  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number < min ||
    number > max ||
    (integer && !Number.isInteger(number))
  ) {
    const type = integer ? 'an integer' : 'a number';
    throw new Error(`${name} must be ${type} between ${min} and ${max}`);
  }

  return number;
}

function printHelp(pkg) {
  process.stdout.write(`
  speed-test ${pkg.version}

  Measure ping, jitter, download and upload speed from the terminal.
  Uses Cloudflare's edge network; no API key or external binary required.

  Usage:
    speed-test [options]
    npm start -- [options]

  Options:
    -d, --duration <seconds>   Measurement time per direction (default: ${DEFAULT_DURATION_SECONDS})
    -c, --connections <n>      Parallel connections per direction (default: ${DEFAULT_CONNECTIONS})
        --json                 Print machine-readable JSON
        --no-color             Disable ANSI colors
    -h, --help                 Show this help
    -v, --version              Show version

  Examples:
    npm start
    npm start -- --duration 5
    node bin/cli.js --json
    speed-test --no-color
`);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`Error: ${describeError(error)}\n`);
    process.exitCode = 1;
  });
