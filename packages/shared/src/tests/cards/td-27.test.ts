/**
 * @module td-27.test
 *
 * Card test: From the Pits of Angband (td-27)
 * Type: hazard-event (long)
 *
 * Text:
 *   "At the end of each turn, each player may take one unique Dragon
 *    manifestation or one Drake hazard creature from his discard pile and
 *    shuffle it into his play deck. Alternatively, if Doors of Night is in
 *    play, at the end of each turn, each player may return one unique Dragon
 *    manifestation and/or one Drake hazard creature from his discard pile to
 *    his hand. Cannot be duplicated."
 *
 * Engine Support:
 * | # | Rule                                                   | Status      | Notes                                        |
 * |---|--------------------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Cannot be duplicated (game scope, max 1)               | IMPLEMENTED | duplication-limit gates play-hazard          |
 * | 2 | Can be played as a hazard long-event during M/H        | IMPLEMENTED | generic hazard long-event play flow          |
 * | 3 | End-of-turn optional fetch to deck (both players) for  | IMPLEMENTED | on-event: end-of-turn actor:both +           |
 * |   | unique Dragon manifestation OR Drake creature          |             | fireEndOfTurnFetchEffects (reducer-site.ts)  |
 * | 4 | With DoN: optional fetch to hand for Dragon manif.     | IMPLEMENTED | on-event: end-of-turn actor:both, when:DoN  |
 *    |   and/or Drake creature (separate choices, AND/OR)     |             | to:'hand' mode in fetch pending effect       |
 *
 * Playable: YES — all rules implemented.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  addCardInPlay,
  dispatch,
  HAZARD_PLAYER, RESOURCE_PLAYER,
  Phase,
  makeMHState,
  viableActions,
  makeSitePhase,
  playHazardAndResolve,
  handCardId,
  P1_COMPANY,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, GameState } from '../../index.js';
import { CardStatus } from '../../index.js';
import { DOORS_OF_NIGHT } from '../../card-ids.js';

const FROM_THE_PITS = 'td-27' as CardDefinitionId;
// Drake hazard creature
const RAIN_DRAKE = 'td-57' as CardDefinitionId;
// Unique Dragon manifestation
const AGBURANAR_AHUNT = 'td-1' as CardDefinitionId;
// Non-drake, non-dragon hazard creature (should not match fetch filter)
const CAVE_TROLL = 'tw-14' as CardDefinitionId;

describe('From the Pits of Angband (td-27)', () => {
  beforeEach(() => resetMint());

  test('can be played as a hazard long-event during M/H play-hazards step', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FROM_THE_PITS], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: GameState = { ...base, phaseState: makeMHState() };

    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);

    const cardId = handCardId(mhState, HAZARD_PLAYER);
    const resolved = playHazardAndResolve(mhState, PLAYER_2, cardId, P1_COMPANY);

    expect(resolved.chain).toBeNull();
    expect(resolved.players[1].hand).toHaveLength(0);
    expect(resolved.players[1].cardsInPlay).toHaveLength(1);
    expect(resolved.players[1].cardsInPlay[0].definitionId).toBe(FROM_THE_PITS);
  });

  test('cannot be duplicated — second copy rejected when one is already in play', () => {
    const existing: CardInPlay = {
      instanceId: 'pits-1' as CardInstanceId,
      definitionId: FROM_THE_PITS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [FROM_THE_PITS],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [existing],
        },
      ],
    });
    const mhState: GameState = { ...base, phaseState: makeMHState() };

    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('duplication-limit applies across players (game scope)', () => {
    const existing: CardInPlay = {
      instanceId: 'pits-1' as CardInstanceId,
      definitionId: FROM_THE_PITS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          cardsInPlay: [existing],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [FROM_THE_PITS],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState: GameState = { ...base, phaseState: makeMHState() };

    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  // ─── Rule 3: end-of-turn fetch-to-deck (no Doors of Night) ─────────────────

  test('at EOT transition (no DoN), both players get a pending fetch-to-deck effect', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [RAIN_DRAKE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          discardPile: [AGBURANAR_AHUNT],
        },
      ],
    });
    const withEvent = addCardInPlay(base, HAZARD_PLAYER, FROM_THE_PITS);
    const inSitePhase = {
      ...withEvent,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterPass = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });

    expect(afterPass.phaseState.phase).toBe(Phase.EndOfTurn);
    // Both players should have a pending fetch-to-deck effect
    expect(afterPass.pendingEffects.length).toBe(2);
    const actors = afterPass.pendingEffects.map(e => e.actor);
    expect(actors).toContain(PLAYER_1);
    expect(actors).toContain(PLAYER_2);

    for (const pe of afterPass.pendingEffects) {
      expect(pe.type).toBe('card-effect');
      if (pe.type === 'card-effect') {
        expect(pe.effect.type).toBe('fetch-to-deck');
        expect(pe.skipDiscard).toBe(true);
        if (pe.effect.type === 'fetch-to-deck') {
          // Normal mode: fetch to deck
          expect(pe.effect.to ?? 'deck').toBe('deck');
        }
      }
    }
  });

  test('at EOT (no DoN), a player can shuffle a Drake creature from discard into play deck', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [RAIN_DRAKE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withEvent = addCardInPlay(base, HAZARD_PLAYER, FROM_THE_PITS);
    const inSitePhase = {
      ...withEvent,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });

    const drakeInstance = afterTransition.players[RESOURCE_PLAYER].discardPile.find(
      c => c.definitionId === RAIN_DRAKE,
    );
    expect(drakeInstance).toBeDefined();

    const afterFetch = dispatch(afterTransition, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: drakeInstance!.instanceId,
      source: 'discard-pile',
    });

    // Drake should be in play deck
    expect(afterFetch.players[RESOURCE_PLAYER].playDeck.some(c => c.definitionId === RAIN_DRAKE)).toBe(true);
    // Drake should NOT be in discard pile
    expect(afterFetch.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === RAIN_DRAKE)).toBe(false);
  });

  test('at EOT (no DoN), a player can shuffle a Dragon manifestation from discard into play deck', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [AGBURANAR_AHUNT],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withEvent = addCardInPlay(base, HAZARD_PLAYER, FROM_THE_PITS);
    const inSitePhase = {
      ...withEvent,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });

    const manifestInstance = afterTransition.players[RESOURCE_PLAYER].discardPile.find(
      c => c.definitionId === AGBURANAR_AHUNT,
    );
    expect(manifestInstance).toBeDefined();

    const afterFetch = dispatch(afterTransition, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: manifestInstance!.instanceId,
      source: 'discard-pile',
    });

    expect(afterFetch.players[RESOURCE_PLAYER].playDeck.some(c => c.definitionId === AGBURANAR_AHUNT)).toBe(true);
    expect(afterFetch.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === AGBURANAR_AHUNT)).toBe(false);
  });

  test('fetch filter rejects non-dragon, non-drake hazard creatures', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [CAVE_TROLL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withEvent = addCardInPlay(base, HAZARD_PLAYER, FROM_THE_PITS);
    const inSitePhase = {
      ...withEvent,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });

    // Legal actions for PLAYER_1 should only be 'pass' — no Cave Troll fetch
    const p1Effect = afterTransition.pendingEffects.find(e => e.actor === PLAYER_1);
    expect(p1Effect).toBeDefined();

    const actions = viableActions(afterTransition, PLAYER_1, 'fetch-from-pile');
    expect(actions).toHaveLength(0);
  });

  test('fetch is optional — a player may pass and decline to retrieve', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [RAIN_DRAKE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withEvent = addCardInPlay(base, HAZARD_PLAYER, FROM_THE_PITS);
    const inSitePhase = {
      ...withEvent,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });
    expect(afterTransition.pendingEffects.length).toBe(2);

    // PLAYER_1 passes (declines fetch)
    const afterPass = dispatch(afterTransition, { type: 'pass', player: PLAYER_1 });

    // Only PLAYER_2's effect should remain
    expect(afterPass.pendingEffects.length).toBe(1);
    expect(afterPass.pendingEffects[0].actor).toBe(PLAYER_2);

    // Drake should still be in PLAYER_1's discard pile
    expect(afterPass.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === RAIN_DRAKE)).toBe(true);
  });

  test('fetch is offered to BOTH players (resource and hazard)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [RAIN_DRAKE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          discardPile: [AGBURANAR_AHUNT],
        },
      ],
    });
    const withEvent = addCardInPlay(base, HAZARD_PLAYER, FROM_THE_PITS);
    const inSitePhase = {
      ...withEvent,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });

    // Both players have a pending fetch effect
    expect(afterTransition.pendingEffects.length).toBe(2);
    const actors = afterTransition.pendingEffects.map(e => e.actor);
    expect(actors).toContain(PLAYER_1);
    expect(actors).toContain(PLAYER_2);
  });

  // ─── Rule 4: Doors of Night alternative — fetch to hand ─────────────────────

  test('with Doors of Night in play, both players get fetch-to-hand effects instead', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [RAIN_DRAKE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          discardPile: [AGBURANAR_AHUNT],
          // Doors of Night in play for hazard player
          cardsInPlay: [],
        },
      ],
    });
    const withPits = addCardInPlay(base, HAZARD_PLAYER, FROM_THE_PITS);
    const withDoN = addCardInPlay(withPits, HAZARD_PLAYER, DOORS_OF_NIGHT as unknown as CardDefinitionId);
    const inSitePhase = {
      ...withDoN,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });

    expect(afterTransition.phaseState.phase).toBe(Phase.EndOfTurn);
    // With DoN, there are TWO separate effects per player (one for Dragon manifestations, one for Drakes)
    // so 4 total pending effects (2 players × 2 DoN effects)
    expect(afterTransition.pendingEffects.length).toBe(4);

    // All effects should be fetch-to-hand
    for (const pe of afterTransition.pendingEffects) {
      expect(pe.type).toBe('card-effect');
      if (pe.type === 'card-effect' && pe.effect.type === 'fetch-to-deck') {
        expect(pe.effect.to).toBe('hand');
        expect(pe.skipDiscard).toBe(true);
      }
    }
  });

  test('with Doors of Night, a player can return a Drake creature from discard to hand', () => {
    // Queue order: [Dragon manif P1, Dragon manif P2, Drake P1, Drake P2]
    // P1 has Rain-drake but no Dragon manifestation, P2 has neither.
    // To reach the Drake fetch for P1 (position 2), P1 and P2 must first
    // pass on their Dragon manifestation fetches (positions 0 and 1).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [RAIN_DRAKE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withPits = addCardInPlay(base, HAZARD_PLAYER, FROM_THE_PITS);
    const withDoN = addCardInPlay(withPits, HAZARD_PLAYER, DOORS_OF_NIGHT as unknown as CardDefinitionId);
    const inSitePhase = {
      ...withDoN,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });
    expect(afterTransition.pendingEffects.length).toBe(4);

    // P1 passes on Dragon manifestation fetch (no manifest in discard)
    const afterP1PassManifest = dispatch(afterTransition, { type: 'pass', player: PLAYER_1 });
    expect(afterP1PassManifest.pendingEffects.length).toBe(3);

    // P2 passes on Dragon manifestation fetch (no manifest in discard)
    const afterP2PassManifest = dispatch(afterP1PassManifest, { type: 'pass', player: PLAYER_2 });
    expect(afterP2PassManifest.pendingEffects.length).toBe(2);

    // Now the first pending effect is the Drake fetch for PLAYER_1
    const drakeInstance = afterP2PassManifest.players[RESOURCE_PLAYER].discardPile.find(
      c => c.definitionId === RAIN_DRAKE,
    );
    expect(drakeInstance).toBeDefined();

    const afterFetch = dispatch(afterP2PassManifest, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: drakeInstance!.instanceId,
      source: 'discard-pile',
    });

    // Drake should now be in hand (returned to hand, not shuffled into deck)
    expect(afterFetch.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === RAIN_DRAKE)).toBe(true);
    // Drake should NOT be in discard pile
    expect(afterFetch.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === RAIN_DRAKE)).toBe(false);
    // Drake should NOT be in play deck
    expect(afterFetch.players[RESOURCE_PLAYER].playDeck.some(c => c.definitionId === RAIN_DRAKE)).toBe(false);
  });

  test('with Doors of Night, a player can return a Dragon manifestation from discard to hand', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [AGBURANAR_AHUNT],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withPits = addCardInPlay(base, HAZARD_PLAYER, FROM_THE_PITS);
    const withDoN = addCardInPlay(withPits, HAZARD_PLAYER, DOORS_OF_NIGHT as unknown as CardDefinitionId);
    const inSitePhase = {
      ...withDoN,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });

    const manifestInstance = afterTransition.players[RESOURCE_PLAYER].discardPile.find(
      c => c.definitionId === AGBURANAR_AHUNT,
    );
    expect(manifestInstance).toBeDefined();

    const afterFetch = dispatch(afterTransition, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: manifestInstance!.instanceId,
      source: 'discard-pile',
    });

    // Dragon manifestation should be in hand
    expect(afterFetch.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === AGBURANAR_AHUNT)).toBe(true);
    expect(afterFetch.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === AGBURANAR_AHUNT)).toBe(false);
  });

  test('with Doors of Night, AND/OR: a player can return both a Dragon manifestation AND a Drake in same turn', () => {
    // The DoN mode provides TWO separate optional fetches: one for Dragon manifestations,
    // one for Drakes — both independently optional (AND/OR semantics).
    // Queue order: [Dragon manif P1, Dragon manif P2, Drake P1, Drake P2]
    // P1 has both in discard; P2 has neither.
    // Resolution: P1 fetches Dragon manifest (pos 0), P2 passes (pos 1), P1 fetches Drake (pos 2), P2 passes (pos 3).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [AGBURANAR_AHUNT, RAIN_DRAKE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withPits = addCardInPlay(base, HAZARD_PLAYER, FROM_THE_PITS);
    const withDoN = addCardInPlay(withPits, HAZARD_PLAYER, DOORS_OF_NIGHT as unknown as CardDefinitionId);
    const inSitePhase = {
      ...withDoN,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });
    expect(afterTransition.pendingEffects.length).toBe(4);

    // PLAYER_1 fetches Dragon manifestation (effect at position 0)
    const manifestInstance = afterTransition.players[RESOURCE_PLAYER].discardPile.find(
      c => c.definitionId === AGBURANAR_AHUNT,
    )!;
    const afterManifest = dispatch(afterTransition, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: manifestInstance.instanceId,
      source: 'discard-pile',
    });
    expect(afterManifest.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === AGBURANAR_AHUNT)).toBe(true);
    expect(afterManifest.pendingEffects.length).toBe(3);

    // PLAYER_2 passes on Dragon manifestation fetch (position 1 now at top)
    const afterP2PassManifest = dispatch(afterManifest, { type: 'pass', player: PLAYER_2 });
    expect(afterP2PassManifest.pendingEffects.length).toBe(2);

    // PLAYER_1 fetches Drake (now at position 0)
    const drakeInstance = afterP2PassManifest.players[RESOURCE_PLAYER].discardPile.find(
      c => c.definitionId === RAIN_DRAKE,
    )!;
    const afterDrake = dispatch(afterP2PassManifest, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: drakeInstance.instanceId,
      source: 'discard-pile',
    });

    // Both are in hand now
    expect(afterDrake.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === AGBURANAR_AHUNT)).toBe(true);
    expect(afterDrake.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === RAIN_DRAKE)).toBe(true);
    // P1 has no more pending fetch effects; P2's Drake fetch still pending
    expect(afterDrake.pendingEffects.filter(pe => pe.actor === PLAYER_1)).toHaveLength(0);
  });

  test('with Doors of Night, normal fetch-to-deck effects are NOT generated', () => {
    // When DoN is in play, the `when: { "$not": { "inPlay": "Doors of Night" } }` condition
    // prevents the normal fetch-to-deck effect from firing. Only the hand-return effects fire.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [RAIN_DRAKE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withPits = addCardInPlay(base, HAZARD_PLAYER, FROM_THE_PITS);
    const withDoN = addCardInPlay(withPits, HAZARD_PLAYER, DOORS_OF_NIGHT as unknown as CardDefinitionId);
    const inSitePhase = {
      ...withDoN,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });

    // All pending effects should be fetch-to-hand (to: 'hand'), not fetch-to-deck
    for (const pe of afterTransition.pendingEffects) {
      if (pe.type === 'card-effect' && pe.effect.type === 'fetch-to-deck') {
        expect(pe.effect.to).toBe('hand');
      }
    }
  });

  test('without Doors of Night, normal fetch-to-deck effect fires (not hand-return)', () => {
    // Without DoN, only the `when: { "$not": { "inPlay": "Doors of Night" } }` effect fires.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [RAIN_DRAKE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withEvent = addCardInPlay(base, HAZARD_PLAYER, FROM_THE_PITS);
    const inSitePhase = {
      ...withEvent,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });

    // Exactly 2 pending effects (one per player), both fetch-to-deck
    expect(afterTransition.pendingEffects.length).toBe(2);
    for (const pe of afterTransition.pendingEffects) {
      if (pe.type === 'card-effect' && pe.effect.type === 'fetch-to-deck') {
        expect(pe.effect.to ?? 'deck').toBe('deck');
      }
    }
  });
});
