/**
 * @module td-150.test
 *
 * Card test: Scabbard of Chalcedony (td-150)
 * Type: hero-resource-item (minor, wizard alignment, hoard)
 *
 * Printed text:
 *   "Hoard item. -1 body to all failed strikes against bearer. Cannot be
 *    duplicated on a given character."
 *
 * Effects (data):
 *   1. item-play-site — playable only at sites whose keywords include "hoard"
 *   2. body-check-modifier — scope "bearer-combat", value -1, gated on
 *      `bodyCheck.fromFailedStrike: true` (identical shape to Flame of Udûn
 *      ba-58 / Stabbing Tongue of Fire ba-81, just the opposite sign: those
 *      cards help the attacker's side eliminate the striker, this one
 *      protects the striking creature — i.e. hinders the bearer's own side
 *      from finishing it off — whenever a strike against the bearer fails).
 *   3. duplication-limit — scope "character", max 1.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase, Alignment,
  GANDALF, ARAGORN,
  MORIA, LORIEN,
  buildSitePhaseState, buildTestState, resetMint,
  viableActions, charIdAt,
  attachItemToChar, findCharInstanceId, executeAction,
  companyIdAt, makeBodyCheckCombat, makeShadowMHState,
  addP2CardsInPlay, findInPile,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, GameState } from '../../index.js';
import { CardStatus, Race } from '../../index.js';

const SCABBARD_OF_CHALCEDONY = 'td-150' as CardDefinitionId;
/** Smaug's lair — hoard site */
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId;
/** An Orc hazard creature card (only needs to exist for combat finalize routing) */
const ORC_CREATURE = 'tw-074' as CardDefinitionId;

describe('Scabbard of Chalcedony (td-150)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: Hoard-item site restriction ───────────────────────────────────

  test('playable at a hoard site (Lonely Mountain)', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [GANDALF],
      hand: [SCABBARD_OF_CHALCEDONY],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [GANDALF],
      hand: [SCABBARD_OF_CHALCEDONY],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at a haven (Lórien)', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [GANDALF],
      hand: [SCABBARD_OF_CHALCEDONY],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule: Cannot be duplicated on a given character ─────────────────────

  test('second Scabbard of Chalcedony cannot be played on a character who already bears one', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [
        { defId: GANDALF, items: [SCABBARD_OF_CHALCEDONY] },
        ARAGORN,
      ],
      hand: [SCABBARD_OF_CHALCEDONY],
    });

    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 1);

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId
        && ea.viable,
    );
    expect(onGandalf).toBeUndefined();

    const onAragorn = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === aragornId
        && ea.viable,
    );
    expect(onAragorn).toBeDefined();
  });

  test('first Scabbard of Chalcedony is playable on an unburdened bearer', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [GANDALF],
      hand: [SCABBARD_OF_CHALCEDONY],
    });

    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId
        && ea.viable,
    );
    expect(onGandalf).toBeDefined();
  });

  // ─── Rule: -1 body to all failed strikes against bearer ─────────────────

  describe('a failed strike against the bearer lowers the striking creature\'s body check (-1)', () => {
    function creatureBodyCheckState(withItem: boolean): { state: GameState; creatureId: CardInstanceId } {
      let state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: LONELY_MOUNTAIN, characters: [GANDALF] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
      if (withItem) state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF, SCABBARD_OF_CHALCEDONY);
      const creatureId = 'orc-creature-1' as CardInstanceId;
      const creature: CardInPlay = { instanceId: creatureId, definitionId: ORC_CREATURE, status: CardStatus.Untapped };
      state = addP2CardsInPlay(state, [creature]);
      const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
      const combat = makeBodyCheckCombat({
        companyId: companyIdAt(state, RESOURCE_PLAYER),
        characterId: gandalfId,
        attackingPlayerId: PLAYER_2,
        defendingPlayerId: PLAYER_1,
        bodyCheckTarget: 'creature',
        result: 'success', // Gandalf parried this strike — the strike failed
        creatureBody: 8,
        creatureRace: Race.Orc,
        attackSource: { type: 'creature', instanceId: creatureId },
      });
      return { state: { ...state, phaseState: makeShadowMHState(), combat }, creatureId };
    }

    test('with the item, a roll that would otherwise kill the creature instead lets it survive (-1)', () => {
      const { state, creatureId } = creatureBodyCheckState(true);
      // Roll 9 - 1 (item) = 8, matching creature body 8 → not > body → the
      // creature's strike is not defeated, so it survives and is discarded
      // to the attacker's pile (not the defender's kill pile).
      const after = executeAction(state, PLAYER_1, 'body-check-roll', 9);
      expect(after.combat).toBeNull();
      expect(findInPile(after, HAZARD_PLAYER, 'discardPile', creatureId)).toBeDefined();
    });

    test('without the item, the same roll kills the creature (control)', () => {
      const { state, creatureId } = creatureBodyCheckState(false);
      // Roll 9 (no reduction) > creature body 8 → strike defeated, creature
      // moved to the defender's kill pile.
      const after = executeAction(state, PLAYER_1, 'body-check-roll', 9);
      expect(after.combat).toBeNull();
      expect(findInPile(after, RESOURCE_PLAYER, 'killPile', creatureId)).toBeDefined();
    });
  });
});
