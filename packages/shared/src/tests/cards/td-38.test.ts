/**
 * @module td-38.test
 *
 * Card test: Itangast at Home (td-38)
 * Type: hazard-event (permanent), keyword `dragon-manifestation`, manifestId td-36
 *
 * Text:
 *   "Unique. Unless Itangast Ahunt is in play, Gold Hill has an additional
 *    automatic-attack: Dragon — 3 strikes at 19/8. In addition, each greater
 *    item gives an additional corruption point."
 *
 * Effects:
 * | # | Effect Type            | Status | Notes                                                       |
 * |---|------------------------|--------|-------------------------------------------------------------|
 * | 1 | dragon-at-home         | OK     | +Dragon (3 strikes, 19 prow) on Gold Hill; suppressed by Itangast Ahunt |
 * | 2 | in-play-item-modifier  | OK     | +1 corruption point on every greater item (both players)    |
 *
 * The augment attack's printed "/8" body follows the codebase convention for
 * Dragon lair auto-attacks: every site auto-attack (including Gold Hill's own
 * printed Dragon attack) is modeled with strikes+prowess only, so the augment
 * is likewise modeled as {Dragon, 3 strikes, 19 prowess}.
 *
 * Corruption fixtures: The Arkenstone (tw-341, subtype greater, printed
 * corruption 2) is the affected item; Dagger of Westernesse (tw-206, subtype
 * minor, printed corruption 1) is the non-greater control.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  addCardInPlay, attachItemToChar, charIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { Phase, Alignment } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState, SiteCard } from '../../index.js';

const ITANGAST_AT_HOME = 'td-38' as CardDefinitionId;
const ITANGAST_AHUNT = 'td-37' as CardDefinitionId;
const GOLD_HILL = 'td-176' as CardDefinitionId;       // Itangast's lair (lairOf td-36)
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // a different Dragon's lair
const THE_ARKENSTONE = 'tw-341' as CardDefinitionId;  // greater item, printed corruption 2
const DAGGER_OF_WESTERNESSE = 'tw-206' as CardDefinitionId; // minor item, printed corruption 1

/**
 * Build an M/H-phase state with P1 (resource) as the active player processing
 * its company and P2 (hazard) holding the given cards in play.
 */
function buildMHState(inPlay: CardDefinitionId[], mhOverrides?: Partial<MovementHazardPhaseState>): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
    ],
  });

  let withCards = base;
  for (const def of inPlay) {
    withCards = addCardInPlay(withCards, HAZARD_PLAYER, def);
  }

  const mhState = makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0, ...mhOverrides });
  return { ...withCards, phaseState: mhState };
}

/** Build an organization-phase state for the corruption-point assertions. */
function buildOrgState(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Itangast at Home (td-38)', () => {
  beforeEach(() => resetMint());

  // ─── dragon-at-home augmentation ──────────────────────────────────────────

  test('Gold Hill has only its printed Dragon attack when no At-Home is in play', () => {
    const state = buildMHState([]);
    const goldHill = state.cardPool[GOLD_HILL] as SiteCard;
    const attacks = getActiveAutoAttacks(state, goldHill);
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ creatureType: 'Dragon', strikes: 1, prowess: 15 });
  });

  test('At-Home in play appends the extra Dragon (3 strikes, 19 prowess) to Gold Hill', () => {
    const state = buildMHState([ITANGAST_AT_HOME]);
    const goldHill = state.cardPool[GOLD_HILL] as SiteCard;
    const attacks = getActiveAutoAttacks(state, goldHill);
    expect(attacks).toHaveLength(2);
    expect(attacks[0]).toMatchObject({ strikes: 1, prowess: 15 });
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 3, prowess: 19 });
  });

  test('Itangast Ahunt in play suppresses the At-Home augmentation', () => {
    const state = buildMHState([ITANGAST_AT_HOME, ITANGAST_AHUNT]);
    const goldHill = state.cardPool[GOLD_HILL] as SiteCard;
    expect(getActiveAutoAttacks(state, goldHill)).toHaveLength(1);
  });

  test('At-Home augments only Itangast\'s lair, not a different Dragon\'s lair', () => {
    const state = buildMHState([ITANGAST_AT_HOME]);
    const lonely = state.cardPool[LONELY_MOUNTAIN] as SiteCard;
    // Lonely Mountain belongs to a different Dragon → unaffected by Itangast at Home.
    expect(getActiveAutoAttacks(state, lonely)).toHaveLength(1);
  });

  // ─── in-play-item-modifier: +1 corruption per greater item ────────────────

  test('greater item bearer gains +1 corruption point while At-Home is in play', () => {
    const base = buildOrgState();
    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    // Arkenstone on Aragorn, no At-Home: printed corruption 2.
    const withItem = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, THE_ARKENSTONE));
    expect(withItem.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(2);

    // Opponent plays Itangast at Home: greater-item corruption becomes 3.
    const withAtHome = recomputeDerived(addCardInPlay(withItem, HAZARD_PLAYER, ITANGAST_AT_HOME));
    expect(withAtHome.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(3);
  });

  test('non-greater item is unaffected (filter matches only greater items)', () => {
    const base = buildOrgState();
    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    // Dagger of Westernesse (minor): printed corruption 1 — unchanged by At-Home.
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    const withAtHome = recomputeDerived(addCardInPlay(withItem, HAZARD_PLAYER, ITANGAST_AT_HOME));
    expect(withAtHome.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(1);
  });

  test('boost applies to greater items held by both players ("each greater item")', () => {
    const base = buildOrgState();
    const legolasId = charIdAt(base, HAZARD_PLAYER);

    // Greater item borne by the At-Home owner's OWN character is boosted too.
    const withItem = attachItemToChar(base, HAZARD_PLAYER, LEGOLAS, THE_ARKENSTONE);
    const withAtHome = recomputeDerived(addCardInPlay(withItem, HAZARD_PLAYER, ITANGAST_AT_HOME));
    expect(withAtHome.players[HAZARD_PLAYER].characters[legolasId].effectiveStats.corruptionPoints).toBe(2 + 1);
  });

  test('corruption boost ends when At-Home leaves play', () => {
    const base = buildOrgState();
    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, THE_ARKENSTONE);
    const withAtHome = recomputeDerived(addCardInPlay(withItem, HAZARD_PLAYER, ITANGAST_AT_HOME));
    expect(withAtHome.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(3);

    // Move the At-Home to the discard pile: corruption reverts to printed 2.
    const p2 = withAtHome.players[HAZARD_PLAYER];
    const atHome = p2.cardsInPlay.find(c => c.definitionId === ITANGAST_AT_HOME);
    if (!atHome) throw new Error('td-38 not in P2 cardsInPlay');
    const without = recomputeDerived({
      ...withAtHome,
      players: [
        withAtHome.players[0],
        {
          ...p2,
          cardsInPlay: p2.cardsInPlay.filter(c => c.instanceId !== atHome.instanceId),
          discardPile: [...p2.discardPile, { instanceId: atHome.instanceId, definitionId: atHome.definitionId }],
        },
      ] as unknown as typeof withAtHome.players,
    });
    expect(without.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(2);
  });
});
