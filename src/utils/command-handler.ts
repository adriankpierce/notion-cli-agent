/**
 * Command error handler — wraps async command actions with standard error handling.
 *
 * Replaces the 37 identical try/catch blocks across command files:
 *   try { ... } catch (error) { console.error('Error:', (error as Error).message); process.exit(1); }
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withErrorHandler(fn: (...args: any[]) => Promise<void>): (...args: any[]) => Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  };
}
