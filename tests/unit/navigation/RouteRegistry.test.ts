/**
 * RouteRegistry unit tests — the pure data-structure half of the
 * coordinator: route tables, focusedOnPath, tombstones, focusEpochs.
 */

import { ROOT_NAV_NODE_ID, RouteRegistry } from '../../../src/navigation/RouteRegistry';
import { appTree, nav, route } from './helpers';

const NO_BARRIERS: ReadonlySet<string> = new Set();

describe('route table', () => {
  it('derives navNodeIds from parent route keys', () => {
    const registry = new RouteRegistry();
    registry.rebuild(appTree(), NO_BARRIERS);

    expect(registry.getRoute('tabs')?.navNodeId).toBe(ROOT_NAV_NODE_ID);
    expect(registry.getRoute('settings')?.navNodeId).toBe(ROOT_NAV_NODE_ID);
    expect(registry.getRoute('tab-home')?.navNodeId).toBe('tabs');
    expect(registry.getRoute('tab-orders')?.navNodeId).toBe('tabs');
    expect(registry.getRoute('home-feed')?.navNodeId).toBe('tab-home');
    expect(registry.getRoute('orders-list')?.navNodeId).toBe('tab-orders');
  });

  it('records every navNodeId on the path (own navNode last)', () => {
    const registry = new RouteRegistry();
    registry.rebuild(appTree(), NO_BARRIERS);
    expect(registry.getRoute('home-feed')?.navNodeIdsOnPath).toEqual([
      ROOT_NAV_NODE_ID,
      'tabs',
      'tab-home',
    ]);
    expect(registry.getRoute('tabs')?.navNodeIdsOnPath).toEqual([ROOT_NAV_NODE_ID]);
  });

  it('selects the last route when a level omits index (stack semantics)', () => {
    const registry = new RouteRegistry();
    registry.rebuild(nav([route('a'), route('b')]) /* no index */, NO_BARRIERS);
    expect(registry.getRoute('a')?.focusedOnPath).toBe(false);
    expect(registry.getRoute('b')?.focusedOnPath).toBe(true);
  });

  it('focuses only along the index chain at every level', () => {
    const registry = new RouteRegistry();
    registry.rebuild(appTree({ tabIndex: 1, ordersIndex: 1 }), NO_BARRIERS);
    expect(registry.getRoute('orders-detail')?.focusedOnPath).toBe(true);
    // inside the focused tab but not selected by its stack index
    expect(registry.getRoute('orders-list')?.focusedOnPath).toBe(false);
    // correct tab selected, but its child-stack leaf is unfocused
    expect(registry.getRoute('tab-orders')?.focusedOnPath).toBe(true);
    // sibling branch entirely unfocused
    expect(registry.getRoute('home-feed')?.focusedOnPath).toBe(false);
    expect(registry.getRoute('tab-home')?.focusedOnPath).toBe(false);
  });
});

describe('tombstones', () => {
  it('keeps the last-known navNodeId for a removed route while its navNode lives', () => {
    const registry = new RouteRegistry();
    registry.rebuild(nav([route('a'), route('b')], 1), NO_BARRIERS);
    registry.rebuild(nav([route('a')], 0), NO_BARRIERS); // b popped

    expect(registry.getRoute('b')).toBeUndefined();
    expect(registry.isTombstoned('b')).toBe(true);
    expect(registry.resolveNavNodeId('b')).toBe(ROOT_NAV_NODE_ID);
    expect(registry.resolveNavNodeId('a')).toBe(ROOT_NAV_NODE_ID);
    expect(registry.tombstoneCount).toBe(1);
  });

  it('drops tombstones when the navNode has zero members and no open barrier', () => {
    const registry = new RouteRegistry();
    registry.rebuild(
      nav([route('parent', 'P', nav([route('child')], 0)), route('other')], 0),
      NO_BARRIERS
    );
    // 'parent' unmounts → its whole subtree dies with it.
    const result = registry.rebuild(nav([route('other')], 0), NO_BARRIERS);
    expect(result.deadNavNodeIds).toContain('parent');
    // After the coordinator-driven purge, 'child' is unresolvable…
    registry.purgeNavNode('parent');
    expect(registry.resolveNavNodeId('child')).toBeUndefined();
    // …while 'parent' itself stays tombstoned under '<root>' (still alive).
    expect(registry.resolveNavNodeId('parent')).toBe(ROOT_NAV_NODE_ID);
    expect(registry.tombstoneCount).toBe(1);
  });

  it('an open barrier keeps a tombstone resolvable even on an empty navNode', () => {
    const registry = new RouteRegistry();
    registry.rebuild(nav([route('parent', 'P', nav([route('child')], 0))], 0), NO_BARRIERS);
    const result = registry.rebuild(nav([route('solo')], 0), new Set(['parent']));
    // retained through the rebuild because the navNode had an open barrier…
    expect(registry.resolveNavNodeId('child')).toBe('parent');
    // …but the navNode is still reported dead for the coordinator to purge.
    expect(result.deadNavNodeIds).toContain('parent');
  });
});

describe('focusEpoch', () => {
  it('counts false→true edges only, survives tombstoning', () => {
    const registry = new RouteRegistry();
    registry.rebuild(nav([route('a'), route('b')], 0), NO_BARRIERS);
    expect(registry.focusEpochOf('a')).toBe(1); // first sighting already focused
    expect(registry.focusEpochOf('b')).toBe(0);

    // rebuilds with no focus change don't bump
    registry.rebuild(nav([route('a'), route('b')], 0), NO_BARRIERS);
    expect(registry.focusEpochOf('a')).toBe(1);

    // blur then refocus bumps
    registry.rebuild(nav([route('a'), route('b')], 1), NO_BARRIERS);
    registry.rebuild(nav([route('a'), route('b')], 0), NO_BARRIERS);
    expect(registry.focusEpochOf('a')).toBe(2);

    // disappears (tombstoned — '<root>' still has members) then returns
    // focused → the epoch is retained across the tombstone and bumps again.
    registry.rebuild(nav([route('b')], 0), NO_BARRIERS);
    expect(registry.focusEpochOf('a')).toBe(2);
    registry.rebuild(nav([route('a'), route('b')], 0), NO_BARRIERS);
    expect(registry.focusEpochOf('a')).toBe(3);

    expect(registry.focusEpochOf('never-seen')).toBe(0);
  });
});
