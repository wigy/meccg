/**
 * @module le-228.test
 *
 * Card test: Skies of Fire (le-228)
 * Type: minion-resource-event (permanent, environment)
 * Effects: 3
 *   1. duplication-limit scope:game max:1 ("Cannot be duplicated")
 *   2. on-event self-enters-play move (filter-all in-play → discard,
 *      filter hazard-event + environment) — "all hazard environment cards in
 *      play are immediately discarded, and all hazard environment effects are
 *      canceled"
 *   3. name-alias as:"Gates of Morning" — "acts as Gates of Morning for the
 *      purposes of interpreting hazards"
 *
 * "Environment. When Skies of Fire is played, all hazard environment cards in
 *  play are immediately discarded, and all hazard environment effects are
 *  canceled. This card acts as Gates of Morning for the purposes of
 *  interpreting hazards. Cannot be duplicated."
 *
 * Skies of Fire is the minion-side counterpart to Gates of Morning (tw-243):
 * the discard-on-play and duplication mechanics are identical and
 * alignment-agnostic, so they are exercised here against minion fixtures. The
 * distinguishing rule is the `name-alias` effect — while Skies of Fire is in
 * play, any DSL `when: { inPlay: "Gates of Morning" }` gate is satisfied. That
 * is proven by Dark Quarrels (tw-207), whose halve-strikes mode is gated on
 * Gates of Morning being in play: it becomes available against an otherwise
 * un-cancelable (Dragon) attack only because Skies of Fire aliases to Gates of
 * Morning.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  DOORS_OF_NIGHT, CAVE_DRAKE,
  viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  playPermanentEventAndResolve,
  CardStatus,
  handCardId, companyIdAt, dispatch,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { RegionType, SiteType } from '../../index.js';
import type { CardInPlay, CardDefinitionId, CardInstanceId } from '../../index.js';

const SKIES_OF_FIRE = 'le-228' as CardDefinitionId;
const DARK_QUARRELS = 'tw-207' as CardDefinitionId; // gated on inPlay: "Gates of Morning"

// Minion fixtures — referenced only in this test file.
const LAGDUF = 'le-18' as CardDefinitionId;        // warrior, orc
const OSTISEN = 'le-36' as CardDefinitionId;       // scout, man
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold

describe('Skies of Fire (le-228)', () => {
  beforeEach(() => resetMint());

  test('can be played as a permanent environment during organization', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [SKIES_OF_FIRE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);

    const sofId = handCardId(state, RESOURCE_PLAYER);

    // After declaring, card is on the chain (not in hand, not in cardsInPlay).
    const declared = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: sofId });
    expect(declared.players[0].hand).toHaveLength(0);
    expect(declared.players[0].cardsInPlay).toHaveLength(0);
    expect(declared.chain).not.toBeNull();

    // After the chain resolves, the card moves to cardsInPlay.
    const s = playPermanentEventAndResolve(state, PLAYER_1, sofId);
    expect(s.chain).toBeNull();
    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].cardsInPlay[0].instanceId).toBe(sofId);
  });

  test('discards an opposing hazard environment (Doors of Night) when played', () => {
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [SKIES_OF_FIRE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [donInPlay] },
      ],
    });

    const sofId = handCardId(state, RESOURCE_PLAYER);
    const s = playPermanentEventAndResolve(state, PLAYER_1, sofId);

    // Skies of Fire entered play.
    expect(s.players[0].cardsInPlay.map(c => c.instanceId)).toContain(sofId);

    // Doors of Night discarded from P2's cardsInPlay.
    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain('don-1' as CardInstanceId);
  });

  test('discards the player\'s own hazard environment too', () => {
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [SKIES_OF_FIRE], siteDeck: [MORIA_MINION], cardsInPlay: [donInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const sofId = handCardId(state, RESOURCE_PLAYER);
    const s = playPermanentEventAndResolve(state, PLAYER_1, sofId);

    // Only Skies of Fire remains in play; Doors of Night went to discard.
    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].cardsInPlay[0].instanceId).toBe(sofId);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain('don-1' as CardInstanceId);
  });

  test('no hazard environments in play → playing it is a no-op discard', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [SKIES_OF_FIRE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const sofId = handCardId(state, RESOURCE_PLAYER);
    const s = playPermanentEventAndResolve(state, PLAYER_1, sofId);

    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].discardPile).toHaveLength(0);
    expect(s.players[1].discardPile).toHaveLength(0);
  });

  test('cannot be duplicated — a copy already in play blocks the play (own side)', () => {
    const sofInPlay: CardInPlay = {
      instanceId: 'sof-existing' as CardInstanceId,
      definitionId: SKIES_OF_FIRE,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [SKIES_OF_FIRE], siteDeck: [MORIA_MINION], cardsInPlay: [sofInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('cannot be duplicated — a copy in the opponent\'s play also blocks it (scope game)', () => {
    const sofInPlay: CardInPlay = {
      instanceId: 'sof-existing' as CardInstanceId,
      definitionId: SKIES_OF_FIRE,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [SKIES_OF_FIRE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [sofInPlay] },
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // --- "Acts as Gates of Morning for the purposes of interpreting hazards" ---
  //
  // Dark Quarrels (tw-207) halves the strikes of *any* attack, but only when
  // Gates of Morning is in play. Against a Dragon attack (not Orc/Troll/Men)
  // its cancel-attack mode is unavailable, so a viable halve-strikes action
  // can only come from the Gates-of-Morning gate being satisfied — which here
  // is satisfied solely by Skies of Fire's name-alias.

  test('aliases to Gates of Morning: enables Dark Quarrels halve-strikes vs a Dragon', () => {
    const sofInPlay: CardInPlay = {
      instanceId: 'sof-1' as CardInstanceId,
      definitionId: SKIES_OF_FIRE,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [DARK_QUARRELS], siteDeck: [DOL_GULDUR], cardsInPlay: [sofInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [CAVE_DRAKE], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir', 'Eryn Vorn'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const caveDrakeId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, caveDrakeId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();

    // cancel-attack is unavailable — a Dragon is not Orc/Troll/Men.
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);

    // halve-strikes IS available purely because Skies of Fire aliases Gates of Morning.
    expect(viableActions(combatState, PLAYER_1, 'halve-strikes')).toHaveLength(1);
  });

  test('without Skies of Fire, Dark Quarrels halve-strikes is NOT available vs a Dragon', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [DARK_QUARRELS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [CAVE_DRAKE], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir', 'Eryn Vorn'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const caveDrakeId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, caveDrakeId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();
    // No Gates-of-Morning alias in play → neither mode of Dark Quarrels applies vs a Dragon.
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
    expect(viableActions(combatState, PLAYER_1, 'halve-strikes')).toHaveLength(0);
  });

  test('aliasing does not make Skies of Fire collide with a real Gates of Morning for duplication', () => {
    // Skies of Fire aliases the *name list* for inPlay checks, but its own
    // duplication-limit counts only actual Skies-of-Fire copies. A Gates of
    // Morning (different definition) in play must not block Skies of Fire.
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: 'tw-243' as CardDefinitionId,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [SKIES_OF_FIRE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [gomInPlay] },
      ],
    });

    // Skies of Fire is still playable — its game-scope duplication limit only
    // counts cards named "Skies of Fire", not the aliased Gates of Morning.
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(1);
  });
});
