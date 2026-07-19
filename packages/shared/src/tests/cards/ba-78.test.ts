/**
 * @module ba-78.test
 *
 * Card test: Terror Heralds Doom (ba-78)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Balrog specific.
 *
 * Text:
 *   "Balrog specific. Playable during the organization phase if Flame of Udûn
 *    is in play. You may bring this card from your sideboard into your play
 *    deck and reshuffle during your organization phase. +2 to all influence
 *    attempts this turn by any of your characters."
 *
 * Three distinct rules:
 *   1. Play gate — `play-window` (organization) + `play-condition`
 *      (`card-in-play`, "Flame of Udûn"). Flame of Udûn (ba-58) is a
 *      permanent-event held in The Balrog's items; the gate is attachment-aware.
 *   2. Main effect — a player-scoped, turn-scoped, non-consumed influence
 *      `check-modifier` (+2) added on play (`on-event self-enters-play` →
 *      `add-constraint check-modifier influence +2 scope turn target player`).
 *      It boosts every faction influence attempt by any of the player's
 *      characters this turn.
 *   3. Sideboard self-relocation — a `move` (`select: self`, `from: sideboard`,
 *      `to: deck`, `shuffleAfter`) surfaced during the organization phase as a
 *      dedicated `card-sideboard-to-deck` action; taps nothing.
 *
 * "Balrog specific" is a deck-construction keyword (`balrog-specific`), no
 * play-time gate — per the ba-45/ba-46 precedent.
 *
 * Rule coverage:
 * | # | Rule                                                                 | Status      |
 * |---|----------------------------------------------------------------------|-------------|
 * | 1 | NOT playable in org phase while Flame of Udûn is not in play          | IMPLEMENTED |
 * | 2 | Playable in org phase once Flame of Udûn is in play (item on Balrog)  | IMPLEMENTED |
 * | 3 | NOT playable during the site phase (play-window: organization)        | IMPLEMENTED |
 * | 4 | Playing it adds a player-scoped +2 influence constraint; card discard | IMPLEMENTED |
 * | 5 | The +2 reduces the influence-attempt need for any of your characters  | IMPLEMENTED |
 * | 6 | Sideboard copy offers card-sideboard-to-deck in the org phase         | IMPLEMENTED |
 * | 7 | Dispatching it moves the card sideboard → play deck                   | IMPLEMENTED |
 * | 8 | No card-sideboard-to-deck offered when no such card is in sideboard   | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   BA_78 (ba-78)         - minion short event (this card)
 *   FLAME_OF_UDUN (ba-58) - minion permanent-event (the gate card)
 *   THE_BALROG (ba-3)     - minion balrog avatar
 *   ORC_CAPTAIN (le-31)   - minion orc (leader), DI 0
 *   LUITPRAND (le-23)     - minion man, DI 0
 *   VARIAG_CAMP (le-411)  - minion border-hold (Khand)
 *   VARIAGS (le-292)      - minion faction, influence# 9, playable at Variag Camp
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, dispatch,
  viableActions, findHandCardId, findCharInstanceId, expectInDiscardPile,
  MINAS_TIRITH, PLAYER_1, PLAYER_2, Phase, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayShortEventAction, InfluenceAttemptAction } from '../../index.js';
import { Alignment } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint } from '../../engine/pending.js';

const BA_78 = 'ba-78' as CardDefinitionId;
const FLAME_OF_UDUN = 'ba-58' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;
const VARIAGS = 'le-292' as CardDefinitionId;

/** The ba-78 play-short-event action, if the card is offered as viable. */
function terrorPlayAction(state: ReturnType<typeof buildTestState>): PlayShortEventAction | undefined {
  const inst = findHandCardId(state, RESOURCE_PLAYER, BA_78);
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .find(a => a.cardInstanceId === inst);
}

describe('Terror Heralds Doom (ba-78)', () => {
  beforeEach(() => resetMint());

  // ─── Play gate (Flame of Udûn) ──────────────────────────────────────────────

  test('NOT playable during the organization phase while Flame of Udûn is not in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [THE_BALROG] }],
          hand: [BA_78], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(terrorPlayAction(state)).toBeUndefined();
  });

  test('playable during the organization phase once Flame of Udûn is in play (item on The Balrog)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [{ defId: THE_BALROG, items: [FLAME_OF_UDUN] }] }],
          hand: [BA_78], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(terrorPlayAction(state)).toBeDefined();
  });

  test('NOT playable during the site phase even with Flame of Udûn in play (play-window: organization)', () => {
    // Build a site-phase company with The Balrog carrying Flame of Udûn so the
    // card-in-play gate is satisfied; the play-window is then the only blocker.
    const base = buildSitePhaseState({
      characters: [{ defId: THE_BALROG, items: [FLAME_OF_UDUN] }],
      site: VARIAG_CAMP,
      hand: [BA_78],
    });
    const state = {
      ...base,
      players: [{ ...base.players[0], alignment: Alignment.Ringwraith }, base.players[1]] as typeof base.players,
    };
    expect(terrorPlayAction(state)).toBeUndefined();
  });

  // ─── Main effect: +2 to all your influence attempts this turn ────────────────

  test('playing it adds a player-scoped +2 influence constraint (scope turn) and discards the card', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [{ defId: THE_BALROG, items: [FLAME_OF_UDUN] }] }],
          hand: [BA_78], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, BA_78);
    const play = terrorPlayAction(state)!;
    const after = dispatch(state, play);

    const boosts = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence' && c.target.kind === 'player',
    );
    expect(boosts).toHaveLength(1);
    const boost = boosts[0];
    expect(boost.scope.kind).toBe('turn');
    if (boost.kind.type === 'check-modifier') expect(boost.kind.value).toBe(2);
    if (boost.target.kind === 'player') expect(boost.target.playerId).toBe(PLAYER_1);

    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  test('the +2 reduces the influence-attempt need for every one of your characters', () => {
    // Orc Captain & Luitprand (both DI 0) vs Variags (inf# 9): baseline need 9.
    const base = buildSitePhaseState({
      characters: [ORC_CAPTAIN, LUITPRAND],
      site: VARIAG_CAMP,
      hand: [VARIAGS],
    });
    const capId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_CAPTAIN);
    const luitId = findCharInstanceId(base, RESOURCE_PLAYER, LUITPRAND);

    const needsFor = (s: GameState) =>
      viableActions(s, PLAYER_1, 'influence-attempt')
        .map(ea => ea.action as InfluenceAttemptAction)
        .reduce<Record<string, number>>((acc, a) => {
          acc[a.influencingCharacterId as string] = a.need;
          return acc;
        }, {});

    const baseline = needsFor(base);
    expect(baseline[capId as string]).toBe(9);
    expect(baseline[luitId as string]).toBe(9);

    const boosted = addConstraint(base, {
      source: 'thd-1' as CardInstanceId,
      sourceDefinitionId: BA_78,
      scope: { kind: 'turn' },
      target: { kind: 'player', playerId: PLAYER_1 },
      kind: { type: 'check-modifier', check: 'influence', value: 2 },
    });
    const boostedNeeds = needsFor(boosted);
    expect(boostedNeeds[capId as string]).toBe(7);
    expect(boostedNeeds[luitId as string]).toBe(7);
  });

  // ─── Sideboard self-relocation ───────────────────────────────────────────────

  test('a sideboard copy offers a card-sideboard-to-deck action during the org phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [THE_BALROG] }],
          hand: [], sideboard: [BA_78], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sideboardInst = state.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    const offers = viableActions(state, PLAYER_1, 'card-sideboard-to-deck')
      .map(ea => ea.action as { cardInstanceId: CardInstanceId });
    expect(offers).toHaveLength(1);
    expect(offers[0].cardInstanceId).toBe(sideboardInst);
  });

  test('dispatching card-sideboard-to-deck moves the card from the sideboard into the play deck', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [THE_BALROG] }],
          hand: [], sideboard: [BA_78], playDeck: [MINAS_TIRITH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sideboardInst = state.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    const action = viableActions(state, PLAYER_1, 'card-sideboard-to-deck')[0].action;
    const after = dispatch(state, action);

    expect(after.players[RESOURCE_PLAYER].sideboard.map(c => c.instanceId)).not.toContain(sideboardInst);
    expect(after.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId)).toContain(sideboardInst);
    // No instance lost: the card is gone from the sideboard but present in the deck.
    expect(after.players[RESOURCE_PLAYER].playDeck).toHaveLength(2);
  });

  test('no card-sideboard-to-deck action when no such card sits in the sideboard', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [THE_BALROG] }],
          hand: [], sideboard: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'card-sideboard-to-deck',
    )).toHaveLength(0);
  });
});
