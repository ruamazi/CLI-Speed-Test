# Contributing

Thanks for taking the time to contribute.

## Before you start

- Use Node.js 20 or newer.
- Search existing issues and pull requests before opening a new one.
- For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of
  opening a public issue.
- By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up

Fork and clone the repository, then run:

```sh
cd CLI-Speed-Test
npm test
node bin/cli.js --duration 3
```

No `npm install` is required because the project has no runtime dependencies.
The test suite uses the built-in `node:test` runner. The live run generates
network traffic and reports this machine's current connection speed.

## Making changes

- Keep pull requests focused and describe the user-visible effect.
- Preserve the zero-dependency approach unless there is a compelling reason.
- Add or update tests for logic changes.
- Update the README and [CHANGELOG.md](CHANGELOG.md) when behavior, options,
  output, or the JSON shape changes.
- Do not commit generated files, logs, editor settings, or `node_modules`.
- Run `npm test` before submitting a pull request.

## Privacy and test data

- Do not commit API keys, tokens, passwords, `.env` files, private URLs, or
  other credentials.
- Do not paste real public IP addresses, ISP account details, or raw speed-test
  output into issues or pull requests unless you are comfortable sharing them.
  The CLI prints this information locally and includes it in `--json` output.
- Use documentation IP ranges such as `203.0.113.0/24`, `198.51.100.0/24`, or
  `192.0.2.0/24` in examples.

## Pull requests

1. Create a branch from `main`.
2. Make your change and run `npm test`.
3. Open a pull request using the template.
4. Link any related issues.

Pull requests are reviewed on a best-effort basis. By contributing, you agree
that your contributions are licensed under the [MIT License](LICENSE).
