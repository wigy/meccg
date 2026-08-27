/**
 * @module as-104.test
 *
 * Card test: Tribute Garnered (as-104)
 * Type: minion-resource-event (permanent, non-unique). Marshalling Points: 1 (misc).
 *
 * Text:
 *   "Playable on a faction in play. That faction gives an additional
 *    miscellaneous marshalling point. Cannot be duplicated on a given faction.
 *    Discard when any play deck is exhausted."
 *
 * Effects:
 * | # | Effect Type              | Status | Notes                                            |
 * |---|---------------------------|--------|---------------------------------------------------|
 * | 1 | play-target (faction)     | OK     | own in-play faction, no filter (any faction)       |
 * | 2 | attached-faction-mp-bonus | OK     | +1 misc MP while the target faction is in play     |
 * | 3 | duplication-limit (faction)| OK    | "Cannot be duplicated on a given faction"          |
 * | 4 | on-event play-deck-exhausted | OK  | self-discard when any play deck is exhausted       |
 *
 * Rule coverage:
 * | # | Rule                                                                | Status      |
 * |---|----------------------------------------------------------------------|-------------|
 * | 1 | Playable on any own faction in play (no race/uniqueness restriction) | IMPLEMENTED |
 * | 2 | Not playable with no own faction in play                             | IMPLEMENTED |
 * | 3 | Target faction gives +1 misc MP while the card stays attached        | IMPLEMENTED |
 * | 4 | Bonus stops once the target faction leaves play                      | IMPLEMENTED |
 * | 5 | Cannot be duplicated on a given faction (a different faction is OK)  | IMPLEMENTED |
 * | 6 | Discards when any play deck is exhausted                             | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus, Alignment,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  viableActions, dispatch, resolveChain, findHandCardId, expectInDiscardPile,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState, EndOfTurnPhaseState,
  PlayPermanentEventAction,
} from '../../index.js';

const TRIBUTE_GARNERED = 'as-104' as CardDefinitionId;

// Minion factions (both "man", 2 faction MP each, printed marshallingCategory "faction")
const EASTERLINGS = 'le-264' as CardDefinitionId;
const BALCHOTH = 'le-260' as CardDefinitionId;

// Minion sites / characters (Long Grievous Siege ba-40 fixtures)
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const CIRYAHER = 'le-6' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;

/** A CardInPlay entry with an explicit instance id (for stable prev/next diffs). */
const cip = (definitionId: CardDefinitionId, instanceId: string, extra: Partial<CardInPlay> = {}): CardInPlay =>
  ({ instanceId: instanceId as CardInstanceId, definitionId, status: CardStatus.Untapped, ...extra });

/** Organization-phase minion state, P1's own cardsInPlay configurable. */
function buildOrgState(p1CardsInPlay: CardInPlay[] = [], p1Hand: CardDefinitionId[] = [TRIBUTE_GARNERED]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [CIRYAHER] }],
        hand: p1Hand, siteDeck: [DOL_GULDUR],
        cardsInPlay: p1CardsInPlay,
      },
      {
        id: PLAYER_2, alignment: Alignment.Ringwraith,
        companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
        hand: [], siteDeck: [MINAS_MORGUL],
      },
    ],
  });
}

describe('Tribute Garnered (as-104)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1+2: play-target faction ──────────────────────────────────────────

  test('playable on an own faction in play, no race/uniqueness restriction', () => {
    const state = buildOrgState([cip(EASTERLINGS, 'p1-901')]);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(a => a.action as PlayPermanentEventAction);
    expect(actions).toHaveLength(1);
    expect(actions[0].targetFactionInstanceId).toBe('p1-901');
  });

  test('offers one action per own in-play faction', () => {
    const state = buildOrgState([cip(EASTERLINGS, 'p1-901'), cip(BALCHOTH, 'p1-902')]);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(a => a.action as PlayPermanentEventAction);
    expect(actions.map(a => a.targetFactionInstanceId).sort()).toEqual(['p1-901', 'p1-902']);
  });

  test('NOT playable with no own faction in play', () => {
    const state = buildOrgState([]);
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ─── Rule 3+4: attached faction MP bonus ────────────────────────────────────

  test('target faction gives +1 misc MP while Tribute Garnered stays attached', () => {
    // Easterlings printed MP: 2 faction. Tribute Garnered itself: 1 misc.
    // Attached bonus: +1 misc. Total misc = 1 (own) + 1 (bonus) = 2; faction MP unaffected.
    const state = buildOrgState([
      cip(EASTERLINGS, 'p1-901'),
      cip(TRIBUTE_GARNERED, 'p1-902', { attachedTo: 'p1-901' as CardInstanceId }),
    ], []);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(2);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(2);
  });

  test('without Tribute Garnered in play, the faction gives only its printed MP', () => {
    const state = buildOrgState([cip(EASTERLINGS, 'p1-901')], []);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(2);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });

  test('bonus stops once the target faction leaves play', () => {
    // Tribute Garnered stays in cardsInPlay (no auto-discard is printed for this
    // case) but its target instance id no longer resolves to an in-play faction —
    // the bonus, and Tribute Garnered's own printed MP contribution, are unaffected
    // by the target's departure (only the +1 bonus is conditioned on the target).
    const state = buildOrgState([
      cip(TRIBUTE_GARNERED, 'p1-902', { attachedTo: 'p1-901' as CardInstanceId }),
    ], []);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(0);
    // Only Tribute Garnered's own printed 1 misc MP — the +1 bonus does not apply.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1);
  });

  // ─── Rule 5: cannot be duplicated on a given faction ───────────────────────

  test('a second copy cannot target a faction that already carries a copy', () => {
    const state = buildOrgState([
      cip(EASTERLINGS, 'p1-901'),
      cip(TRIBUTE_GARNERED, 'p1-902', { attachedTo: 'p1-901' as CardInstanceId }),
      cip(BALCHOTH, 'p1-903'),
    ]);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(a => a.action as PlayPermanentEventAction);
    // Only Balchoth remains a legal target; Easterlings is already occupied.
    expect(actions.map(a => a.targetFactionInstanceId)).toEqual(['p1-903']);
  });

  // ─── Rule 6: discard when any play deck is exhausted ───────────────────────

  test('discards when active player deck exhaust completes', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [CIRYAHER] }],
          hand: [], siteDeck: [DOL_GULDUR],
          playDeck: [],
          discardPile: [EASTERLINGS],
          cardsInPlay: [
            cip(EASTERLINGS, 'p1-901'),
            cip(TRIBUTE_GARNERED, 'p1-902', { attachedTo: 'p1-901' as CardInstanceId }),
          ],
        },
        {
          id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
          hand: [], siteDeck: [MINAS_MORGUL],
        },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };

    const afterExhaust = dispatch(resetHandState, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === TRIBUTE_GARNERED,
    )).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === TRIBUTE_GARNERED,
    )).toBe(false);
    // CRF 22 "Exhausted": discarded before the reshuffle, so it lands in the new
    // play deck rather than staying in discardPile.
    expect(afterPass.players[RESOURCE_PLAYER].playDeck.some(
      c => c.definitionId === TRIBUTE_GARNERED,
    )).toBe(true);
  });

  test('discards when the opponent\'s deck exhaust completes', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [CIRYAHER] }],
          hand: [], siteDeck: [DOL_GULDUR],
          cardsInPlay: [
            cip(EASTERLINGS, 'p1-901'),
            cip(TRIBUTE_GARNERED, 'p1-902', { attachedTo: 'p1-901' as CardInstanceId }),
          ],
        },
        {
          id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
          hand: [], siteDeck: [MINAS_MORGUL],
          playDeck: [],
          discardPile: [BALCHOTH],
        },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [true, false] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };

    const afterExhaust = dispatch(resetHandState, { type: 'deck-exhaust', player: PLAYER_2 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });

    expectInDiscardPile(afterPass, RESOURCE_PLAYER, TRIBUTE_GARNERED);
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === TRIBUTE_GARNERED,
    )).toBe(false);
  });

  // Sanity: from-hand play resolves the attachment binding.
  test('resolution binds the card to the chosen faction via attachedTo', () => {
    const state = buildOrgState([cip(EASTERLINGS, 'p1-901')]);
    const handId = findHandCardId(state, RESOURCE_PLAYER, TRIBUTE_GARNERED);
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(a => a.action as PlayPermanentEventAction)
      .find(a => a.cardInstanceId === handId)!;
    expect(action).toBeDefined();

    const after = resolveChain(dispatch(state, action));
    const host = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === handId);
    expect(host).toBeDefined();
    expect(host!.attachedTo).toBe('p1-901');
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(2);
  });
});
