import { DIAGNOSTIC_CODES } from '../../../src/diagnostics/codes';

describe('DIAGNOSTIC_CODES', () => {
  it('has no duplicates', () => {
    expect(new Set(DIAGNOSTIC_CODES).size).toBe(DIAGNOSTIC_CODES.length);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(DIAGNOSTIC_CODES)).toBe(true);
  });

  it('does not contain codes that are never emitted', () => {
    const codes: readonly string[] = DIAGNOSTIC_CODES;
    expect(codes).not.toContain('stalled-task');
    expect(codes).not.toContain('missing-provider');
    expect(codes).toContain('stalled-transition');
  });
});
