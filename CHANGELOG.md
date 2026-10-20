# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-10-20

### Added

- Terminal speed test for ping, jitter, download, and upload.
- Cloudflare edge metadata: public IP, ISP/ASN, and edge location.
- Live progress output for interactive terminals.
- JSON output for scripts and automation.
- Configurable measurement duration and connection count.
- Automatic color handling, including `NO_COLOR` and non-TTY output.
- Unit tests for statistics, abort handling, error messages, and upload
  measurement.
- Documentation for usage, methodology, JSON output, exit codes, privacy, and
  contributing.

### Security

- Terminal output sanitizes server-provided metadata and error text to prevent
  control-sequence injection.
