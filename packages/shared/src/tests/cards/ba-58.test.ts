/**
 * @module ba-58.test
 *
 * Card test: Flame of Udûn (ba-58)
 * Type: minion-resource-event (permanent), keywords "Balrog specific", "Demon fána".
 * Alignment: Balrog specific. Marshalling points: 0.
 *
 * Text:
 *   "Balrog specific. Demon fána. Playable during your organization phase on The
 *    Balrog. Return this card to your hand: when you play another Demon fána
 *    card, or, if you choose, during your organization phase. Discard his allies.
 *    No other characters or allies can be in his company outside of the
 *    organization phase. +3 prowess; -2 direct influence. +1 to all body checks
 *    resulting from failed strikes against The Balrog. If The Balrog attacks
 *    successfully in company vs. company combat, +1 to defending character's body
 *    check."
 *
 * Engine support:
 * | # | Rule                                                          | Status      |
 * |---|--------------------------------------------------------------|-------------|
 * | 1 | Playable only on The Balrog, during organization phase       | IMPLEMENTED |
 * | 2 | On-play: bounce another Demon fána card on the Balrog to hand| IMPLEMENTED |
 * | 3 | Return-to-hand grant-action, free, during organization phase | IMPLEMENTED |
 * | 4 | On-play: discard the Balrog's allies                         | IMPLEMENTED |
 * | 5 | No ally may be in his company (no-allies-in-company flag)     | IMPLEMENTED |
 * | 6 | +3 prowess; -2 direct influence                              | IMPLEMENTED |
 * | 7 | +1 to body checks from failed strikes against The Balrog     | IMPLEMENTED |
 * | 8 | CvCC: Balrog attacks successfully → +1 defender body check    | IMPLEMENTED |
 *
 * Rules 7 & 8 are `body-check-modifier` `scope: 'bearer-combat'` effects: the
 * relevant bearer for a `creature`/`attacker-character` body check (a strike
 * against the parrying character failed) is the parrying defender, and for a
 * `character` body check in CvCC the successful attacker.
 *
 * "No other characters ... in his company outside of the organization phase" —
 * characters only join a company during the organization phase (character play,
 * company reorganization), which the card explicitly permits, so the character
 * clause is satisfied by the engine's phase structure; the enforceable, novel
 * restriction is the ally clause (rules 4 & 5).
 *
 * Fixture alignment: Balrog-specific minion card → Balrog-alignment fixtures
 * (The Balrog ba-3, Great Shadow ba-62, Great Troll ba-46, Under-galleries
 * ba-99, Barad-dûr ba-84) plus hero fixtures for the CvCC body-check target.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase, CardStatus, Alignment,
  GIMLI,
  buildTestState, buildMinionSitePhaseState, resetMint,
  viableActions, viableActionsForHandCard, dispatch, executeAction,
  findCharInstanceId, findHandCardId, getCharacter,
  attachItemToChar, attachAllyToChar, playPermanentEventAndResolve, grantedActionsFor,
  companyIdAt, addP2CardsInPlay, makeBodyCheckCombat, makeShadowMHState, findInPile,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, GameState } from '../../index.js';
import { Race } from '../../index.js';

// ── Local card-ID constants ───────────────────────────────────────────────────

/** Flame of Udûn — the card under test */
const FLAME_OF_UDUN = 'ba-58' as CardDefinitionId;
/** The Balrog — Balrog avatar (prowess 8, body 11, direct influence 6, mind null) */
const THE_BALROG = 'ba-3' as CardDefinitionId;
/** Great Shadow — another Demon fána card (for the swap-return rule) */
const GREAT_SHADOW = 'ba-62' as CardDefinitionId;
/** Crook-legged Orc — Balrog-specific non-unique minion (a non-Balrog character) */
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;
/** Great Troll — Balrog-playable Under-deeps ally */
const GREAT_TROLL = 'ba-46' as CardDefinitionId;
/** Barad-dûr (BA) — dark-hold, surface (non-under-deeps) */
const BARAD_DUR_BA = 'ba-84' as CardDefinitionId;
/** The Under-galleries (BA) — dark-hold, under-deeps (Great Troll is playable here) */
const UNDER_GALLERIES = 'ba-99' as CardDefinitionId;
/** An Orc hazard creature (only needs to exist in cardsInPlay for finalize) */
const ORC_CREATURE = 'tw-074' as CardDefinitionId;

// ── State builders ────────────────────────────────────────────────────────────

function orgState(opts: {
  companyChars?: CardDefinitionId[];
  hand?: CardDefinitionId[];
  site?: CardDefinitionId;
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Balrog,
        companies: [{ site: opts.site ?? BARAD_DUR_BA, characters: opts.companyChars ?? [THE_BALROG] }],
        hand: opts.hand ?? [FLAME_OF_UDUN],
        siteDeck: [],
      },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
    ],
  });
}

describe('Flame of Udûn (ba-58)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playable only on The Balrog ──────────────────────────────────

  test('playable on The Balrog during the organization phase', () => {
    const state = orgState({});
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const target = (actions[0].action as { targetCharacterId?: unknown }).targetCharacterId;
    expect(target).toBe(findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG));
  });

  test('NOT playable on a non-Balrog character', () => {
    const state = orgState({ companyChars: [CROOK_LEGGED_ORC] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 2: On-play bounce of another Demon fána card ────────────────────

  test('bounces an existing Demon fána card on the Balrog back to hand when played', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    // Pre-existing Demon fána (Great Shadow) already on the Balrog.
    const withShadow = attachItemToChar(base, RESOURCE_PLAYER, THE_BALROG, GREAT_SHADOW);
    expect(getCharacter(withShadow, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(1);
    const cardId = findHandCardId(withShadow, RESOURCE_PLAYER, FLAME_OF_UDUN);
    const after = playPermanentEventAndResolve(withShadow, PLAYER_1, cardId, balrogId);
    // Only the newly played Flame of Udûn remains attached; Great Shadow bounced.
    const items = getCharacter(after, RESOURCE_PLAYER, THE_BALROG).items;
    expect(items).toHaveLength(1);
    expect(items[0].definitionId).toBe(FLAME_OF_UDUN);
    expect(after.players[RESOURCE_PLAYER].hand.map(c => c.definitionId)).toContain(GREAT_SHADOW);
  });

  test('does not bounce anything when the Balrog has no other Demon fána card', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, FLAME_OF_UDUN);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
  });

  // ── Rule 3: Return-to-hand grant-action ──────────────────────────────────

  test('return-self-to-hand grant-action moves the card from Balrog items back to hand', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, FLAME_OF_UDUN);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    const returnActions = grantedActionsFor(attached, balrogId, 'return-self-to-hand', PLAYER_1);
    expect(returnActions.length).toBe(1);
    const after = dispatch(attached, returnActions[0]);
    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).items).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].hand.map(c => c.definitionId)).toEqual([FLAME_OF_UDUN]);
  });

  // ── Rule 4: On-play, discard the Balrog's allies ─────────────────────────

  test('discards the Balrog\'s allies when it enters play', () => {
    const base = orgState({ site: UNDER_GALLERIES });
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, THE_BALROG, GREAT_TROLL);
    const allyId = getCharacter(withAlly, RESOURCE_PLAYER, THE_BALROG).allies[0].instanceId;
    expect(getCharacter(withAlly, RESOURCE_PLAYER, THE_BALROG).allies).toHaveLength(1);

    const cardId = findHandCardId(withAlly, RESOURCE_PLAYER, FLAME_OF_UDUN);
    const after = playPermanentEventAndResolve(withAlly, PLAYER_1, cardId, balrogId);
    // The ally is gone from the Balrog and sits in the owner's discard pile.
    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).allies).toHaveLength(0);
    expect(findInPile(after, RESOURCE_PLAYER, 'discardPile', allyId)).toBeDefined();
  });

  // ── Rule 5: No ally may be in his company (site phase) ────────────────────

  test('a Balrog-playable ally is offered when Flame of Udûn is NOT attached', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [GREAT_TROLL],
    });
    expect(
      viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, GREAT_TROLL).length,
    ).toBeGreaterThanOrEqual(1);
  });

  test('no ally may be played to the Balrog\'s company while Flame of Udûn is attached', () => {
    const base = buildMinionSitePhaseState({
      site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [GREAT_TROLL],
    });
    const withFlame = attachItemToChar(base, RESOURCE_PLAYER, THE_BALROG, FLAME_OF_UDUN);
    expect(
      viableActionsForHandCard(withFlame, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, GREAT_TROLL),
    ).toHaveLength(0);
  });

  // ── Rule 6: +3 prowess; -2 direct influence ──────────────────────────────

  test('+3 prowess and -2 direct influence applied to the Balrog while attached', () => {
    const base = orgState({});
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, FLAME_OF_UDUN);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, balrogId);
    const basePool = base.cardPool[THE_BALROG] as { prowess: number; directInfluence: number };
    const balrog = getCharacter(after, RESOURCE_PLAYER, THE_BALROG);
    expect(balrog.effectiveStats.prowess).toBe(basePool.prowess + 3);
    expect(balrog.effectiveStats.directInfluence).toBe(basePool.directInfluence - 2);
  });

  // ── Rule 7: +1 to body checks from failed strikes against The Balrog ─────

  describe('failed strike against The Balrog raises the creature body check', () => {
    function creatureBodyCheckState(opts: { withFlame: boolean }): { state: GameState; creatureId: CardInstanceId } {
      let state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: BARAD_DUR_BA, characters: [THE_BALROG] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
      if (opts.withFlame) state = attachItemToChar(state, RESOURCE_PLAYER, THE_BALROG, FLAME_OF_UDUN);
      const creatureId = 'orc-creature-1' as CardInstanceId;
      const creature: CardInPlay = { instanceId: creatureId, definitionId: ORC_CREATURE, status: CardStatus.Untapped };
      state = addP2CardsInPlay(state, [creature]);
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const combat = makeBodyCheckCombat({
        companyId: companyIdAt(state, RESOURCE_PLAYER),
        characterId: balrogId,
        attackingPlayerId: PLAYER_2,
        defendingPlayerId: PLAYER_1,
        bodyCheckTarget: 'creature',
        result: 'success', // the Balrog parried this strike
        creatureBody: 8,
        creatureRace: Race.Orc,
        attackSource: { type: 'creature', instanceId: creatureId },
      });
      return { state: { ...state, phaseState: makeShadowMHState(), combat }, creatureId };
    }

    test('with Flame of Udûn, a body-check roll equal to the creature body defeats it (+1)', () => {
      const { state, creatureId } = creatureBodyCheckState({ withFlame: true });
      // Roll 8 + 1 (Flame) = 9 > creature body 8 → strike defeated, creature killed.
      // A Balrog defender's non-starred kill is routed to out-of-play (rule 8.22),
      // so the defeated creature leaves the hazard player's play/discard entirely.
      // The creature belongs to the attacker, so the defender rolls (CoE 3.I.1).
      const after = executeAction(state, PLAYER_1, 'body-check-roll', 8);
      expect(after.combat).toBeNull();
      expect(findInPile(after, RESOURCE_PLAYER, 'outOfPlayPile', creatureId)).toBeDefined();
      expect(findInPile(after, HAZARD_PLAYER, 'discardPile', creatureId)).toBeUndefined();
    });

    test('without Flame of Udûn, the same roll leaves the creature alive (control)', () => {
      const { state, creatureId } = creatureBodyCheckState({ withFlame: false });
      // Roll 8 = creature body 8 (no +1) → not > body → creature survives, discarded.
      // The creature belongs to the attacker, so the defender rolls (CoE 3.I.1).
      const after = executeAction(state, PLAYER_1, 'body-check-roll', 8);
      expect(after.combat).toBeNull();
      expect(findInPile(after, RESOURCE_PLAYER, 'killPile', creatureId)).toBeUndefined();
      expect(findInPile(after, HAZARD_PLAYER, 'discardPile', creatureId)).toBeDefined();
    });
  });

  // ── Rule 8: CvCC — Balrog attacks successfully → +1 defender body check ──

  describe('CvCC: Balrog attacking successfully raises the defending character body check', () => {
    function cvccState(opts: { withFlame: boolean }): { state: GameState; gimliId: CardInstanceId } {
      let state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        // The character body check reads `effectiveStats.body`, which only a
        // recomputed state carries.
        recompute: true,
        players: [
          { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: BARAD_DUR_BA, characters: [THE_BALROG] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARAD_DUR_BA, characters: [GIMLI] }], hand: [], siteDeck: [] },
        ],
      });
      if (opts.withFlame) state = attachItemToChar(state, RESOURCE_PLAYER, THE_BALROG, FLAME_OF_UDUN);
      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const gimliId = findCharInstanceId(state, HAZARD_PLAYER, GIMLI);
      const combat = makeBodyCheckCombat({
        companyId: companyIdAt(state, HAZARD_PLAYER),
        characterId: gimliId,             // the wounded defending character
        attackingPlayerId: PLAYER_1,      // the Balrog attacks
        defendingPlayerId: PLAYER_2,
        bodyCheckTarget: 'character',
        isCvCC: true,
        attackingCharacterId: balrogId,
        attackSource: { type: 'company-attack', attackingCompanyId: companyIdAt(state, RESOURCE_PLAYER) },
      });
      return { state: { ...state, phaseState: makeShadowMHState(), combat }, gimliId };
    }

    test('with Flame of Udûn, a body-check roll equal to the defender body eliminates him (+1)', () => {
      const { state, gimliId } = cvccState({ withFlame: true });
      // Gimli body 8; roll 8 + 1 (Flame) = 9 > 8 → eliminated.
      const after = executeAction(state, PLAYER_1, 'body-check-roll', 8);
      expect(after.players[HAZARD_PLAYER].characters[gimliId]).toBeUndefined();
    });

    test('without Flame of Udûn, the same roll leaves the defender in play (control)', () => {
      const { state, gimliId } = cvccState({ withFlame: false });
      // Roll 8 = body 8 (no +1) → not > body → Gimli survives the body check.
      const after = executeAction(state, PLAYER_1, 'body-check-roll', 8);
      expect(after.players[HAZARD_PLAYER].characters[gimliId]).toBeDefined();
    });
  });
});
