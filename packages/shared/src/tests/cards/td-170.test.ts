/**
 * @module td-170.test
 *
 * Card test: Wizard's Staff (td-170)
 * Type: hero-resource-item (greater, hoard)
 *
 * Printed text:
 *   "Hoard item. Weapon. Only a Wizard may bear this item. +2 to direct
 *    influence and +2 to prowess. +2 to any corruption check required by
 *    a spell card. Tap bearer at the beginning of your end-of-turn phase
 *    to take one 'spell,' 'ritual,' or 'light enchantment' from your
 *    discard pile into your hand. Bearer makes corruption check. Cannot
 *    be duplicated on a given Wizard."
 *
 * Rule coverage (see PR description for the full NOT CERTIFIED rationale):
 *
 * | # | Rule                                            | Status              |
 * |---|-------------------------------------------------|---------------------|
 * | 1 | Hoard item — playable only at hoard sites       | IMPLEMENTED (test)  |
 * | 2 | +2 prowess to bearer                            | IMPLEMENTED (test)  |
 * | 3 | +2 direct influence to bearer                   | IMPLEMENTED (test)  |
 * | 4 | Cannot be duplicated on a given character       | IMPLEMENTED (test)  |
 * | 5 | Only a Wizard may bear this item                | NOT IMPLEMENTED     |
 * | 6 | +2 corruption check required by a spell card    | NOT IMPLEMENTED     |
 * | 7 | End-of-turn tap to fetch spell/ritual/light-    | NOT IMPLEMENTED     |
 * |   | enchantment from discard; bearer corruption     |                     |
 * |   | check                                           |                     |
 *
 * Rules 5–7 require new engine work (bearer race restriction on items,
 * triggering-card keyword context on corruption-check resolutions, and an
 * item-sourced end-of-turn `grant-action` with a multi-keyword discard
 * fetch + post-corruption check). Until those land, the card cannot be
 * fully certified.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  GANDALF, SARUMAN, ARAGORN, LEGOLAS,
  MORIA, LORIEN, MINAS_TIRITH,
  resetMint,
  buildSitePhaseState, buildTestState,
  viableActions,
  getCharacter,
  baseProwess,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';
import { Phase } from '../../index.js';
import { pool } from '../test-helpers.js';

const WIZARDS_STAFF = 'td-170' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // Smaug's lair, hoard site

describe('Wizard’s Staff (td-170)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: Hoard-item site restriction ─────────────────────────────────

  test('playable at a hoard site (Lonely Mountain)', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [GANDALF],
      hand: [WIZARDS_STAFF],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [GANDALF],
      hand: [WIZARDS_STAFF],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at a haven (Lórien)', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [GANDALF],
      hand: [WIZARDS_STAFF],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule 2: +2 prowess bonus to bearer ──────────────────────────────────

  test('bearer gets +2 effective prowess', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: GANDALF, items: [WIZARDS_STAFF] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
      recompute: true,
    });

    const gandalf = getCharacter(state, RESOURCE_PLAYER, GANDALF);
    expect(gandalf.effectiveStats.prowess).toBe(baseProwess(GANDALF) + 2);
  });

  test('without Wizard’s Staff bearer prowess is the base value', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [GANDALF] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
      recompute: true,
    });

    const gandalf = getCharacter(state, RESOURCE_PLAYER, GANDALF);
    expect(gandalf.effectiveStats.prowess).toBe(baseProwess(GANDALF));
  });

  // ─── Rule 3: +2 direct influence to bearer ───────────────────────────────

  test('bearer gets +2 effective direct influence', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: GANDALF, items: [WIZARDS_STAFF] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
      recompute: true,
    });

    const gandalfDef = pool[GANDALF as string] as CharacterCard;
    const gandalf = getCharacter(state, RESOURCE_PLAYER, GANDALF);
    expect(gandalf.effectiveStats.directInfluence).toBe(gandalfDef.directInfluence + 2);
  });

  // ─── Rule 4: Duplication limit (one per character) ───────────────────────

  test('second Wizard’s Staff cannot be played on the same bearer', () => {
    // Gandalf already bears one Wizard's Staff; a second copy in hand must
    // not be offered as an attachment to Gandalf. A different character
    // (Saruman) at the same site may still receive the second copy.
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [
        { defId: GANDALF, items: [WIZARDS_STAFF] },
        SARUMAN,
      ],
      hand: [WIZARDS_STAFF],
    });

    const gandalfId = Object.values(state.players[0].characters)
      .find(c => c.definitionId === GANDALF)!.instanceId;
    const sarumanId = Object.values(state.players[0].characters)
      .find(c => c.definitionId === SARUMAN)!.instanceId;

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');

    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId,
    );
    expect(onGandalf).toBeUndefined();

    const onSaruman = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === sarumanId,
    );
    expect(onSaruman).toBeDefined();
  });

  test('first copy of Wizard’s Staff is playable on an unburdened bearer', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [GANDALF],
      hand: [WIZARDS_STAFF],
    });

    const gandalfId = Object.values(state.players[0].characters)
      .find(c => c.definitionId === GANDALF)!.instanceId;

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId,
    );
    expect(onGandalf).toBeDefined();
  });

  // ─── NOT-YET-IMPLEMENTED rules: document the gap with a negative test ───

  // Rule 5: "Only a Wizard may bear this item." The engine does not yet
  // enforce bearer-race restrictions on items. Until that lands, Wizard's
  // Staff can be attached to a non-Wizard bearer. This test documents the
  // current (incorrect) behavior so that a future fix for the bearer
  // restriction flips this assertion.
  test('known gap: Wizard’s Staff currently attaches to non-wizard bearers', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [ARAGORN], // man / dunadan, not a wizard
      hand: [WIZARDS_STAFF],
    });

    const aragornId = Object.values(state.players[0].characters)
      .find(c => c.definitionId === ARAGORN)!.instanceId;

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onAragorn = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === aragornId,
    );
    // TODO: when bearer-race restriction is implemented, this should be
    // `toBeUndefined()`.
    expect(onAragorn).toBeDefined();
  });
});
