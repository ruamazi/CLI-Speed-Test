/**
 * Small shared helpers used across the CLI.
 */

/**
 * Create an error that follows the standard AbortError shape.
 */
export function abortError(message = 'The operation was aborted') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error) {
  return (
    error?.name === 'AbortError' ||
    error?.code === 'ABORT_ERR' ||
    error?.code === 'ERR_CANCELED'
  );
}

/**
 * Combine multiple AbortSignals into one. Uses AbortSignal.any when
 * available and falls back to a manual listener for older Node versions.
 */
export function anySignal(signals) {
  const valid = signals.filter(Boolean);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(valid);
  }

  const controller = new AbortController();
  const onAbort = (event) => {
    cleanup();
    controller.abort(event.target.reason);
  };
  const cleanup = () => {
    for (const signal of valid) signal.removeEventListener('abort', onAbort);
  };

  for (const signal of valid) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  return controller.signal;
}

/**
 * Remove terminal escape sequences and control characters from text that
 * originated outside the CLI. This keeps server-provided metadata and error
 * messages from injecting control codes into the terminal.
 */
export function sanitizeText(value) {
  if (value === null || value === undefined) return value;

  return String(value)
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Turn an unknown error into a short message suitable for the terminal.
 */
export function describeError(error) {
  if (!error) return 'unknown error';
  if (isAbortError(error)) return 'cancelled';

  if (error.statusCode === 429) {
    return 'rate limited by the server (try again in a few minutes)';
  }
  if (error.statusCode === 403) {
    return 'request blocked by the server (HTTP 403)';
  }

  switch (error.code) {
    case 'ENOTFOUND':
      return 'DNS lookup failed';
    case 'ECONNREFUSED':
      return 'connection refused';
    case 'ECONNRESET':
      return 'connection reset';
    case 'EAI_AGAIN':
      return 'network unavailable';
    case 'ETIMEDOUT':
      return 'request timed out';
    case 'ENETUNREACH':
      return 'network unreachable';
    default:
      break;
  }

  const message =
    sanitizeText(error.message || String(error)) || 'unknown error';
  return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

/**
 * Wait for a number of milliseconds, but reject early if a signal aborts.
 */
export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
