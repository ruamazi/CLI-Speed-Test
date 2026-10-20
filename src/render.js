import process from 'node:process';

import { sanitizeText } from './util.js';

const BAR_WIDTH = 12;
const LABEL_WIDTH = 10;

/**
 * Human-readable terminal output. All methods are no-ops when silent,
 * which is used for --json output.
 */
export class Reporter {
  constructor({
    tty = Boolean(process.stdout.isTTY),
    color = tty,
    silent = false,
  } = {}) {
    this.tty = tty;
    this.color = color;
    this.silent = silent;
    this.lineActive = false;
  }

  style(code, text) {
    if (!this.color) return text;
    return `\x1b[${code}m${text}\x1b[0m`;
  }

  label(text) {
    return this.style('2', text.padEnd(LABEL_WIDTH));
  }

  clearLine() {
    if (this.tty) process.stdout.write('\r\x1b[2K');
  }

  start() {
    if (this.silent) return;
    const title = this.style('1;36', 'Speed Test');
    const divider = this.style('2', '·');
    const provider = this.style('36', 'Cloudflare');
    process.stdout.write(`\n  ${title} ${divider} ${provider}\n\n`);
  }

  progress(name, text, fraction) {
    if (this.silent || !this.tty) return;

    this.clearLine();

    let line = `  ${this.label(name)} `;
    if (Number.isFinite(fraction) && fraction > 0) {
      const clamped = Math.min(1, Math.max(0, fraction));
      const filled = Math.round(clamped * BAR_WIDTH);
      const bar =
        this.style('36', '█'.repeat(filled)) +
        this.style('2', '░'.repeat(BAR_WIDTH - filled));
      line += `${bar}  `;
    }

    line += this.style('1', sanitizeText(text) ?? '');
    process.stdout.write(line);
    this.lineActive = true;
  }

  done(name, text) {
    if (this.silent) return;

    this.clearLine();
    const safeText = sanitizeText(text) ?? '';
    process.stdout.write(`  ${this.label(name)} ${this.style('1', safeText)}\n`);
    this.lineActive = false;
  }

  fail(name, message) {
    if (this.silent) return;

    this.clearLine();
    const safeMessage = sanitizeText(message) ?? 'unknown error';
    process.stdout.write(
      `  ${this.label(name)} ${this.style('33', `— ${safeMessage}`)}\n`,
    );
    this.lineActive = false;
  }

  detail(name, value) {
    const safeValue = sanitizeText(value);
    if (this.silent || safeValue === null || safeValue === undefined || safeValue === '') return;
    process.stdout.write(`  ${this.label(name)} ${safeValue}\n`);
  }

  warning(message) {
    if (this.silent) return;
    const safeMessage = sanitizeText(message) ?? '';
    process.stdout.write(`  ${this.style('33', '!')} ${safeMessage}\n`);
  }

  blank() {
    if (this.silent) return;
    process.stdout.write('\n');
  }

  cancel() {
    if (this.silent) return;
    if (this.lineActive) {
      this.clearLine();
      process.stdout.write('\n');
      this.lineActive = false;
    }
  }
}
