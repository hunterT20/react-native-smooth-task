/**
 * Invoke a third-party callback (diagnostics sink, listener, onError, ...)
 * and swallow anything it throws: a misbehaving callback must never break
 * the queue, the coordinator or the app.
 */
export function safeInvoke<A extends unknown[]>(fn: (...args: A) => unknown, ...args: A): void {
  try {
    fn(...args);
  } catch {
    // Intentionally swallowed — see above.
  }
}
