/**
 * @module dm-175.test
 *
 * Card test: Noldo-lantern (dm-175)
 * Type: hero-resource-item (Special Item), alignment wizard, non-unique.
 * Marshalling Points: 2. Corruption Points: 2.
 *
 * Card text: "Playable at any Under-deeps site. +2 to all rolls required for
 * bearer's company to move to an adjacent site in the Under-deeps. Tap
 * Noldo-lantern to give -2 prowess and one less strike (to a minimum of one)
 * to any Undead, Nazgûl, Orc, or Troll attack against the bearer's company."
 *
 * Rule coverage:
 *
 * | # | Rule                                                          | Mechanism                                                     |
 * |---|--------------------------------------------------------------|----------------------------------------------------------------|
 * | 1 | Playable at any Under-deeps site (any site type)             | item-play-site filter on site.keywords $includes under-deeps  |
 * | 2 | +2 to rolls required for bearer's Under-deeps moves          | under-deeps-roll-modifier value:2                              |
 * | 3 | Tap: -2 prowess and -1 strike (min 1) vs Undead/Nazgûl/Orc/Troll | modify-attack cost { tap: self }, when enemy.race $in       |
 *
 * "Nazgûl" is modeled as `Race.Ringwraith`, the engine's race value for
 * Ringwraith characters/creatures (see other cards gating on
 * `enemy.race: "ringwraith"`).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  Alignment, CardStatus,
  buildTestState, buildSitePhaseState, buildFallenWizardSitePhaseState, resetMint, makeMHState,
  reduce, dispatch,
  findHandCardId, findCharInstanceId,
  attachItemToChar, makeCancelWindowCombat, viableActions,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, GIMLI, MORIA, MINAS_TIRITH,
  Phase,
} from '../test-helpers.js';
import { MovementType, Race } from '../../types/common.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState, ModifyAttackAction } from '../../index.js';

const NOLDO_LANTERN = 'dm-175' as CardDefinitionId;
const DEEP_MINES = 'wh-55' as CardDefinitionId;   // Fallen-wizard Ruins & Lairs, Under-deeps analog
const SARUMAN_FW = 'wh-9' as CardDefinitionId;    // Fallen-wizard avatar (company character)

// DM Under-deeps sites (canonical hero-map versions), one per site type, to
// prove the "any Under-deeps site" playability.
const UNDER_VAULTS = 'dm-41' as CardDefinitionId;  // ruins-and-lairs, under-deeps
const UNDER_LEAS = 'dm-40' as CardDefinitionId;    // shadow-hold, under-deeps
const UNDER_GALLERIES = 'dm-37' as CardDefinitionId; // dark-hold, under-deeps
const IRON_DEEPS = 'dm-33' as CardDefinitionId;    // dark-hold, under-deeps; adjacent to Under-vaults

describe('Noldo-lantern (dm-175)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable at any Under-deeps site ─────────────────────────────

  function lanternPlays(state: ReturnType<typeof buildSitePhaseState>) {
    const lanternId = findHandCardId(state, RESOURCE_PLAYER, NOLDO_LANTERN);
    return computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (lanternId as string),
    );
  }

  test('playable at an Under-deeps Ruins & Lairs (The Under-vaults)', () => {
    const state = buildSitePhaseState({ site: UNDER_VAULTS, characters: [ARAGORN], hand: [NOLDO_LANTERN] });
    expect(lanternPlays(state).length).toBeGreaterThanOrEqual(1);
  });

  test('playable at an Under-deeps Shadow-hold (The Under-leas)', () => {
    const state = buildSitePhaseState({ site: UNDER_LEAS, characters: [ARAGORN], hand: [NOLDO_LANTERN] });
    expect(lanternPlays(state).length).toBeGreaterThanOrEqual(1);
  });

  test('playable at an Under-deeps Dark-hold (The Under-galleries) — any site type', () => {
    const state = buildSitePhaseState({ site: UNDER_GALLERIES, characters: [ARAGORN], hand: [NOLDO_LANTERN] });
    expect(lanternPlays(state).length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-Under-deeps site (Moria)', () => {
    const state = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [NOLDO_LANTERN] });
    expect(lanternPlays(state)).toHaveLength(0);
  });

  test('playable at Deep Mines (wh-55) — an Under-deeps site without the printed keyword', () => {
    const state = buildFallenWizardSitePhaseState({ site: DEEP_MINES, characters: [SARUMAN_FW], hand: [NOLDO_LANTERN] });
    const lanternId = findHandCardId(state, RESOURCE_PLAYER, NOLDO_LANTERN);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (lanternId as string),
    );
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Rule 2: +2 to rolls required to move to adjacent Under-deeps sites ────

  function underDeepsRoll(withLantern: boolean): number {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{
            site: UNDER_VAULTS,
            characters: [withLantern ? { defId: GIMLI, items: [NOLDO_LANTERN] } : GIMLI],
            destinationSite: IRON_DEEPS,
          }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };
    const result = reduce(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.UnderDeeps });
    expect(result.error).toBeUndefined();
    const mhState = result.state.phaseState as MovementHazardPhaseState;
    expect(mhState.step).toBe('under-deeps-roll');
    return mhState.underDeepsRollRequired!;
  }

  test('bearing the Noldo-lantern lowers the required Under-deeps roll by 2', () => {
    const withLantern = underDeepsRoll(true);
    const withoutLantern = underDeepsRoll(false);
    expect(withLantern).toBe(withoutLantern - 2);
  });

  // ─── Rule 3: Tap to give -2 prowess and -1 strike (min 1) ─────────────────

  function combatVs(race: Race, strikesTotal = 2) {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, NOLDO_LANTERN);
    return makeCancelWindowCombat(base, {
      creatureRace: race,
      attackSourceType: 'creature',
      strikesTotal,
      strikeProwess: 8,
    });
  }

  test.each([Race.Undead, Race.Ringwraith, Race.Orc, Race.Troll])(
    'modify-attack IS available against a %s attack',
    race => {
      const state = combatVs(race);
      const acts = viableActions(state, PLAYER_1, 'modify-attack');
      expect(acts).toHaveLength(1);
      const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
      expect((acts[0].action as ModifyAttackAction).characterInstanceId).toBe(aragornId);
    },
  );

  test('executing modify-attack against an Orc attack lowers prowess by 2, strikes by 1, and taps the lantern', () => {
    const state = combatVs(Race.Orc, 2);
    const acts = viableActions(state, PLAYER_1, 'modify-attack');
    expect(acts).toHaveLength(1);

    const after = dispatch(state, acts[0].action);
    // Combat continues (modified, not canceled); prowess 8 → 6, strikes 2 → 1.
    expect(after.combat).not.toBeNull();
    expect(after.combat!.phase).toBe('assign-strikes');
    expect(after.combat!.strikeProwess).toBe(6);
    expect(after.combat!.strikesTotal).toBe(1);

    // Lantern is tapped, still on Aragorn, NOT discarded.
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const lantern = after.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === NOLDO_LANTERN)!;
    expect(lantern.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === NOLDO_LANTERN)).toBeUndefined();
  });

  test('strike reduction is clamped to a minimum of one', () => {
    const state = combatVs(Race.Troll, 1);
    const acts = viableActions(state, PLAYER_1, 'modify-attack');
    expect(acts).toHaveLength(1);

    const after = dispatch(state, acts[0].action);
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(6);
  });

  // ─── Negative: race not covered by the card ───────────────────────────────

  test('modify-attack is NOT available against a Wolf attack', () => {
    const state = combatVs(Race.Wolf);
    expect(viableActions(state, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  test('modify-attack is NOT available against a Spider attack', () => {
    const state = combatVs(Race.Spider);
    expect(viableActions(state, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  test('modify-attack is NOT available when the lantern is already tapped', () => {
    const state = combatVs(Race.Orc);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const char = state.players[RESOURCE_PLAYER].characters[aragornId];
    const tapped = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          characters: {
            ...state.players[RESOURCE_PLAYER].characters,
            [aragornId as string]: {
              ...char,
              items: char.items.map(it => it.definitionId === NOLDO_LANTERN ? { ...it, status: CardStatus.Tapped } : it),
            },
          },
        },
        state.players[1],
      ] as unknown as typeof state.players,
    };
    expect(viableActions(tapped, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });
});
