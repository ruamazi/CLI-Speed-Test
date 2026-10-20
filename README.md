# speed-test

[![CI](https://github.com/ruamazi/CLI-Speed-Test/actions/workflows/ci.yml/badge.svg)](https://github.com/ruamazi/CLI-Speed-Test/actions/workflows/ci.yml)

A small terminal internet speed test for **ping, jitter, download, and upload**.

It uses Cloudflare's public edge network and runs entirely on Node.js. There are
no runtime dependencies, API keys, accounts, or external binaries to set up.

## Features

- Ping and jitter over a warm keep-alive connection.
- Multi-connection download and upload measurements.
- Live progress in interactive terminals and clean final output when piped.
- Optional JSON output for scripts and automation.
- No telemetry and no project-owned backend.

## Requirements

- Node.js 20 or newer
- Network access to `speed.cloudflare.com`

## Run it

```sh
git clone https://github.com/ruamazi/CLI-Speed-Test.git
cd CLI-Speed-Test
npm start
```

No install step is needed because the project has no runtime dependencies.

The test takes roughly 20 seconds with the default settings. On a slow
connection the upload phase can take a few seconds longer while the last
request finishes.

### Use it as a command

```sh
npm link
speed-test
```

`npm link` installs a global symlink to this project. To remove it later:

```sh
npm unlink -g speed-test
```

## Example output

```text
  Speed Test · Cloudflare

  Ping       18.4 ms  ·  jitter 2.1 ms
  Download   94.2 Mbps
  Upload     12.8 Mbps

  ISP        Example ISP (AS12345)
  IP         203.0.113.42
  Edge       Amsterdam, NL (AMS)
  Tested     07:32:05 PM
```

The IP address above is from a reserved documentation range and is not a real
client address. While the test is running, the current phase shows a progress
bar and live speed. The final values stay in your terminal scrollback.

## Options

```text
-d, --duration <seconds>   Measurement time per direction (default: 8)
-c, --connections <n>      Parallel connections per direction (default: 6)
    --json                 Print machine-readable JSON
    --no-color             Disable ANSI colors
-h, --help                 Show help
-v, --version              Show version
```

Examples:

```sh
npm start -- --duration 5
node bin/cli.js --json
npm start --silent -- --json
node bin/cli.js --no-color --connections 4
```

`--json` prints only JSON. When invoking through npm, use `--silent` as shown
above so npm's own script banner does not get mixed into stdout.

Colors are also disabled automatically when output is piped, when `NO_COLOR`
is set, or when `TERM=dumb`.

## How it measures

- **Ping / jitter** — sends a series of zero-byte download requests over a
  warm keep-alive connection and measures time-to-first-byte. The first two
  requests warm up DNS/TLS and are discarded. Ping is reported as the median;
  jitter is the mean absolute difference between consecutive samples.
- **Download** — runs multiple parallel streaming downloads for the configured
  measurement window. Each direction begins with a short warm-up that is
  excluded from the result. Download speed is total bytes received divided by
  the measurement time.
- **Upload** — runs parallel upload requests whose sizes adapt to the measured
  rate, targeting roughly three seconds per request. Cloudflare reports exactly
  how many bytes it received in the `cf-meta-upload-bytes` response header, so
  the result is based on server-confirmed data rather than data still sitting in
  the local socket buffer. The last request may finish a few seconds after the
  measurement window, which is included in the reported duration.
- **Connection details** — fetches Cloudflare's `/meta` endpoint to show the
  public IP, ISP/ASN, and the Cloudflare edge location selected for the test.

Results use decimal megabits per second (1 Mbps = 1,000,000 bits/s). Values of
1000 Mbps or more are displayed in Gbps, while the JSON output always uses
`mbps`.

### Data usage

A speed test transfers real data. At 100 Mbps, an 8-second download phase uses
roughly 100 MB, and the upload phase can use a similar amount. Use
`--duration` to shorten the test if you have a metered connection.

## JSON output

`--json` prints only JSON, making the command easy to use from scripts:

```json
{
  "server": {
    "ip": "203.0.113.42",
    "isp": "Example ISP",
    "asn": 12345,
    "city": "Amsterdam",
    "region": "North Holland",
    "country": "NL",
    "colo": "AMS",
    "coloCity": "Amsterdam",
    "coloCountry": "NL",
    "protocol": "HTTP/1.1"
  },
  "ping": {
    "ms": 18.4,
    "jitterMs": 2.1,
    "minMs": 16.2,
    "maxMs": 22.8,
    "samples": 12
  },
  "download": {
    "mbps": 94.2,
    "bytes": 94200000,
    "durationMs": 8000,
    "connections": 6,
    "requestBytes": 8000000
  },
  "upload": {
    "mbps": 12.8,
    "bytes": 12800000,
    "durationMs": 8300,
    "requests": 38,
    "connections": 6
  },
  "startedAt": "2026-10-20T17:32:05.000Z",
  "finishedAt": "2026-10-20T17:32:25.000Z",
  "totalDurationMs": 20000,
  "warnings": []
}
```

If one measurement fails, its value is `null` and an `errors` object explains
why. `server` is `null` when the optional connection details are unavailable.
A direction may also include `"partial": true` when some of its parallel
connections failed but enough data was received to report a result.

## Exit codes

| Code | Meaning |
| :--: | --- |
| 0 | Ping, download, and upload all completed |
| 1 | No bandwidth measurement completed (for example, offline) |
| 2 | Partial result: one or more measurements failed |
| 130 | Cancelled with Ctrl+C |

## Privacy

The test sends measurement traffic directly to Cloudflare. It does not contact
a project-owned server, create an account, or store results. Cloudflare will see
your public IP and approximate location as it would for any request; the CLI
prints the IP, ISP, and edge details locally, and they are included in `--json`
output. Redact those fields before sharing logs publicly.

## Disclaimer

This is an independent project and is not affiliated with or endorsed by
Cloudflare. The service is subject to Cloudflare's own terms and availability.

## Development

```sh
npm test                  # unit tests
node bin/cli.js -d 3      # quick live run (generates network traffic)
```

Project layout:

```text
bin/cli.js       CLI entry point and argument handling
src/             HTTP client, measurements, statistics, and rendering
test/            Node.js test-runner tests
```

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
testing, and pull-request guidance. By participating, you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

Please do not open a public issue for security vulnerabilities; follow
[SECURITY.md](SECURITY.md) instead.

## License

[MIT](LICENSE)
