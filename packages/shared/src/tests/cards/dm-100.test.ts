/**
 * @module dm-100.test
 *
 * Card test: Which Might Be Lies (dm-100)
 * Type: hazard-event (short)
 *
 * Text: "Playable on a stored resource permanent-event that required an
 * information site to be played. Discard event."
 *
 * Card shape (effects):
 *   - play-target: target "stored-permanent-event", requiresResource
 *     "information" — the hazard player targets one of the opponent's stored
 *     resource permanent-events (a permanent-event sitting in the opponent's
 *     marshalling-point pile) that carries a `play-target: site` filter or
 *     `play-condition: site-has-resource` requiring an Information site.
 *   - discard-stored-permanent-event: on resolution the targeted stored card
 *     is removed from the opponent's marshalling-point pile and routed to
 *     that owner's discard pile. Unlike Neither so Ancient Nor so Potent
 *     (dm-73), nothing returns to hand and dm-100 itself is not placed in any
 *     pile — hazard short-events are already discarded at play time.
 *
 * Engine support:
 *   - Legal actions: `play-target: stored-permanent-event` emits one
 *     `play-hazard` per matching opponent stored permanent-event during the
 *     M/H play-hazards step (`legal-actions/movement-hazard.ts`), carrying
 *     `targetStoredPermanentEventInstanceId`. Candidates are filtered via the
 *     shared `permanentEventSiteResourceSubtypes` helper (reducer-utils.ts),
 *     which also backs the `permanent-event-mp` MP override (Man of Skill
 *     wh-119).
 *   - Resolution: `resolveDiscardStoredPermanentEvent` in `chain-reducer.ts`
 *     moves the stored card killPile → owner discardPile.
 *
 * Fixture: Andúril, the Flame of the West (tw-192) is used as the stored
 * permanent-event — it is storable at a Haven and its own `play-target: site`
 * filter requires a site where Information is playable. Book of Mazarbul
 * (tw-201), a stored *item* (no `eventType: permanent`), is used to prove a
 * stored item never qualifies as a target regardless of the pile it sits in.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN,
  buildTestState, resetMint, makeMHState,
  addToPile, mint, viableActions, dispatch, resolveChain, recomputeDerived,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { GameState, CardDefinitionId, CardInstance, MovementHazardPhaseState, PlayHazardAction } from '../../index.js';

const WHICH_MIGHT_BE_LIES = 'dm-100' as CardDefinitionId;
const ANDURIL = 'tw-192' as CardDefinitionId; // hero permanent-event, requires an Information site, storable at a Haven
const BOOK_OF_MAZARBUL = 'tw-201' as CardDefinitionId; // hero item, no eventType — never a matching target

describe('Which Might Be Lies (dm-100)', () => {
  beforeEach(() => resetMint());

  /**
   * PLAYER_1 (active/resource) has Andúril stored in their marshalling-point
   * pile (and optionally Book of Mazarbul too); PLAYER_2 (hazard) holds
   * dm-100. The M/H play-hazards step is processing PLAYER_1's company.
   */
  function baseState(opts: { storedAnduril?: boolean; storedBook?: boolean } = {}): {
    state: GameState; anduril?: CardInstance; book?: CardInstance;
  } {
    const { storedAnduril = true, storedBook = false } = opts;
    let state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WHICH_MIGHT_BE_LIES], siteDeck: [LORIEN] },
      ],
    });
    // Mint stored cards AFTER buildTestState (which resets the mint counter)
    // so instance IDs don't collide with a character/site instance.
    const anduril: CardInstance | undefined = storedAnduril ? { instanceId: mint(), definitionId: ANDURIL } : undefined;
    const book: CardInstance | undefined = storedBook ? { instanceId: mint(), definitionId: BOOK_OF_MAZARBUL } : undefined;
    if (anduril) state = addToPile(state, RESOURCE_PLAYER, 'killPile', anduril);
    if (book) state = addToPile(state, RESOURCE_PLAYER, 'killPile', book);
    state = recomputeDerived({ ...state, phaseState: makeMHState() });
    return { state, anduril, book };
  }

  test('offered as a viable play-hazard targeting the opponent stored permanent-event requiring Information', () => {
    const { state, anduril } = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    const onAnduril = plays.find(a => (a.action as PlayHazardAction).targetStoredPermanentEventInstanceId === anduril!.instanceId);
    expect(onAnduril).toBeDefined();
  });

  test('NOT playable when the opponent has no stored resource permanent-event', () => {
    const { state } = baseState({ storedAnduril: false });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    const onStored = plays.filter(a => (a.action as PlayHazardAction).targetStoredPermanentEventInstanceId !== undefined);
    expect(onStored).toHaveLength(0);
  });

  test('a stored item (no eventType permanent) never qualifies as a target', () => {
    const { state, book } = baseState({ storedAnduril: false, storedBook: true });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    const onBook = plays.find(a => (a.action as PlayHazardAction).targetStoredPermanentEventInstanceId === book!.instanceId);
    expect(onBook).toBeUndefined();
  });

  test('resolving discards the stored permanent-event from the opponent marshalling-point pile', () => {
    const { state, anduril } = baseState();
    const play = viableActions(state, PLAYER_2, 'play-hazard')
      .find(a => (a.action as PlayHazardAction).targetStoredPermanentEventInstanceId === anduril!.instanceId)!;
    const after = resolveChain(dispatch(state, play.action));

    expect(after.chain).toBeNull();
    // No longer in the opponent's marshalling-point pile...
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === anduril!.instanceId)).toBe(false);
    // ...and not returned to hand (unlike dm-73) — it lands in the discard pile.
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === anduril!.instanceId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === anduril!.instanceId)).toBe(true);
  });

  test('the hazard card itself is discarded, never entering play or the marshalling-point pile', () => {
    const { state, anduril } = baseState();
    const play = viableActions(state, PLAYER_2, 'play-hazard')
      .find(a => (a.action as PlayHazardAction).targetStoredPermanentEventInstanceId === anduril!.instanceId)!;
    const after = resolveChain(dispatch(state, play.action));

    expect(after.players[HAZARD_PLAYER].hand.some(c => c.definitionId === WHICH_MIGHT_BE_LIES)).toBe(false);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === WHICH_MIGHT_BE_LIES)).toBe(false);
    expect(after.players[HAZARD_PLAYER].killPile.some(c => c.definitionId === WHICH_MIGHT_BE_LIES)).toBe(false);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === WHICH_MIGHT_BE_LIES)).toBe(true);
  });

  test('playing the card counts one against the hazard limit', () => {
    const { state, anduril } = baseState();
    const before = (state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
    const play = viableActions(state, PLAYER_2, 'play-hazard')
      .find(a => (a.action as PlayHazardAction).targetStoredPermanentEventInstanceId === anduril!.instanceId)!;
    const after = dispatch(state, play.action);

    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(before + 1);
  });
});
