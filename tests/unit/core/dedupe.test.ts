import { isThenable, scopedDedupeKey } from '../../../src/core/dedupe';

describe('scopedDedupeKey', () => {
  it('encodes scope and key as a JSON pair', () => {
    expect(scopedDedupeKey('app', 'k')).toBe('["app","k"]');
  });

  it('does not collide when separators appear in scope or key', () => {
    expect(scopedDedupeKey('a:b', 'c')).not.toBe(scopedDedupeKey('a', 'b:c'));
  });
});

describe('isThenable', () => {
  it('detects promises and promise-likes', () => {
    expect(isThenable(Promise.resolve())).toBe(true);
    expect(isThenable({ then: () => undefined })).toBe(true);
  });

  it('rejects non-thenables', () => {
    expect(isThenable(undefined)).toBe(false);
    expect(isThenable(null)).toBe(false);
    expect(isThenable({})).toBe(false);
    expect(isThenable({ then: 1 })).toBe(false);
  });
});
