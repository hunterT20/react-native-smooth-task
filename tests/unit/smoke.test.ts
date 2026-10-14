import { routeScopeId, APP_SCOPE_ID, isRouteScope } from '../../src/core/types';

describe('smoke', () => {
  it('runs jest with the react-native preset', () => {
    expect(routeScopeId('abc')).toBe('route:abc');
    expect(isRouteScope(routeScopeId('abc'))).toBe(true);
    expect(isRouteScope(APP_SCOPE_ID)).toBe(false);
  });
});
