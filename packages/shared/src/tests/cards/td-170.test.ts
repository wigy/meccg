/**
 * @module td-170.test
 *
 * Card test: Wizard's Staff (td-170)
 * Type: hero-resource-item (greater, hoard, weapon)
 *
 * Printed text:
 *   "Hoard item. Weapon. Only a Wizard may bear this item. +2 to direct
 *    influence and +2 to prowess. +2 to any corruption check required by
 *    a spell card. Tap bearer at the beginning of your end-of-turn phase
 *    to take one 'spell,' 'ritual,' or 'light enchantment' from your
 *    discard pile into your hand. Bearer makes corruption check. Cannot
 *    be duplicated on a given Wizard."
 *
 * Effects (data):
 *   1. item-play-site — playable only at sites with the "hoard" keyword
 *   2. play-target (character) — bearer must be a Wizard
 *   3. stat-modifier — +2 prowess
 *   4. stat-modifier — +2 direct-influence
 *   5. check-modifier — +2 to corruption checks whose triggering source
 *      card has the "spell" keyword
 *   6. grant-action "wizards-staff-fetch" — end-of-turn: tap bearer,
 *      move one spell/ritual/light-enchantment card from the player's
 *      discard pile into hand, then enqueue a corruption check on the
 *      bearer
 *   7. duplication-limit (character, max 1) — cannot be duplicated on
 *      a given Wizard
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus,
  GANDALF, SARUMAN, ARAGORN, LEGOLAS,
  WIZARDS_LAUGHTER, MARVELS_TOLD, GLAMDRING,
  LORIEN, MORIA, MINAS_TIRITH,
  resetMint,
  buildTestState, buildSitePhaseState,
  viableActions,
  dispatch,
  charIdAt,
  getCharacter,
  baseProwess,
  pool,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { enqueueResolution } from '../../engine/pending.js';
import { computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId,
  CharacterCard,
  ActivateGrantedAction,
  CorruptionCheckAction,
} from '../../index.js';

const WIZARDS_STAFF = 'td-170' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // Smaug's Lair (hoard site)
// wh-34 Promptings of Wisdom carries the "light-enchantment" keyword.
const PROMPTINGS_OF_WISDOM = 'wh-34' as CardDefinitionId;

describe('Wizard’s Staff (td-170)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: Hoard-item site restriction ────────────────────────────────

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

  // ─── Rule 2: "Only a Wizard may bear this item" ─────────────────────────

  test('playable on a Wizard (Gandalf)', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [GANDALF],
      hand: [WIZARDS_STAFF],
    });

    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId,
    );
    expect(onGandalf).toBeDefined();
  });

  test('NOT playable on a non-Wizard (Aragorn)', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [ARAGORN],
      hand: [WIZARDS_STAFF],
    });

    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onAragorn = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === aragornId,
    );
    expect(onAragorn).toBeUndefined();
  });

  test('mixed company: only offered on the Wizard, not the non-Wizard', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [GANDALF, ARAGORN],
      hand: [WIZARDS_STAFF],
    });
    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 1);

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const bearerIds = plays
      .filter(ea => ea.action.type === 'play-hero-resource')
      .map(ea => (ea.action as { attachToCharacterId: string }).attachToCharacterId);

    expect(bearerIds).toContain(gandalfId);
    expect(bearerIds).not.toContain(aragornId);
  });

  // ─── Rule 3: +2 prowess to bearer ───────────────────────────────────────

  test('bearer gets +2 effective prowess', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: GANDALF, items: [WIZARDS_STAFF] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const gandalf = getCharacter(state, RESOURCE_PLAYER, GANDALF);
    expect(gandalf.effectiveStats.prowess).toBe(baseProwess(GANDALF) + 2);
  });

  test('without Wizard’s Staff bearer prowess is the base value', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [GANDALF] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const gandalf = getCharacter(state, RESOURCE_PLAYER, GANDALF);
    expect(gandalf.effectiveStats.prowess).toBe(baseProwess(GANDALF));
  });

  // ─── Rule 4: +2 direct influence to bearer ──────────────────────────────

  test('bearer gets +2 effective direct influence', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: GANDALF, items: [WIZARDS_STAFF] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const gandalfDef = pool[GANDALF as string] as CharacterCard;
    const gandalf = getCharacter(state, RESOURCE_PLAYER, GANDALF);
    expect(gandalf.effectiveStats.directInfluence).toBe(gandalfDef.directInfluence + 2);
  });

  // ─── Rule 5: +2 to corruption check required by a spell card ────────────

  test('+2 modifier to a corruption check whose source card has "spell" keyword', () => {
    // Use Saruman (corruptionModifier: 0) so the staff's contribution shows
    // up cleanly as +2 in the final modifier without a character-baseline.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: SARUMAN, items: [WIZARDS_STAFF] }] }],
          hand: [],
          // Put a spell card in the discard pile so we can use its instance
          // as the resolution's `source`. Its physical location is
          // irrelevant to the check-modifier lookup.
          discardPile: [WIZARDS_LAUGHTER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sarumanId = charIdAt(base, RESOURCE_PLAYER, 0, 0);
    const spellInstanceId = base.players[RESOURCE_PLAYER].discardPile[0].instanceId;

    const withCheck = enqueueResolution(base, {
      source: spellInstanceId,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: {
        type: 'corruption-check',
        characterId: sarumanId,
        modifier: 0,
        reason: 'Wizard’s Laughter',
        possessions: [],
        transferredItemId: null,
      },
    });

    const actions = computeLegalActions(withCheck, PLAYER_1)
      .filter(ea => ea.action.type === 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction);
    expect(actions).toHaveLength(1);
    // Saruman's built-in corruption modifier is 0; the staff adds +2 for
    // spell-sourced checks.
    expect(actions[0].corruptionModifier).toBe(2);
  });

  test('NO extra modifier when the check source is not a spell card', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: SARUMAN, items: [WIZARDS_STAFF] }] }],
          hand: [],
          // Glamdring has no "spell" keyword.
          discardPile: [GLAMDRING],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sarumanId = charIdAt(base, RESOURCE_PLAYER, 0, 0);
    const nonSpellInstanceId = base.players[RESOURCE_PLAYER].discardPile[0].instanceId;

    const withCheck = enqueueResolution(base, {
      source: nonSpellInstanceId,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: {
        type: 'corruption-check',
        characterId: sarumanId,
        modifier: 0,
        reason: 'Transfer',
        possessions: [],
        transferredItemId: null,
      },
    });

    const actions = computeLegalActions(withCheck, PLAYER_1)
      .filter(ea => ea.action.type === 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction);
    expect(actions).toHaveLength(1);
    expect(actions[0].corruptionModifier).toBe(0);
  });

  // ─── Rule 6: End-of-turn fetch grant-action ─────────────────────────────

  test('grant-action offered during end-of-turn with a spell in discard', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: GANDALF, items: [WIZARDS_STAFF] }] }],
          hand: [],
          discardPile: [WIZARDS_LAUGHTER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const fetchActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'wizards-staff-fetch',
    );
    expect(fetchActions).toHaveLength(1);
    expect((fetchActions[0].action as ActivateGrantedAction).targetCardId).toBeDefined();
  });

  test('grant-action matches spell, ritual, AND light-enchantment keywords', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: GANDALF, items: [WIZARDS_STAFF] }] }],
          hand: [],
          // WIZARDS_LAUGHTER = spell, MARVELS_TOLD = ritual,
          // PROMPTINGS_OF_WISDOM = light-enchantment, GLAMDRING = none of these.
          discardPile: [WIZARDS_LAUGHTER, MARVELS_TOLD, PROMPTINGS_OF_WISDOM, GLAMDRING],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const fetchActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'wizards-staff-fetch',
    );
    // One action per eligible discard card (3: spell, ritual, light-enchantment).
    expect(fetchActions).toHaveLength(3);

    const targetedDefIds = fetchActions.map(ea => {
      const tid = (ea.action as ActivateGrantedAction).targetCardId!;
      return state.players[RESOURCE_PLAYER].discardPile.find(c => c.instanceId === tid)!.definitionId;
    });
    expect(targetedDefIds).toContain(WIZARDS_LAUGHTER);
    expect(targetedDefIds).toContain(MARVELS_TOLD);
    expect(targetedDefIds).toContain(PROMPTINGS_OF_WISDOM);
    expect(targetedDefIds).not.toContain(GLAMDRING);
  });

  test('grant-action NOT offered when no matching card is in discard', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: GANDALF, items: [WIZARDS_STAFF] }] }],
          hand: [],
          discardPile: [GLAMDRING],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const fetchActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'wizards-staff-fetch',
    );
    expect(fetchActions).toHaveLength(0);
  });

  test('grant-action NOT offered when bearer is tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: GANDALF, items: [WIZARDS_STAFF], status: CardStatus.Tapped }] }],
          hand: [],
          discardPile: [WIZARDS_LAUGHTER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const fetchActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'wizards-staff-fetch',
    );
    expect(fetchActions).toHaveLength(0);
  });

  test('grant-action NOT offered to the non-active player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: SARUMAN, items: [WIZARDS_STAFF] }] }],
          hand: [],
          discardPile: [WIZARDS_LAUGHTER],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_2, 'activate-granted-action');
    const fetchActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'wizards-staff-fetch',
    );
    expect(fetchActions).toHaveLength(0);
  });

  test('activating taps the bearer, moves target to hand, enqueues corruption check', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: GANDALF, items: [WIZARDS_STAFF] }] }],
          hand: [],
          discardPile: [WIZARDS_LAUGHTER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const spellInstanceId = state.players[RESOURCE_PLAYER].discardPile[0].instanceId;

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const fetchAction = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'wizards-staff-fetch',
    )!;
    expect(fetchAction).toBeDefined();

    const after = dispatch(state, fetchAction.action);

    // Gandalf (bearer) is tapped.
    expect(getCharacter(after, RESOURCE_PLAYER, GANDALF).status).toBe(CardStatus.Tapped);

    // Staff is still attached; only the bearer tapped, not the item itself.
    const gandalfItems = getCharacter(after, RESOURCE_PLAYER, GANDALF).items;
    expect(gandalfItems).toHaveLength(1);
    expect(gandalfItems[0].definitionId).toBe(WIZARDS_STAFF);
    expect(gandalfItems[0].status).toBe(CardStatus.Untapped);

    // Spell moved from discard to hand.
    expect(after.players[RESOURCE_PLAYER].discardPile).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].hand[0].instanceId).toBe(spellInstanceId);
    expect(after.players[RESOURCE_PLAYER].hand[0].definitionId).toBe(WIZARDS_LAUGHTER);

    // Corruption check enqueued on the bearer.
    expect(after.pendingResolutions).toHaveLength(1);
    const pending = after.pendingResolutions[0];
    expect(pending.kind.type).toBe('corruption-check');
    if (pending.kind.type === 'corruption-check') {
      expect(pending.kind.characterId).toBe(gandalfId);
    }
    expect(pending.actor).toBe(PLAYER_1);
  });

  // ─── Rule 7: Duplication limit (one copy per Wizard) ────────────────────

  test('second copy NOT playable on the same Wizard already bearing one', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [{ defId: GANDALF, items: [WIZARDS_STAFF] }],
      hand: [WIZARDS_STAFF],
    });

    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId,
    );
    expect(onGandalf).toBeUndefined();
  });

  test('second copy IS playable on a different Wizard at the same site', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [
        { defId: GANDALF, items: [WIZARDS_STAFF] },
        SARUMAN,
      ],
      hand: [WIZARDS_STAFF],
    });

    const sarumanId = charIdAt(state, RESOURCE_PLAYER, 0, 1);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onSaruman = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === sarumanId,
    );
    expect(onSaruman).toBeDefined();
  });
});
