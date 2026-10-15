/**
 * RouteRegistry — rebuilds the route table from a `NavigationTreeState`.
 *
 * Data model (per the locked contract):
 *  - A "navigator node" (navNodeId) is the sibling set sharing one parent:
 *    top-level routes live under `'<root>'`; routes rendered by a nested
 *    navigator live under the parent route's key. Because navNodeIds are
 *    derived from parent route KEYS (never names), same-named navigators in
 *    different subtrees never collide.
 *  - `focusedOnPath`: the route is selected by `index` at every level from
 *    the root down to it. A level without `index` selects its last route
 *    (stack semantics; full React Navigation states always carry `index`).
 *  - Tombstones: React Navigation dispatches the pop state BEFORE the
 *    transition events, so a closing route may be gone when its
 *    `transitionStarted` arrives. The registry keeps the last-known
 *    route → navNodeId mapping for disappeared keys while their navNode
 *    still has members in the latest state or has an open barrier. The
 *    coordinator purges a navNode's tombstones once it has zero members in
 *    the latest state (an empty navNode is dead — its barriers auto-close,
 *    so an open barrier alone does not keep tombstones alive).
 *  - focusEpoch: per route, +1 on every `focusedOnPath` false→true edge.
 *    Computed only on rebuilds, so barrier churn while focused never bumps
 *    it. The epoch survives tombstoning and is purged with the navNode.
 */

import type { NavigationTreeState } from './types';

/** navNodeId of the top-level sibling set (routes with no parent route). */
export const ROOT_NAV_NODE_ID = '<root>';

export interface IndexedRoute {
  readonly key: string;
  readonly name: string;
  /** navNodeId = parent route key, or `'<root>'` for top-level routes. */
  readonly navNodeId: string;
  /** Selected by `index` at every level from the root down to this route. */
  readonly focusedOnPath: boolean;
  /**
   * Every navNodeId on the path to this route, ordered root → own navNode
   * (last element is the route's own `navNodeId`). An open barrier on any
   * of them makes the route's `hasPendingTransition` true.
   */
  readonly navNodeIdsOnPath: readonly string[];
}

export interface RebuildResult {
  /**
   * navNodeIds that were previously relevant (members, tombstones or an
   * open barrier) but have zero members in the new state. The coordinator
   * auto-closes their barriers and purges their tombstones.
   */
  readonly deadNavNodeIds: readonly string[];
  /** Route keys whose `focusedOnPath` went false → true in this rebuild. */
  readonly focusGainedKeys: readonly string[];
  /**
   * navNodeIds whose `index`-selected member changed since the previous
   * rebuild (push/pop/switch — the state-level signal that a transition is
   * probably about to animate). Brand-new navNodes are excluded: their
   * mount is covered by the ancestor change that introduced them.
   */
  readonly focusChangedNavNodeIds: readonly string[];
}

/**
 * Tombstones exist solely to resolve late `transitionStarted` events for a
 * just-popped route — events that old never arrive in practice, so a small
 * FIFO bound is plenty. Without it, every pop on a still-alive navigator
 * (the root stack effectively lives forever) accumulates a dead key.
 */
const MAX_TOMBSTONES = 64;

/** The route a level's `index` selects — last route when `index` is absent. */
function focusedKeyOf(level: NavigationTreeState): string | undefined {
  if (level.routes.length === 0) return undefined;
  const index = level.index ?? level.routes.length - 1;
  if (index < 0 || index >= level.routes.length) return undefined;
  return level.routes[index]?.key;
}

export class RouteRegistry {
  /** routeKey → record for every route in the LATEST delivered state. */
  private routes = new Map<string, IndexedRoute>();
  /** navNodeId → member route keys in the latest state. */
  private navNodeMembers = new Map<string, ReadonlySet<string>>();
  /** routeKey → navNodeId for disappeared-but-retained routes. */
  private tombstones = new Map<string, string>();
  /** Every navNodeId ever observed in a delivered state. */
  private readonly knownNavNodeIds = new Set<string>();
  /** routeKey → focusEpoch. Survives tombstoning; purged with the navNode. */
  private readonly focusEpochs = new Map<string, number>();
  /** routeKey → previous focusedOnPath (false when absent). */
  private readonly prevFocusedOnPath = new Map<string, boolean>();
  /**
   * routeKeys currently in the latest state or tombstoned. Pruned on every
   * rebuild so long-dead route keys do not accumulate.
   */
  private readonly seenRouteKeys = new Set<string>();
  /** navNodeId → the route key `index` selected at the previous rebuild. */
  private prevSelectedMember = new Map<string, string | undefined>();

  /**
   * Rebuild the route table from `state`.
   * `openBarrierNavNodeIds` — navNodeIds that currently hold an open barrier
   * (keeps tombstones resolvable while a transition is in flight).
   */
  rebuild(state: NavigationTreeState, openBarrierNavNodeIds: ReadonlySet<string>): RebuildResult {
    const routes = new Map<string, IndexedRoute>();
    const members = new Map<string, Set<string>>();
    /** navNodeId → the member `index` selects this rebuild. */
    const selectedMembers = new Map<string, string | undefined>();

    const visit = (
      level: NavigationTreeState,
      navNodeId: string,
      parentFocused: boolean,
      ancestorNavNodeIds: readonly string[]
    ): void => {
      this.knownNavNodeIds.add(navNodeId);
      const focusedKey = focusedKeyOf(level);
      selectedMembers.set(navNodeId, focusedKey);
      const pathToLevel = [...ancestorNavNodeIds, navNodeId];
      for (const route of level.routes) {
        const focusedOnPath = parentFocused && route.key === focusedKey;
        routes.set(route.key, {
          key: route.key,
          name: route.name,
          navNodeId,
          focusedOnPath,
          navNodeIdsOnPath: pathToLevel,
        });
        let bucket = members.get(navNodeId);
        if (bucket === undefined) {
          bucket = new Set<string>();
          members.set(navNodeId, bucket);
        }
        bucket.add(route.key);
        this.seenRouteKeys.add(route.key);
        if (route.state !== undefined) {
          visit(route.state, route.key, focusedOnPath, pathToLevel);
        }
      }
    };
    visit(state, ROOT_NAV_NODE_ID, true, []);

    // Tombstone retention: a disappeared route keeps its last-known
    // navNodeId while that navNode still has members in the latest state or
    // holds an open barrier. Keys whose navNode vanished entirely are
    // dropped together with their focus bookkeeping.
    const tombstones = new Map<string, string>();
    const retainOrDrop = (routeKey: string, navNodeId: string): void => {
      if (routes.has(routeKey)) return;
      const memberCount = members.get(navNodeId)?.size ?? 0;
      if (memberCount > 0 || openBarrierNavNodeIds.has(navNodeId)) {
        tombstones.set(routeKey, navNodeId);
      } else {
        this.focusEpochs.delete(routeKey);
        this.prevFocusedOnPath.delete(routeKey);
      }
    };
    // Older tombstones first, freshly-popped routes last — Map insertion
    // order then runs oldest → newest for the FIFO bound below.
    for (const [routeKey, navNodeId] of this.tombstones) {
      retainOrDrop(routeKey, navNodeId);
    }
    for (const [routeKey, record] of this.routes) {
      retainOrDrop(routeKey, record.navNodeId);
    }

    // Bound tombstones: only recent pops ever receive late events. Map
    // insertion order is preserved across rebuilds, so the iterator head
    // is the oldest retained tombstone.
    while (tombstones.size > MAX_TOMBSTONES) {
      const oldest = tombstones.keys().next().value;
      if (oldest === undefined) break;
      tombstones.delete(oldest);
      this.focusEpochs.delete(oldest);
      this.prevFocusedOnPath.delete(oldest);
      this.seenRouteKeys.delete(oldest);
    }

    // Keep `seenRouteKeys` proportional to live + retained state — it backs
    // only the untracked-route warning, not correctness.
    for (const key of [...this.seenRouteKeys]) {
      if (!routes.has(key) && !tombstones.has(key)) this.seenRouteKeys.delete(key);
    }

    // NavNodes with zero members in the latest state are dead — the
    // coordinator auto-closes their barriers and purges their tombstones.
    const deadNavNodeIds: string[] = [];
    const candidateNavNodes = new Set<string>([...this.knownNavNodeIds, ...openBarrierNavNodeIds]);
    for (const navNodeId of candidateNavNodes) {
      if ((members.get(navNodeId)?.size ?? 0) === 0) {
        deadNavNodeIds.push(navNodeId);
      }
    }

    // navNodes whose selected member changed = probable animation sources.
    // Only navNodes that existed before qualify (prevSelectedMember has an
    // entry); a navNode appearing for the first time is covered by the
    // ancestor change that mounted it.
    const focusChangedNavNodeIds: string[] = [];
    for (const [navNodeId, selected] of selectedMembers) {
      if (
        this.prevSelectedMember.has(navNodeId) &&
        this.prevSelectedMember.get(navNodeId) !== selected
      ) {
        focusChangedNavNodeIds.push(navNodeId);
      }
    }
    this.prevSelectedMember = selectedMembers;

    // focusEpoch edges: +1 when focusedOnPath goes false → true. Routes not
    // present in this state count as unfocused (a reappearing key that is
    // focused again produces a fresh edge).
    const focusGainedKeys: string[] = [];
    for (const [routeKey, record] of routes) {
      const wasFocused = this.prevFocusedOnPath.get(routeKey) ?? false;
      if (record.focusedOnPath && !wasFocused) {
        this.focusEpochs.set(routeKey, (this.focusEpochs.get(routeKey) ?? 0) + 1);
        focusGainedKeys.push(routeKey);
      }
      this.prevFocusedOnPath.set(routeKey, record.focusedOnPath);
    }
    for (const routeKey of [...this.prevFocusedOnPath.keys()]) {
      if (!routes.has(routeKey)) this.prevFocusedOnPath.set(routeKey, false);
    }

    const readonlyMembers = new Map<string, ReadonlySet<string>>();
    for (const [navNodeId, bucket] of members) readonlyMembers.set(navNodeId, bucket);

    this.routes = routes;
    this.navNodeMembers = readonlyMembers;
    this.tombstones = tombstones;

    return { deadNavNodeIds, focusGainedKeys, focusChangedNavNodeIds };
  }

  /** Route record for a key in the latest state, or undefined. */
  getRoute(routeKey: string): IndexedRoute | undefined {
    return this.routes.get(routeKey);
  }

  /**
   * navNodeId responsible for a route key: current routes first, then
   * tombstones (a closing route still resolves while its navigator lives).
   */
  resolveNavNodeId(routeKey: string): string | undefined {
    return this.routes.get(routeKey)?.navNodeId ?? this.tombstones.get(routeKey);
  }

  /** True when the navNode has at least one member in the latest state. */
  isNavNodeAlive(navNodeId: string): boolean {
    return (this.navNodeMembers.get(navNodeId)?.size ?? 0) > 0;
  }

  /**
   * Drop all tombstones and focus bookkeeping belonging to `navNodeId`
   * (called once the navNode has zero members in the latest state).
   * Returns the dropped route keys.
   */
  purgeNavNode(navNodeId: string): readonly string[] {
    const dropped: string[] = [];
    for (const [routeKey, nodeId] of [...this.tombstones]) {
      if (nodeId === navNodeId) {
        this.tombstones.delete(routeKey);
        this.focusEpochs.delete(routeKey);
        this.prevFocusedOnPath.delete(routeKey);
        dropped.push(routeKey);
      }
    }
    this.navNodeMembers.delete(navNodeId);
    this.knownNavNodeIds.delete(navNodeId);
    return dropped;
  }

  /** Whether the key appeared in at least one delivered state ever. */
  hasSeenRoute(routeKey: string): boolean {
    return this.seenRouteKeys.has(routeKey);
  }

  /** focusEpoch for a route (0 for never-seen or purged keys). */
  focusEpochOf(routeKey: string): number {
    return this.focusEpochs.get(routeKey) ?? 0;
  }

  /** Whether the key currently resolves via a tombstone (disappeared route). */
  isTombstoned(routeKey: string): boolean {
    return !this.routes.has(routeKey) && this.tombstones.has(routeKey);
  }

  /** Current count of retained tombstones (diagnostics/tests). */
  get tombstoneCount(): number {
    return this.tombstones.size;
  }
}
