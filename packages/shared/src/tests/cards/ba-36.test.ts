/**
 * @module ba-36.test
 *
 * Card test: Ancient Secrets (ba-36)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0.
 *
 * Text:
 *   "Tap your Ringwraith to discard one hazard permanent-event. Alternatively,
 *    during your organization phase, tap your Ringwraith to take up to two
 *    resources from your sideboard to your play deck and reshuffle."
 *
 * A dual-mode short-event; both modes tap the player's own revealed Ringwraith
 * (the avatar — a Ringwraith follower does not qualify).
 *
 *   Mode 1 (any phase a resource short-event may be played): choose one hazard
 *   permanent-event in play and discard it. Unlike Marvels Told (td-134) it
 *   discards *any* hazard permanent-event — environments (Doors of Night) count
 *   — and makes no corruption check. Modelled by a `play-target` (tap the
 *   revealed avatar via `target.isRevealedAvatar`) + a `move`
 *   (`select: target`, `from: in-play`, `to: discard`) filtered to hazard
 *   permanent-events. The chosen target rides on the play action's
 *   `discardTargetInstanceId`.
 *
 *   Mode 2 (organization phase only): fetch up to two resources from the
 *   sideboard into the play deck (reshuffle). Modelled by a second `move`
 *   (`select: target`, `from: sideboard`, `to: deck`, `count: 2`) filtered to
 *   minion resources. Offered as a `sideboard-fetch` play action carrying the
 *   avatar to tap and NO discard target; the reducer routes it to the fetch
 *   sub-flow precisely because `discardTargetInstanceId` is absent.
 *
 * Rule coverage:
 * | # | Rule                                                                    | Status      |
 * |---|-------------------------------------------------------------------------|-------------|
 * | 1 | Mode 1 offers one (tap-Ringwraith × hazard) action per hazard perm-event | IMPLEMENTED |
 * | 2 | Only the revealed Ringwraith avatar may be tapped (not another char)     | IMPLEMENTED |
 * | 3 | Environments count as targets; hazard long-events do not                 | IMPLEMENTED |
 * | 4 | Playing mode 1 taps the Ringwraith, discards the hazard + the event      | IMPLEMENTED |
 * | 5 | Mode 1 works during the site phase; mode 2 does not (org-only)            | IMPLEMENTED |
 * | 6 | Mode 2 offers a sideboard-fetch action in the org phase                  | IMPLEMENTED |
 * | 7 | Mode 2 enqueues a count-2 fetch and fetches minion resources sideboard→deck | IMPLEMENTED |
 * | 8 | Mode 2 fetch is "up to two" (may pass after one) and excludes non-resources | IMPLEMENTED |
 * | 9 | With no hazard in play but sideboard resources, card still playable (mode 2)| IMPLEMENTED |
 * | 10| Not playable when Ringwraith is tapped and no other mode is available     | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, mint, dispatch,
  viableActions, actionAs, findCharInstanceId, setCharStatus, expectCharStatus,
  makeSitePhase, expectInDiscardPile,
  DOORS_OF_NIGHT, FOOLISH_WORDS, EYE_OF_SAURON, MINAS_TIRITH,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInPlay,
  PlayShortEventAction, FetchFromPileAction, GameState,
} from '../../index.js';
import { Phase, CardStatus, Alignment } from '../../index.js';

const ANCIENT_SECRETS = 'ba-36' as CardDefinitionId;
const KHAMUL = 'le-55' as CardDefinitionId;          // Ringwraith avatar (mind null)
const LUITPRAND = 'le-23' as CardDefinitionId;        // minion man, non-avatar
const VARIAG_CAMP = 'le-411' as CardDefinitionId;     // minion border-hold
const BLACK_MACE = 'le-299' as CardDefinitionId;      // minion-resource-item
const SNAGA_HAI = 'le-286' as CardDefinitionId;       // minion-resource-faction

/** All viable play-short-event actions for Ancient Secrets. */
function playActions(state: GameState): PlayShortEventAction[] {
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => actionAs<PlayShortEventAction>(ea.action));
}

/** The mode-1 (discard) actions — those carrying a discard target. */
function discardActions(state: GameState): PlayShortEventAction[] {
  return playActions(state).filter(a => a.discardTargetInstanceId !== undefined);
}

/** The mode-2 (sideboard fetch) actions — those with the sideboard-fetch option. */
function sideboardActions(state: GameState): PlayShortEventAction[] {
  return playActions(state).filter(a => a.optionId === 'sideboard-fetch');
}

/** A minion Ringwraith org-phase state at Variag Camp. */
function buildRingwraithOrg(p1: {
  characters?: (CardDefinitionId | { defId: CardDefinitionId; items?: CardDefinitionId[] })[];
  hand?: CardDefinitionId[];
  sideboard?: CardDefinitionId[];
  playDeck?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
}, p2CardsInPlay: CardInPlay[] = []): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: VARIAG_CAMP, characters: p1.characters ?? [KHAMUL] }],
        hand: p1.hand ?? [ANCIENT_SECRETS],
        sideboard: p1.sideboard ?? [],
        playDeck: p1.playDeck,
        discardPile: p1.discardPile,
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: MINAS_TIRITH, characters: [] }],
        hand: [], siteDeck: [MINAS_TIRITH],
        cardsInPlay: p2CardsInPlay,
      },
    ],
  });
}

const inPlay = (defId: CardDefinitionId): CardInPlay =>
  ({ instanceId: mint(), definitionId: defId, status: CardStatus.Untapped });

describe('Ancient Secrets (ba-36)', () => {
  beforeEach(() => resetMint());

  // ─── Mode 1: discard one hazard permanent-event ─────────────────────────────

  test('offers one (tap-Ringwraith × hazard) discard action per hazard permanent-event', () => {
    const foolish = inPlay(FOOLISH_WORDS);
    const doors = inPlay(DOORS_OF_NIGHT);
    const state = buildRingwraithOrg({}, [foolish, doors]);

    const khamulId = findCharInstanceId(state, RESOURCE_PLAYER, KHAMUL);
    const discards = discardActions(state);

    // Two hazard permanent-events → two discard actions, one per target.
    expect(discards).toHaveLength(2);
    expect(new Set(discards.map(a => a.discardTargetInstanceId)))
      .toEqual(new Set([foolish.instanceId, doors.instanceId]));
    // Every discard action taps the Ringwraith avatar.
    expect(discards.every(a => a.targetScoutInstanceId === khamulId)).toBe(true);
  });

  test('only the revealed Ringwraith avatar may be tapped — not another company character', () => {
    // Khamûl (avatar) and Luitprand (a non-avatar minion man) are both untapped.
    const foolish = inPlay(FOOLISH_WORDS);
    const state = buildRingwraithOrg({ characters: [KHAMUL, LUITPRAND] }, [foolish]);

    const khamulId = findCharInstanceId(state, RESOURCE_PLAYER, KHAMUL);
    const luitId = findCharInstanceId(state, RESOURCE_PLAYER, LUITPRAND);

    const discards = discardActions(state);
    expect(discards).toHaveLength(1);
    expect(discards[0].targetScoutInstanceId).toBe(khamulId);
    // Luitprand is never offered as the tap target.
    expect(discards.some(a => a.targetScoutInstanceId === luitId)).toBe(false);
  });

  test('environments count as targets, but hazard long-events do not', () => {
    // Doors of Night (environment permanent) IS a valid target — unlike Marvels
    // Told, which excludes environments. Eye of Sauron (a hazard *long*-event) is
    // NOT: the filter matches eventType "permanent" only.
    const doors = inPlay(DOORS_OF_NIGHT);
    const eye = inPlay(EYE_OF_SAURON);
    const state = buildRingwraithOrg({}, [doors, eye]);

    const targets = new Set(discardActions(state).map(a => a.discardTargetInstanceId));
    expect(targets).toEqual(new Set([doors.instanceId]));
    expect(targets.has(eye.instanceId)).toBe(false);
  });

  test('playing mode 1 taps the Ringwraith, discards the chosen hazard, and discards the event — no corruption check', () => {
    const doors = inPlay(DOORS_OF_NIGHT);
    const state = buildRingwraithOrg({}, [doors]);

    const secretsInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const action = discardActions(state).find(a => a.discardTargetInstanceId === doors.instanceId)!;
    const next = dispatch(state, action);

    // Ringwraith tapped.
    expectCharStatus(next, RESOURCE_PLAYER, KHAMUL, CardStatus.Tapped);

    // Doors of Night moved from P2 cardsInPlay → P2 discard pile.
    expect(next.players[1].cardsInPlay.map(c => c.instanceId)).not.toContain(doors.instanceId);
    expect(next.players[1].discardPile.map(c => c.instanceId)).toContain(doors.instanceId);

    // The event goes straight to the Ringwraith player's discard pile.
    expect(next.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(next, RESOURCE_PLAYER, secretsInst);

    // No sub-flow, no corruption check (ba-36 makes no check).
    expect(next.pendingEffects).toHaveLength(0);
    expect(next.pendingResolutions).toHaveLength(0);
  });

  test('mode 1 works during the site phase; mode 2 (sideboard) does not', () => {
    const foolish = inPlay(FOOLISH_WORDS);
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [KHAMUL] }],
          hand: [ANCIENT_SECRETS], sideboard: [BLACK_MACE, SNAGA_HAI], siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH],
          cardsInPlay: [foolish],
        },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    // Discard mode is available in the site phase (resource short-events may be
    // played during any phase of the active player's turn)...
    expect(discardActions(state)).toHaveLength(1);
    // ...but the sideboard-fetch mode is organization-phase only.
    expect(sideboardActions(state)).toHaveLength(0);
  });

  // ─── Mode 2: fetch up to two resources from the sideboard ────────────────────

  test('offers a sideboard-fetch action in the organization phase (tap Ringwraith, no discard target)', () => {
    const state = buildRingwraithOrg({ sideboard: [BLACK_MACE, SNAGA_HAI] });
    const khamulId = findCharInstanceId(state, RESOURCE_PLAYER, KHAMUL);

    const fetches = sideboardActions(state);
    expect(fetches).toHaveLength(1);
    expect(fetches[0].targetScoutInstanceId).toBe(khamulId);
    expect(fetches[0].discardTargetInstanceId).toBeUndefined();
  });

  test('playing mode 2 taps the Ringwraith, puts the event in play, and opens a count-2 fetch sub-flow', () => {
    const state = buildRingwraithOrg({ sideboard: [BLACK_MACE, SNAGA_HAI] });
    const secretsInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const next = dispatch(state, sideboardActions(state)[0]);

    // Ringwraith tapped, event on the table while the fetch resolves.
    expectCharStatus(next, RESOURCE_PLAYER, KHAMUL, CardStatus.Tapped);
    expect(next.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.instanceId)).toContain(secretsInst);

    // A single count-2 fetch-to-deck pending effect.
    expect(next.pendingEffects).toHaveLength(1);
    const eff = next.pendingEffects[0];
    expect(eff.type === 'card-effect' && eff.effect.type === 'fetch-to-deck' && eff.effect.count).toBe(2);
  });

  test('mode 2 fetches only minion resources — characters, sites, and discard-pile cards are excluded', () => {
    // Sideboard: two resources (eligible) + a character (Luitprand) + a site
    // (Minas Tirith). A resource in the discard pile is NOT reachable (sideboard-only).
    const state = buildRingwraithOrg({
      sideboard: [BLACK_MACE, SNAGA_HAI, LUITPRAND, MINAS_TIRITH],
      discardPile: [BLACK_MACE],
      playDeck: [MINAS_TIRITH],
    });

    const afterPlay = dispatch(state, sideboardActions(state)[0]);
    const fetchOffers = viableActions(afterPlay, PLAYER_1, 'fetch-from-pile');

    // Exactly the two sideboard resources.
    expect(fetchOffers).toHaveLength(2);
    expect(fetchOffers.every(ea => actionAs<FetchFromPileAction>(ea.action).source === 'sideboard')).toBe(true);
    const fetchedDefs = fetchOffers.map(ea =>
      afterPlay.players[RESOURCE_PLAYER].sideboard.find(
        c => c.instanceId === actionAs<FetchFromPileAction>(ea.action).cardInstanceId,
      )?.definitionId);
    expect(fetchedDefs).toEqual(expect.arrayContaining([BLACK_MACE, SNAGA_HAI]));
    expect(fetchedDefs).not.toContain(LUITPRAND);
  });

  test('mode 2 moves two resources into the play deck and discards the event', () => {
    const state = buildRingwraithOrg({ sideboard: [BLACK_MACE, SNAGA_HAI], playDeck: [MINAS_TIRITH] });
    const secretsInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const maceId = state.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    const snagaId = state.players[RESOURCE_PLAYER].sideboard[1].instanceId;
    const originalDeck = state.players[RESOURCE_PLAYER].playDeck.length;

    const afterPlay = dispatch(state, sideboardActions(state)[0]);
    const afterFirst = dispatch(afterPlay, { type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: maceId, source: 'sideboard' });
    const afterSecond = dispatch(afterFirst, { type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: snagaId, source: 'sideboard' });

    // Both resources now in the play deck; sideboard emptied.
    expect(afterSecond.players[RESOURCE_PLAYER].playDeck.length).toBe(originalDeck + 2);
    expect(afterSecond.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId))
      .toEqual(expect.arrayContaining([maceId, snagaId]));
    expect(afterSecond.players[RESOURCE_PLAYER].sideboard).toHaveLength(0);

    // Sub-flow cleared; the event lands in the discard pile (not removed from game).
    expect(afterSecond.pendingEffects).toHaveLength(0);
    expectInDiscardPile(afterSecond, RESOURCE_PLAYER, secretsInst);
    expect(afterSecond.players[RESOURCE_PLAYER].outOfPlayPile.map(c => c.instanceId)).not.toContain(secretsInst);
  });

  test('mode 2 is "up to two" — passing after one fetch keeps the rest in the sideboard and discards the event', () => {
    const state = buildRingwraithOrg({ sideboard: [BLACK_MACE, SNAGA_HAI], playDeck: [MINAS_TIRITH] });
    const secretsInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const maceId = state.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    const originalDeck = state.players[RESOURCE_PLAYER].playDeck.length;

    const afterPlay = dispatch(state, sideboardActions(state)[0]);
    const afterFirst = dispatch(afterPlay, { type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: maceId, source: 'sideboard' });
    // Still count-1 remaining before passing.
    const mid = afterFirst.pendingEffects[0];
    expect(mid.type === 'card-effect' && mid.effect.type === 'fetch-to-deck' && mid.effect.count).toBe(1);
    const afterPass = dispatch(afterFirst, { type: 'pass', player: PLAYER_1 });

    expect(afterPass.players[RESOURCE_PLAYER].playDeck.length).toBe(originalDeck + 1);
    expect(afterPass.players[RESOURCE_PLAYER].sideboard).toHaveLength(1);
    expect(afterPass.pendingEffects).toHaveLength(0);
    expectInDiscardPile(afterPass, RESOURCE_PLAYER, secretsInst);
  });

  // ─── Dual-mode availability ──────────────────────────────────────────────────

  test('with both a hazard in play and sideboard resources, both modes are offered', () => {
    const state = buildRingwraithOrg({ sideboard: [BLACK_MACE] }, [inPlay(FOOLISH_WORDS)]);
    expect(discardActions(state)).toHaveLength(1);
    expect(sideboardActions(state)).toHaveLength(1);
  });

  test('with sideboard resources but no hazard in play, the card is still playable (mode 2 only)', () => {
    const state = buildRingwraithOrg({ sideboard: [BLACK_MACE] }, []);
    expect(discardActions(state)).toHaveLength(0);
    // Not marked unplayable: the sideboard mode carries it.
    expect(sideboardActions(state)).toHaveLength(1);
  });

  test('not playable when the Ringwraith is tapped and no hazard is in play (both modes need the tap)', () => {
    const state = buildRingwraithOrg({ sideboard: [BLACK_MACE] }, []);
    const tapped = setCharStatus(state, RESOURCE_PLAYER, KHAMUL, CardStatus.Tapped);
    // A tapped Ringwraith cannot pay either mode's tap cost.
    expect(playActions(tapped)).toHaveLength(0);
  });
});
