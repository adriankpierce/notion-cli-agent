import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withErrorHandler } from '../../src/utils/command-handler.js';

describe('withErrorHandler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  it('should call the wrapped function with all arguments', async () => {
    const fn = vi.fn();
    const wrapped = withErrorHandler(fn);
    await wrapped('arg1', 'arg2', { opt: true });
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2', { opt: true });
  });

  it('should not catch when the function succeeds', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const wrapped = withErrorHandler(fn);
    await wrapped();
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('should catch errors and call console.error + process.exit(1)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('test failure'));
    const wrapped = withErrorHandler(fn);
    await wrapped();
    expect(console.error).toHaveBeenCalledWith('Error:', 'test failure');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should handle non-Error throws gracefully', async () => {
    const fn = vi.fn().mockRejectedValue('string error');
    const wrapped = withErrorHandler(fn);
    await wrapped();
    expect(console.error).toHaveBeenCalledWith('Error:', undefined);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should preserve async behavior', async () => {
    const order: number[] = [];
    const fn = vi.fn(async () => {
      order.push(1);
      await Promise.resolve();
      order.push(2);
    });
    const wrapped = withErrorHandler(fn);
    await wrapped();
    expect(order).toEqual([1, 2]);
  });
});
