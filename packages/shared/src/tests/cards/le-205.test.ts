/**
 * @module le-205.test
 *
 * Card test: Morgul-blade (le-205)
 * Type: minion-resource-event (permanent), alignment ringwraith.
 * Marshalling points: 0.
 *
 * Text:
 *   "Playable on your Ringwraith or a Ringwraith follower. Each strike
 *    against the Ringwraith receives -1 body and -1 prowess. Discard
 *    Morgul-blade after a strike against the Ringwraith fails. Cannot be
 *    duplicated on a given Ringwraith. Cannot be included in a Balrog's
 *    deck."
 *
 * Engine support:
 * | # | Rule                                                     | Status      |
 * |---|-----------------------------------------------------------|-------------|
 * | 1 | Playable on a Ringwraith-race character (avatar/follower) | IMPLEMENTED |
 * | 2 | NOT playable on a non-Ringwraith character                | IMPLEMENTED |
 * | 3 | Cannot be duplicated on a given Ringwraith                | IMPLEMENTED |
 * | 4 | -1 prowess to every strike against the bearer             | IMPLEMENTED |
 * | 5 | -1 body to every strike against the bearer                | IMPLEMENTED |
 * | 6 | Discard after a strike against the bearer fails            | IMPLEMENTED |
 * | 7 | Stays attached after a strike that wounds the bearer       | IMPLEMENTED |
 * | 8 | Cannot be included in a Balrog's deck                      | IMPLEMENTED |
 *
 * "A Ringwraith follower" is, by rule (CoE 2.II.2.1.R4), itself always a
 * Ringwraith-race avatar joining another Ringwraith's company — so a single
 * `target.race === "ringwraith"` play-target filter covers both "your
 * Ringwraith" and "a Ringwraith follower" without extra machinery.
 *
 * Rule 4 ("-1 prowess") is a passive `modify-attack` (`scope: "current-strike"`,
 * `passive: true`): unlike the activated current-strike path (Shield of
 * Iron-bound Ash, Arrows Shorn of Ebony), it applies to every strike against
 * its bearer automatically, added to the defender's own effective prowess
 * for the strike (mathematically identical to reducing the attack's prowess).
 *
 * Rule 5 ("-1 body") reuses the existing `body-check-modifier` `scope:
 * "bearer-combat"` effect (precedent: Flame of Udûn ba-58) gated on
 * `bodyCheck.fromFailedStrike: true` — the creature/attacker body-checks
 * after a strike against the bearer is parried.
 *
 * Rule 6 is a new `on-event: "bearer-strike-defeated"` effect, firing
 * per-strike (not at combat finalization) so a later strike within the same
 * attack no longer benefits from an already-discarded blade.
 *
 * Fixture alignment: minion-resource-event (ringwraith) → minion (LE) site
 * fixtures and a Ringwraith-aligned defending player, per project policy.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase, CardStatus, Alignment,
  buildTestState, buildMinionSitePhaseState, resetMint,
  viableActionsForHandCard,
  findCharInstanceId, getCharacter,
  attachItemToChar, executeAction,
  companyIdAt, addP2CardsInPlay, makeBodyCheckCombat, makeShadowMHState, findInPile,
  makeSingleCharCombatState, pool,
  MINION_RESOURCES_30, HAZARD_CREATURES_12,
} from '../test-helpers.js';
import { Race, validateDeck } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, GameState, DeckList } from '../../index.js';

// ── Local card-ID constants ───────────────────────────────────────────────────

/** Morgul-blade — the card under test */
const MORGUL_BLADE = 'le-205' as CardDefinitionId;
/** Adûnaphel the Ringwraith — a ringwraith-race avatar (prowess 8, body 10, mind null) */
const ADUNAPHEL = 'le-50' as CardDefinitionId;
/** Orc Brawler — a non-Ringwraith minion character (race orc) */
const ORC_BRAWLER = 'le-30' as CardDefinitionId;
/** Minas Morgul (LE) — minion haven */
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
/** Moria (LE) — minion shadow-hold */
const MORIA_MINION = 'le-392' as CardDefinitionId;
/** An Orc hazard creature (only needs to exist in cardsInPlay for finalize) */
const ORC_CREATURE = 'tw-074' as CardDefinitionId;
/** A minion character card, for a Balrog-deck fixture's "characters" slot */
const AZOG = 'ba-2' as CardDefinitionId;

describe('Morgul-blade (le-205)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1 & 2: playable only on a Ringwraith-race character ─────────────

  test('playable on a Ringwraith avatar', () => {
    const state = buildMinionSitePhaseState({
      site: MORIA_MINION, characters: [ADUNAPHEL], hand: [MORGUL_BLADE],
    });
    const actions = viableActionsForHandCard(state, PLAYER_1, 'play-permanent-event', RESOURCE_PLAYER, MORGUL_BLADE);
    expect(actions.length).toBe(1);
    const target = (actions[0].action as { targetCharacterId?: unknown }).targetCharacterId;
    expect(target).toBe(findCharInstanceId(state, RESOURCE_PLAYER, ADUNAPHEL));
  });

  test('NOT playable on a non-Ringwraith character', () => {
    const state = buildMinionSitePhaseState({
      site: MORIA_MINION, characters: [ORC_BRAWLER], hand: [MORGUL_BLADE],
    });
    expect(
      viableActionsForHandCard(state, PLAYER_1, 'play-permanent-event', RESOURCE_PLAYER, MORGUL_BLADE).length,
    ).toBe(0);
  });

  // ── Rule 3: cannot be duplicated on a given Ringwraith ───────────────────

  test('NOT playable a second time on a Ringwraith who already bears one', () => {
    const base = buildMinionSitePhaseState({
      site: MORIA_MINION, characters: [ADUNAPHEL], hand: [MORGUL_BLADE],
    });
    const withBlade = attachItemToChar(base, RESOURCE_PLAYER, ADUNAPHEL, MORGUL_BLADE);
    expect(
      viableActionsForHandCard(withBlade, PLAYER_1, 'play-permanent-event', RESOURCE_PLAYER, MORGUL_BLADE).length,
    ).toBe(0);
  });

  // ── Rules 4, 6 & 7: strike resolution against the bearer ─────────────────

  function morgulBladeStrikeState(opts: { creatureProwess: number; withBlade: boolean }): GameState {
    let state = makeSingleCharCombatState({
      heroDefId: ADUNAPHEL,
      creatureRace: Race.Orc,
      creatureProwess: opts.creatureProwess,
      creatureBody: null,
      alignment: Alignment.Ringwraith,
      site: MORIA_MINION,
      siteDeck: [MINAS_MORGUL],
      preAssigned: true,
    });
    if (opts.withBlade) state = attachItemToChar(state, RESOURCE_PLAYER, ADUNAPHEL, MORGUL_BLADE);
    return state;
  }

  test('the passive -1 prowess turns a losing strike into a tie (no wound)', () => {
    // Adûnaphel prowess 8 (tap = full prowess), creature prowess 11, roll 2 (minimum).
    // Without the blade: 8 + 2 = 10 < 11 -> strike succeeds, Adûnaphel wounded.
    // With the blade: 8 + 1 (passive) + 2 = 11 = 11 -> tie -> ineffectual, no wound.
    const withBlade = morgulBladeStrikeState({ creatureProwess: 11, withBlade: true });
    const after = executeAction(withBlade, PLAYER_1, 'resolve-strike', 2, true);
    expect(after.combat?.bodyCheckTarget).not.toBe('character');
  });

  test('control: without the blade, the same roll wounds Adûnaphel', () => {
    const withoutBlade = morgulBladeStrikeState({ creatureProwess: 11, withBlade: false });
    const after = executeAction(withoutBlade, PLAYER_1, 'resolve-strike', 2, true);
    expect(after.combat?.bodyCheckTarget).toBe('character');
  });

  test('Rule 6: a strike against the bearer that fails discards Morgul-blade', () => {
    // Creature prowess 5, roll 6, tap: 8 + 1 (passive) + 6 = 15 >> 5 -> clearly defeated.
    // creatureBody is null, so no body check follows -- combat finalizes immediately.
    const state = morgulBladeStrikeState({ creatureProwess: 5, withBlade: true });
    const bladeId = getCharacter(state, RESOURCE_PLAYER, ADUNAPHEL).items[0].instanceId;
    const after = executeAction(state, PLAYER_1, 'resolve-strike', 6, true);

    expect(getCharacter(after, RESOURCE_PLAYER, ADUNAPHEL).items).toHaveLength(0);
    expect(findInPile(after, RESOURCE_PLAYER, 'discardPile', bladeId)).toBeDefined();
  });

  test('Rule 7: a strike that wounds the bearer leaves Morgul-blade attached', () => {
    // Creature prowess 20, roll 2: 8 + 1 (passive) + 2 = 11 < 20 -> wounded.
    const state = morgulBladeStrikeState({ creatureProwess: 20, withBlade: true });
    const bladeId = getCharacter(state, RESOURCE_PLAYER, ADUNAPHEL).items[0].instanceId;
    const after = executeAction(state, PLAYER_1, 'resolve-strike', 2, true);

    expect(after.combat?.bodyCheckTarget).toBe('character');
    expect(getCharacter(after, RESOURCE_PLAYER, ADUNAPHEL).items.map(i => i.instanceId)).toContain(bladeId);
  });

  // ── Rule 5: -1 body to a strike against the bearer (creature body check) ─

  describe('a failed strike against the bearer raises the creature body check', () => {
    function creatureBodyCheckState(opts: { withBlade: boolean }): { state: GameState; creatureId: CardInstanceId } {
      let state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [ADUNAPHEL] }], hand: [], siteDeck: [MINAS_MORGUL] },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
      if (opts.withBlade) state = attachItemToChar(state, RESOURCE_PLAYER, ADUNAPHEL, MORGUL_BLADE);
      const creatureId = 'orc-creature-1' as CardInstanceId;
      const creature: CardInPlay = { instanceId: creatureId, definitionId: ORC_CREATURE, status: CardStatus.Untapped };
      state = addP2CardsInPlay(state, [creature]);
      const adunaphelId = findCharInstanceId(state, RESOURCE_PLAYER, ADUNAPHEL);
      const combat = makeBodyCheckCombat({
        companyId: companyIdAt(state, RESOURCE_PLAYER),
        characterId: adunaphelId,
        attackingPlayerId: PLAYER_2,
        defendingPlayerId: PLAYER_1,
        bodyCheckTarget: 'creature',
        result: 'success', // Adûnaphel parried this strike
        creatureBody: 8,
        creatureRace: Race.Orc,
        attackSource: { type: 'creature', instanceId: creatureId },
      });
      return { state: { ...state, phaseState: makeShadowMHState(), combat }, creatureId };
    }

    test('with Morgul-blade, a body-check roll equal to the creature body defeats it (+1)', () => {
      const { state, creatureId } = creatureBodyCheckState({ withBlade: true });
      // Roll 8 + 1 (Morgul-blade) = 9 > creature body 8 -> strike defeated, creature killed.
      // The creature belongs to the attacker, so the defender rolls (CoE 3.I.1).
      const after = executeAction(state, PLAYER_1, 'body-check-roll', 8);
      expect(after.combat).toBeNull();
      expect(findInPile(after, HAZARD_PLAYER, 'discardPile', creatureId)).toBeUndefined();
    });

    test('without Morgul-blade, the same roll leaves the creature alive (control)', () => {
      const { state, creatureId } = creatureBodyCheckState({ withBlade: false });
      // Roll 8 = creature body 8 (no +1) -> not > body -> creature survives, discarded.
      const after = executeAction(state, PLAYER_1, 'body-check-roll', 8);
      expect(after.combat).toBeNull();
      expect(findInPile(after, HAZARD_PLAYER, 'discardPile', creatureId)).toBeDefined();
    });
  });

  // ── Rule 8: cannot be included in a Balrog's deck ────────────────────────

  test('a Balrog deck containing Morgul-blade is rejected by deck validation', () => {
    const deck: DeckList = {
      id: 'test-balrog-morgul-blade',
      name: 'Balrog Morgul-blade',
      alignment: 'balrog',
      pool: [],
      sideboard: [],
      sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
      deck: {
        characters: [{ name: 'Azog', card: AZOG, qty: 1 }],
        hazards: [...HAZARD_CREATURES_12],
        resources: [...MINION_RESOURCES_30, { name: 'Morgul-blade', card: MORGUL_BLADE, qty: 1 }],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.card === MORGUL_BLADE)).toBe(true);
  });

  test('is not excluded from a Ringwraith deck', () => {
    const deck: DeckList = {
      id: 'test-ringwraith-morgul-blade',
      name: 'Ringwraith Morgul-blade',
      alignment: 'minion',
      pool: [],
      sideboard: [],
      sites: [{ name: 'Minas Morgul', card: MINAS_MORGUL, qty: 1 }],
      deck: {
        characters: [{ name: 'Adûnaphel the Ringwraith', card: ADUNAPHEL, qty: 1 }],
        hazards: [...HAZARD_CREATURES_12],
        resources: [...MINION_RESOURCES_30, { name: 'Morgul-blade', card: MORGUL_BLADE, qty: 1 }],
      },
    };
    const bannedErrors = validateDeck(deck, pool)
      .filter(e => e.card === MORGUL_BLADE && e.message.includes('not allowed'));
    expect(bannedErrors).toHaveLength(0);
  });
});
