/**
 * @module dm-86.test
 *
 * Card test: Scimitars of Steel (dm-86)
 * Type: hazard-event (permanent)
 * Effects: 2
 *   1. play-discard-cost (source: cards-in-play) — playable only while a
 *      Nazgûl permanent-event is in play; that card is discarded when this
 *      one is brought into play
 *   2. stat-modifier prowess +1 to all Orc, Troll, and Man attacks
 *
 * Card text:
 *   "Playable only if you have a Nazgûl permanent-event in play. Discard the
 *    Nazgûl when this card is brought into play. All Orc, Troll, and Men
 *    attacks receive +1 prowess."
 *
 * Test fixtures:
 *   - Witch-king of Angmar (tw-113): dual creature/permanent-event, keyword
 *     Nazgûl — used as "a Nazgûl permanent-event in play".
 *   - Dimrill Dale (tw-385): Orcs auto-attack — 1 strike, 6 prowess.
 *   - Ettenmoors (tw-395): Trolls auto-attack — 1 strike, 9 prowess.
 *   - Bandit Lair (tw-373): Men auto-attack — 3 strikes, 6 prowess.
 *   - Gladden Fields (tw-396): Undead auto-attack — 1 strike, 8 prowess (control).
 *
 * | # | Effect                                    | Status      | Notes                                          |
 * |---|--------------------------------------------|-------------|-------------------------------------------------|
 * | 1 | play-discard-cost (cards-in-play, Nazgûl)  | IMPLEMENTED | source: 'cards-in-play' (mh-hazard-play.ts)     |
 * | 2 | stat-modifier prowess +1 (Orc/Troll/Man)   | IMPLEMENTED | target: all-attacks, collectGlobalEffects       |
 *
 * Playable: YES
 * Certified: 2026-08-22
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint, buildSitePhaseState,
  buildHazardMovingState, addCardInPlay,
  addP2CardsInPlay, setupAutoAttackStep,
  Phase,
  viableActions,
  makeMHState,
  findHandCardId, dispatch, resolveChain,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, PlayHazardAction } from '../../index.js';

const SCIMITARS_OF_STEEL = 'dm-86' as CardDefinitionId;
const WITCH_KING = 'tw-113' as CardDefinitionId;
// Dimrill Dale (tw-385): hero-site, Orcs — 1 strike, 6 prowess
const DIMRILL_DALE = 'tw-385' as CardDefinitionId;
// Ettenmoors (tw-395): hero-site, Trolls — 1 strike, 9 prowess
const ETTENMOORS = 'tw-395' as CardDefinitionId;
// Bandit Lair (tw-373): hero-site, Men — 3 strikes, 6 prowess
const BANDIT_LAIR = 'tw-373' as CardDefinitionId;
// Gladden Fields (tw-396): hero-site, Undead — 1 strike, 8 prowess (control)
const GLADDEN_FIELDS = 'tw-396' as CardDefinitionId;

/** Scimitars of Steel as a card already in player 2's cardsInPlay. */
const scimitarsInPlay: CardInPlay = {
  instanceId: 'scimitars-1' as CardInstanceId,
  definitionId: SCIMITARS_OF_STEEL,
  status: CardStatus.Untapped,
};

describe('Scimitars of Steel (dm-86)', () => {
  beforeEach(() => resetMint());

  // ── Play-condition / discard cost ──────────────────────────────────────────

  test('not playable when no Nazgûl permanent-event is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SCIMITARS_OF_STEEL], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('playable with a Nazgûl permanent-event in play, and discards it when brought into play', () => {
    let ready = buildHazardMovingState(MORIA, 'Moria', [SCIMITARS_OF_STEEL], [ARAGORN], { origin: LORIEN });
    ready = addCardInPlay(ready, HAZARD_PLAYER, WITCH_KING);
    const nazgulId = ready.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === WITCH_KING)!.instanceId;
    const scimId = findHandCardId(ready, HAZARD_PLAYER, SCIMITARS_OF_STEEL);

    const found = viableActions(ready, PLAYER_2, 'play-hazard')
      .find(a => (a.action as PlayHazardAction).cardInstanceId === scimId);
    expect(found).toBeDefined();
    expect((found!.action as PlayHazardAction).costDiscardInstanceId).toBe(nazgulId);

    const afterChain = resolveChain(dispatch(ready, found!.action));

    // Scimitars of Steel entered play.
    expect(afterChain.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === scimId)).toBe(true);
    // The Witch-king (the Nazgûl permanent-event) was discarded, "for no
    // effect" — no tap-alt-permanent-event long-event fired.
    expect(afterChain.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === nazgulId)).toBe(false);
    expect(afterChain.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === nazgulId)).toBe(true);
    expect(afterChain.chain).toBeNull();
  });

  // ── Stat-modifier: +1 prowess to Orc, Troll, and Man attacks ───────────────

  test('Orc auto-attack prowess increased by +1 (6 → 7)', () => {
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: DIMRILL_DALE }), [scimitarsInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikeProwess).toBe(7);
  });

  test('Troll auto-attack prowess increased by +1 (9 → 10)', () => {
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: ETTENMOORS }), [scimitarsInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikeProwess).toBe(10);
  });

  test('Man auto-attack prowess increased by +1 (6 → 7)', () => {
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: BANDIT_LAIR }), [scimitarsInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikeProwess).toBe(7);
  });

  test('non-Orc/Troll/Man auto-attack is unaffected (Undead at Gladden Fields)', () => {
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: GLADDEN_FIELDS }), [scimitarsInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikeProwess).toBe(8);
  });
});
