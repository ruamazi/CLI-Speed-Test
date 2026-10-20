/**
 * Pure statistics and formatting helpers.
 * Kept dependency-free so they are easy to unit test.
 */

export function median(values) {
  const numbers = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (numbers.length === 0) return null;

  const middle = Math.floor(numbers.length / 2);
  if (numbers.length % 2 === 1) return numbers[middle];
  return (numbers[middle - 1] + numbers[middle]) / 2;
}

/**
 * Mean absolute difference between consecutive samples.
 */
export function jitter(values) {
  const numbers = values.filter(Number.isFinite);
  if (numbers.length < 2) return null;

  let total = 0;
  for (let index = 1; index < numbers.length; index += 1) {
    total += Math.abs(numbers[index] - numbers[index - 1]);
  }
  return total / (numbers.length - 1);
}

/**
 * Convert bytes transferred over a duration into megabits per second.
 */
export function toMbps(bytes, milliseconds) {
  if (!Number.isFinite(bytes) || !Number.isFinite(milliseconds) || milliseconds <= 0) {
    return null;
  }
  return (bytes * 8) / (milliseconds / 1000) / 1_000_000;
}

export function formatMbps(mbps) {
  if (!Number.isFinite(mbps)) return 'n/a';
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
  return `${mbps.toFixed(1)} Mbps`;
}

export function formatMs(milliseconds) {
  if (!Number.isFinite(milliseconds)) return 'n/a';
  return `${milliseconds.toFixed(1)} ms`;
}

export function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function summarizeLatency(samples) {
  const valid = samples.filter(Number.isFinite);
  if (valid.length === 0) return null;

  return {
    ms: round(median(valid), 1),
    jitterMs: round(jitter(valid), 1),
    minMs: round(Math.min(...valid), 1),
    maxMs: round(Math.max(...valid), 1),
    samples: valid.length,
  };
}
