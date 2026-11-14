import { safeInvoke } from '../../../src/core/safeInvoke';

describe('safeInvoke', () => {
  it('invokes the callback with the given arguments', () => {
    const fn = jest.fn();
    safeInvoke(fn, 'a', 1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a', 1);
  });

  it('swallows a synchronous throw', () => {
    const fn = jest.fn(() => {
      throw new Error('boom');
    });
    expect(() => safeInvoke(fn)).not.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns undefined even when the callback returns a value', () => {
    expect(safeInvoke(() => 42)).toBeUndefined();
  });
});
