/**
 * @module rule-meas-off-to-the-side
 *
 * MEAS §1 — Placement of cards "off to the side".
 *
 * A card placed off to the side is kept with its host permanent-event:
 * - it leaves normal play but stays registered (no instance disappears);
 * - it counts as in play for uniqueness;
 * - it is untargetable except by cards that specifically affect set-aside cards;
 * - it is discarded to its OWNER when the host leaves play (unless the host says
 *   otherwise);
 * - it awards its marshalling points to its OWNER, not the host's player.
 *
 * Engine mechanics live in `engine/set-aside.ts`; per-card wiring is
 * certification work tracked separately.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardInstanceId, CardInPlay } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { countCopiesInPlay } from '../../engine/reducer-utils.js';
import {
  setAsideCompanyCharacter,
  placeCardSetAside,
  sweepSetAside,
  isSetAsideCard,
} from '../../engine/set-aside.js';
import {
  buildTestState, resetMint, findCharInstanceId, viableActions,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, BILBO, LEGOLAS, RIVENDELL, LORIEN, MINAS_TIRITH,
  GATES_OF_MORNING, DOORS_OF_NIGHT, TWILIGHT, RANGERS_OF_ITHILIEN,
  Phase, CardStatus, pool,
} from '../test-helpers.js';

const HOST_ID = 'p1-1000' as CardInstanceId;

/** Build an Organization-phase state with `host` (a permanent-event) in play for P1. */
function withHost(extra: CardInPlay[] = []) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
        cardsInPlay: [
          { instanceId: HOST_ID, definitionId: GATES_OF_MORNING, status: CardStatus.Untapped },
          ...extra,
        ],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
    ],
  });
  return state;
}

describe('MEAS §1 — Placement of cards off to the side', () => {
  beforeEach(() => resetMint());

  test('set-aside moves a company character out of normal play and onto the host', () => {
    const state = withHost();
    const aragorn = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const after = setAsideCompanyCharacter(state, HOST_ID, aragorn);

    // No longer an active character / company member.
    expect(after.players[0].characters[aragorn as string]).toBeUndefined();
    expect(after.players[0].companies[0].characters).not.toContain(aragorn);

    // Host now lists it; the child carries the back-reference and is in play.
    const host = after.players[0].cardsInPlay.find(c => c.instanceId === HOST_ID)!;
    expect(host.setAside).toContain(aragorn);
    const child = after.players[0].cardsInPlay.find(c => c.instanceId === aragorn)!;
    expect(child).toBeDefined();
    expect(child.setAsideHost).toBe(HOST_ID);
    expect(isSetAsideCard(child)).toBe(true);

    // No instance disappeared.
    expect(resolveInstanceId(after, aragorn)).toBeDefined();
  });

  test('a set-aside card still counts as in play for uniqueness', () => {
    // A unique faction (Rangers of Ithilien) placed off to the side is still in play.
    const factionName = (pool[RANGERS_OF_ITHILIEN as string] as { name: string }).name;
    const child: CardInPlay = {
      instanceId: 'p1-1500' as CardInstanceId,
      definitionId: RANGERS_OF_ITHILIEN,
      status: CardStatus.Untapped,
      setAsideHost: HOST_ID,
    };
    const state = withHost([child]);
    expect(countCopiesInPlay(state, factionName)).toBe(1);
  });

  test('a set-aside card awards its marshalling points to its OWNER, not the host player', () => {
    // Host belongs to P1; the set-aside faction is owned by P2 (instance prefix p2-).
    const child: CardInPlay = {
      instanceId: 'p2-1500' as CardInstanceId,
      definitionId: RANGERS_OF_ITHILIEN, // faction, 3 MP
      status: CardStatus.Untapped,
      setAsideHost: HOST_ID,
    };
    const state = recomputeDerived(withHost([child]));
    expect(state.players[1].marshallingPoints.faction).toBeGreaterThan(0);
    expect(state.players[0].marshallingPoints.faction).toBe(0);
  });

  test('removing the host discards each set-aside child to its owner; no instance disappears', () => {
    const child: CardInPlay = {
      instanceId: 'p2-1500' as CardInstanceId,
      definitionId: RANGERS_OF_ITHILIEN,
      status: CardStatus.Untapped,
      setAsideHost: HOST_ID,
    };
    // Host is NOT present (it has left play) — the orphan sweep must fire.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [child] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const after = sweepSetAside(state);

    // Child removed from the host player's cardsInPlay and discarded to its owner (P2).
    expect(after.players[0].cardsInPlay.find(c => c.instanceId === child.instanceId)).toBeUndefined();
    expect(after.players[1].discardPile.some(c => c.instanceId === child.instanceId)).toBe(true);
    // No instance disappeared.
    expect(resolveInstanceId(after, child.instanceId)).toBeDefined();
  });

  test('host override (keepOnHostRemoval) keeps the child in play when the host leaves', () => {
    const child: CardInPlay = {
      instanceId: 'p1-1500' as CardInstanceId,
      definitionId: RANGERS_OF_ITHILIEN,
      status: CardStatus.Untapped,
      setAsideHost: HOST_ID,
      setAsideKeepOnRemoval: true,
    };
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [child] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const after = sweepSetAside(state);
    const kept = after.players[0].cardsInPlay.find(c => c.instanceId === child.instanceId);
    expect(kept).toBeDefined();
    // Detached: no longer off to the side, now an ordinary in-play card.
    expect(kept!.setAsideHost).toBeUndefined();
    expect(after.players[1].discardPile.some(c => c.instanceId === child.instanceId)).toBe(false);
  });

  test('placeCardSetAside registers the child on the host and stamps the back-reference', () => {
    const state = withHost();
    const after = placeCardSetAside(state, HOST_ID, { instanceId: 'p1-1600' as CardInstanceId, definitionId: RANGERS_OF_ITHILIEN });
    const host = after.players[0].cardsInPlay.find(c => c.instanceId === HOST_ID)!;
    expect(host.setAside).toContain('p1-1600' as CardInstanceId);
    const child = after.players[0].cardsInPlay.find(c => c.instanceId === ('p1-1600' as CardInstanceId))!;
    expect(child.setAsideHost).toBe(HOST_ID);
  });

  test('a set-aside environment is NOT offered as a target by an ordinary cancel card', () => {
    // P1 holds Twilight (cancels an environment). P2 has Doors of Night in play,
    // but placed off to the side — an ordinary card may not target it.
    const setAsideEnv: CardInPlay = {
      instanceId: 'p2-1500' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
      setAsideHost: HOST_ID,
    };
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN], cardsInPlay: [setAsideEnv] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('the same environment IS targetable when it is in normal play (control)', () => {
    const normalEnv: CardInPlay = {
      instanceId: 'p2-1500' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN], cardsInPlay: [normalEnv] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event').length).toBeGreaterThanOrEqual(1);
  });
});
