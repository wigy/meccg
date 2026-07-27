/**
 * @module tw-137.test
 *
 * Card test: Círdan (tw-137)
 * Type: hero-character (wizard alignment), race elf, homesite Grey Havens
 * Stats: prowess 6, body 8, mind 8, direct influence 4, MP 3 (character)
 *
 * Card text:
 *   "Unique. When Círdan is at the Grey Havens, you may keep one more card
 *    than normal in your hand. May tap to cancel one attack against his
 *    company keyed to a Coastal Sea region. +2 direct influence against the
 *    Elves of Lindon faction. -3 marshalling points if eliminated."
 *
 * Effects tested:
 * 1. hand-size-modifier: +1 while self.location is "Grey Havens"
 * 2. cancel-attack (tap self): cancels an attack keyed to a Coastal region
 * 3. stat-modifier direct-influence: +2 during faction-influence-check when
 *    faction.name is "Elves of Lindon"
 * 4. mp-modifier: -3 when reason is elimination
 *
 * Each effect is a well-established engine pattern (cf. Elrond tw-145,
 * Goldberry tw-245, Layos le-19). The tests drive the engine (resolveHandSize,
 * computeLegalActions, recomputeDerived) — no assertions on JSON data itself.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, buildSitePhaseState, resetMint, mint,
  findCharInstanceId,
  makeCancelWindowCombat,
  Phase,
} from '../test-helpers.js';
import { CardStatus, RegionType, Race } from '../../index.js';
import type {
  CardDefinitionId, CardInstance,
  CancelAttackAction, InfluenceAttemptAction, CharacterCard,
} from '../../index.js';
import { HAND_SIZE } from '../../constants.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { resolveHandSize } from '../../engine/effects/index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const CIRDAN = 'tw-137' as CardDefinitionId;
const GREY_HAVENS = 'tw-399' as CardDefinitionId;      // haven, Círdan's homesite
const ELVES_OF_LINDON = 'tw-226' as CardDefinitionId;  // elf faction, inf# 10, playable at Grey Havens
const BREE = 'tw-378' as CardDefinitionId;             // border-hold
const RANGERS_OF_THE_NORTH = 'tw-311' as CardDefinitionId; // dúnadan faction, inf# 10, playable at Bree

describe('Círdan (tw-137)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: hand-size-modifier at Grey Havens ─────────────────────────────

  test('hand size is 9 when Círdan is at the Grey Havens', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GREY_HAVENS, characters: [CIRDAN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);
    // Player 2 (no Círdan) stays at base hand size
    expect(resolveHandSize(state, 1)).toBe(HAND_SIZE);
  });

  test('hand size is 8 when Círdan is NOT at the Grey Havens', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [CIRDAN] }], hand: [], siteDeck: [GREY_HAVENS] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE);
  });

  // ─── Effect 2: cancel-attack (tap self) keyed to a Coastal region ────────────

  test('cancel-attack IS offered when the attack is keyed to a Coastal region', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRDAN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCombat = makeCancelWindowCombat(base, {
      creatureRace: Race.Animal,
      attackKeying: [RegionType.Coastal],
    });

    const cirdanId = findCharInstanceId(withCombat, RESOURCE_PLAYER, CIRDAN);
    const cancelActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(cancelActions.some(a => a.cardInstanceId === cirdanId)).toBe(true);
  });

  test('cancel-attack is NOT offered when the attack is keyed to Wilderness (not Coastal)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRDAN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCombat = makeCancelWindowCombat(base, {
      creatureRace: Race.Orc,
      attackKeying: [RegionType.Wilderness],
    });

    const cirdanId = findCharInstanceId(withCombat, RESOURCE_PLAYER, CIRDAN);
    const cancelActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(cancelActions.some(a => a.cardInstanceId === cirdanId)).toBe(false);
  });

  test('cancel-attack is NOT offered when the attack has no regional keying', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRDAN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCombat = makeCancelWindowCombat(base, {
      creatureRace: Race.Orc,
      attackKeying: [],
    });

    const cirdanId = findCharInstanceId(withCombat, RESOURCE_PLAYER, CIRDAN);
    const cancelActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(cancelActions.some(a => a.cardInstanceId === cirdanId)).toBe(false);
  });

  test('a tapped Círdan cannot cancel a Coastal-keyed attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRDAN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCombat = makeCancelWindowCombat(base, {
      creatureRace: Race.Animal,
      attackKeying: [RegionType.Coastal],
    });

    const cirdanId = findCharInstanceId(withCombat, RESOURCE_PLAYER, CIRDAN);
    const cirdanData = withCombat.players[RESOURCE_PLAYER].characters[cirdanId];
    const tappedChars = {
      ...withCombat.players[RESOURCE_PLAYER].characters,
      [cirdanId as string]: { ...cirdanData, status: CardStatus.Tapped },
    };
    const tappedState = {
      ...withCombat,
      players: [
        { ...withCombat.players[RESOURCE_PLAYER], characters: tappedChars },
        withCombat.players[HAZARD_PLAYER],
      ] as unknown as typeof withCombat.players,
    };

    const cancelActions = computeLegalActions(tappedState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(cancelActions.some(a => a.cardInstanceId === cirdanId)).toBe(false);
  });

  // ─── Effect 3: +2 direct influence vs Elves of Lindon faction ────────────────

  test('+2 DI bonus applies when influencing the Elves of Lindon faction', () => {
    // Círdan (elf, base DI 4) influences Elves of Lindon (inf# 10) at Grey Havens.
    // Two modifiers stack for an Elf influencing this faction:
    //   • Círdan's own +2 direct-influence bonus vs Elves of Lindon.
    //   • Elves of Lindon's own Elves (+2) standard modification (Círdan is an Elf).
    // need = influenceNumber(10) - baseDI(4) - cirdanBonus(2) - elvesMod(2) = 2.
    const state = buildSitePhaseState({
      characters: [CIRDAN],
      site: GREY_HAVENS,
      hand: [ELVES_OF_LINDON],
    });

    const cirdanId = findCharInstanceId(state, RESOURCE_PLAYER, CIRDAN);
    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const cirdanAttempt = influenceActions.find(a => a.influencingCharacterId === cirdanId);
    expect(cirdanAttempt).toBeDefined();
    expect(cirdanAttempt!.need).toBe(2);
  });

  test('+2 DI bonus does NOT apply to other factions (Rangers of the North)', () => {
    // Círdan (elf, base DI 4) influences Rangers of the North (inf# 10) at Bree.
    // The bonus is gated on faction.name === "Elves of Lindon", so it does not
    // apply: need = influenceNumber(10) - baseDI(4) = 6.
    const state = buildSitePhaseState({
      characters: [CIRDAN],
      site: BREE,
      hand: [RANGERS_OF_THE_NORTH],
    });

    const cirdanId = findCharInstanceId(state, RESOURCE_PLAYER, CIRDAN);
    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const cirdanAttempt = influenceActions.find(a => a.influencingCharacterId === cirdanId);
    expect(cirdanAttempt).toBeDefined();
    expect(cirdanAttempt!.need).toBe(6);
  });

  // ─── Effect 4: -3 marshalling points if eliminated ───────────────────────────

  test('-3 marshalling points when Círdan is in the eliminated pile', () => {
    const rawState = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = recomputeDerived(rawState);
    const baseMp = state.players[RESOURCE_PLAYER].marshallingPoints.character;
    expect(baseMp).toBe(3); // Aragorn = 3 character MP

    // Sanity: Círdan's printed character MP is 3, and the -3 elimination modifier
    // exactly cancels it out.
    const cirdanDef = pool[CIRDAN as string] as CharacterCard;
    expect(cirdanDef.marshallingPoints).toBe(3);

    const cirdanInstance: CardInstance = { instanceId: mint(), definitionId: CIRDAN };
    const stateWithEliminated = recomputeDerived({
      ...state,
      players: [
        { ...state.players[RESOURCE_PLAYER], outOfPlayPile: [cirdanInstance] },
        state.players[1],
      ],
    });

    // Círdan is worth 3 character MP normally, but -3 when eliminated (net 0 added).
    expect(stateWithEliminated.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(baseMp - 3);
  });
});
