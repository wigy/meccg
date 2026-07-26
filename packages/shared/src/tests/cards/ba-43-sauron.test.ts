/**
 * @module ba-43-sauron.test
 *
 * Card test: Sauron (ba-43)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 *
 * Text:
 *   "Manifestation of The Lidless Eye. Playable if your opponent is a Wizard
 *    and you have not revealed a Ringwraith. You are Sauron, not a Ringwraith.
 *    You may not reveal a Ringwraith or play Ringwraith followers. +10 to your
 *    general influence. Discards and prevents the subsequent play of Bade to
 *    Rule. During your organization phase, you may bring a resource or
 *    character from your sideboard into your play deck and shuffle and there
 *    is no limit to the number of characters you may bring into play. Cannot
 *    be duplicated. Cannot be included in a Balrog's/Fallen-wizard's deck."
 *
 * The sibling manifestation of The Lidless Eye (le-203): a bare general
 * permanent-event marking its controller as *Sauron* (`play-as-sauron`),
 * granting +10 bare general influence, discarding/preventing Bade to Rule
 * (`discard-named-in-play` + le-167's `card-not-in-play: "Sauron"`), and
 * granting the once-per-organization-phase sideboard fetch
 * (`sauron-sideboard-fetch`, no peek mode on this manifestation). Its unique
 * addition is the `no-character-play-limit` marker, which lifts the
 * one-character-play-per-turn limit while in play. Manifestation exclusivity
 * (glossary g.man.1) is mutual `card-not-in-play` conditions between ba-43 and
 * le-203.
 *
 * Engine Support:
 * | #  | Rule                                                     | Status      |
 * |----|----------------------------------------------------------|-------------|
 * | 1  | Playable if opponent Wizard and no Ringwraith revealed   | IMPLEMENTED |
 * | 2  | Manifestation of The Lidless Eye (mutual exclusion)      | IMPLEMENTED |
 * | 3  | +10 general influence                                    | IMPLEMENTED |
 * | 4  | You are Sauron — may not reveal a Ringwraith             | IMPLEMENTED |
 * | 5  | You are Sauron — may not play Ringwraith followers       | IMPLEMENTED |
 * | 6  | Discards Bade to Rule on entering play                   | IMPLEMENTED |
 * | 7  | Prevents subsequent play of Bade to Rule                 | IMPLEMENTED |
 * | 8  | Org phase: fetch a sideboard resource/char to deck       | IMPLEMENTED |
 * | 9  | No limit to the number of characters brought into play   | IMPLEMENTED |
 * | 10 | Cannot be duplicated (game scope)                        | IMPLEMENTED |
 * | 11 | Cannot be included in a Balrog's/Fallen-wizard's deck    | IMPLEMENTED |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint, mint,
  viableActions,
  findHandCardId,
  attachItemToChar,
  playPermanentEventAndResolve,
  dispatch,
  getCharacter,
  addP1CardsInPlay,
  recomputeDerived,
  pool, HERO_RESOURCES_30, HAZARD_CREATURES_12,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus, Alignment, validateDeck } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, DeckList, GameState, PlayerId } from '../../index.js';
import type { OrganizationPhaseState } from '../../types/state-phases.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Sauron — the card under test */
const SAURON = 'ba-43' as CardDefinitionId;
/** The Lidless Eye — the other manifestation of Sauron (le-203) */
const LIDLESS_EYE = 'le-203' as CardDefinitionId;
/** Bade to Rule — discarded/prevented by Sauron (le-167) */
const BADE_TO_RULE = 'le-167' as CardDefinitionId;
/** Adûnaphel the Ringwraith — a ringwraith-race avatar (mind null) (le-50) */
const ADUNAPHEL = 'le-50' as CardDefinitionId;
/** The Witch-king — a ringwraith avatar granting two follower slots (le-58) */
const WITCH_KING = 'le-58' as CardDefinitionId;
/** The Mouth — a non-avatar minion character, race man (le-24) */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Orc Brawler — a non-unique minion character, mind 1 (le-30) */
const ORC_BRAWLER = 'le-30' as CardDefinitionId;
/** Morgul-blade — a minion resource used as a sideboard fetch target (le-205) */
const MORGUL_BLADE = 'le-205' as CardDefinitionId;
/** Dol Guldur — a minion haven site / Darkhaven (le-367) */
const DOL_GULDUR = 'le-367' as CardDefinitionId;

/** A bare general permanent-event card-in-play entry for the Sauron player. */
function sauronInPlay(definitionId: CardDefinitionId = SAURON) {
  return { instanceId: mint(), definitionId, status: CardStatus.Untapped };
}

/**
 * Minion (Ringwraith) player at Dol Guldur during their organization phase,
 * facing a Wizard opponent. Player 1 (resource) is the Sauron/minion side.
 */
function minionOrgState(opts: {
  p1Characters?: CardDefinitionId[];
  hand?: CardDefinitionId[];
  sideboard?: CardDefinitionId[];
} = {}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: opts.p1Characters ?? [THE_MOUTH] }],
        hand: opts.hand ?? [],
        siteDeck: [DOL_GULDUR],
        playDeck: makePlayDeck(),
        sideboard: opts.sideboard ?? [],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
        hand: [],
        siteDeck: [DOL_GULDUR],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

/** All play-character actions (viable or not) targeting a specific hand instance. */
function playCharacterFor(state: GameState, playerId: PlayerId, charInstanceId: CardInstanceId) {
  return computeLegalActions(state, playerId).filter(
    ea => ea.action.type === 'play-character'
      && (ea.action as { characterInstanceId?: unknown }).characterInstanceId === charInstanceId,
  );
}

/** Viable play-permanent-event actions for a specific hand instance. */
function playEventFor(state: GameState, playerId: PlayerId, cardInstanceId: CardInstanceId) {
  return viableActions(state, playerId, 'play-permanent-event').filter(
    ea => (ea.action as { cardInstanceId?: unknown }).cardInstanceId === cardInstanceId,
  );
}

describe('Sauron (ba-43)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playability ──────────────────────────────────────────────────

  test('playable when opponent is a Wizard and no Ringwraith is revealed', () => {
    const state = minionOrgState({ hand: [SAURON], p1Characters: [THE_MOUTH] });
    const plays = playEventFor(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, SAURON));
    expect(plays.length).toBe(1);
  });

  test('NOT playable when the player has revealed a Ringwraith avatar', () => {
    // Adûnaphel (a Ringwraith avatar) is in the player's company → hasRingwraithInPlay.
    const state = minionOrgState({ hand: [SAURON], p1Characters: [ADUNAPHEL] });
    const plays = playEventFor(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, SAURON));
    expect(plays.length).toBe(0);
  });

  // ── Rule 2: Manifestation of The Lidless Eye ─────────────────────────────

  test('NOT playable while The Lidless Eye is in play (manifestation exclusion)', () => {
    const base = minionOrgState({ hand: [SAURON], p1Characters: [THE_MOUTH] });
    const withEye = addP1CardsInPlay(base, [sauronInPlay(LIDLESS_EYE)]);
    const plays = playEventFor(withEye, PLAYER_1, findHandCardId(withEye, RESOURCE_PLAYER, SAURON));
    expect(plays.length).toBe(0);
  });

  test('The Lidless Eye is NOT playable while Sauron is in play (mirror exclusion)', () => {
    const base = minionOrgState({ hand: [LIDLESS_EYE], p1Characters: [THE_MOUTH] });
    const withSauron = addP1CardsInPlay(base, [sauronInPlay()]);
    const plays = playEventFor(withSauron, PLAYER_1, findHandCardId(withSauron, RESOURCE_PLAYER, LIDLESS_EYE));
    expect(plays.length).toBe(0);
  });

  // ── Rule 3: +10 general influence ────────────────────────────────────────

  test('grants +10 general influence while in play', () => {
    const base = minionOrgState({ p1Characters: [THE_MOUTH] });
    const withSauron = recomputeDerived(addP1CardsInPlay(base, [sauronInPlay()]));
    expect(withSauron.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(10);
  });

  // ── Rule 4: You are Sauron — may not reveal a Ringwraith ─────────────────

  test('blocks revealing a Ringwraith avatar while Sauron is in play', () => {
    const base = minionOrgState({ hand: [ADUNAPHEL], p1Characters: [THE_MOUTH] });
    const adunaphelHandId = findHandCardId(base, RESOURCE_PLAYER, ADUNAPHEL);

    // Without Sauron, revealing Adûnaphel is a viable avatar play.
    const before = playCharacterFor(base, PLAYER_1, adunaphelHandId);
    expect(before.some(ea => ea.viable)).toBe(true);

    // With Sauron in play, the reveal is offered but non-viable.
    const withSauron = addP1CardsInPlay(base, [sauronInPlay()]);
    const after = playCharacterFor(withSauron, PLAYER_1, adunaphelHandId);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every(ea => !ea.viable)).toBe(true);
    expect(after[0].reason).toMatch(/Sauron/i);
  });

  // ── Rule 5: You are Sauron — may not play Ringwraith followers ───────────

  test('blocks playing a Ringwraith follower while Sauron is in play', () => {
    // The Witch-king (revealed avatar, 2 follower slots) + a second Ringwraith in hand.
    const base = minionOrgState({ hand: [ADUNAPHEL], p1Characters: [WITCH_KING] });
    const followerHandId = findHandCardId(base, RESOURCE_PLAYER, ADUNAPHEL);

    // Without Sauron, Adûnaphel is a viable Ringwraith follower of the Witch-king.
    const before = playCharacterFor(base, PLAYER_1, followerHandId);
    expect(before.some(ea => ea.viable)).toBe(true);

    // With Sauron in play, no viable follower play.
    const withSauron = addP1CardsInPlay(base, [sauronInPlay()]);
    const after = playCharacterFor(withSauron, PLAYER_1, followerHandId);
    expect(after.some(ea => ea.viable)).toBe(false);
    expect(after.length).toBeGreaterThan(0);
    expect(after[0].reason).toMatch(/Sauron/i);
  });

  // ── Rule 6: Discards Bade to Rule on entering play ───────────────────────

  test('discards an in-play Bade to Rule when it enters play', () => {
    // Bade to Rule attached to a Ringwraith; play Sauron into play.
    const base = minionOrgState({ hand: [SAURON], p1Characters: [ADUNAPHEL] });
    const withBade = attachItemToChar(base, RESOURCE_PLAYER, ADUNAPHEL, BADE_TO_RULE);
    expect(getCharacter(withBade, RESOURCE_PLAYER, ADUNAPHEL).items.length).toBe(1);

    const sauronHandId = findHandCardId(withBade, RESOURCE_PLAYER, SAURON);
    const after = playPermanentEventAndResolve(withBade, PLAYER_1, sauronHandId);

    // Bade to Rule is gone from the character and now in the owner's discard pile.
    expect(getCharacter(after, RESOURCE_PLAYER, ADUNAPHEL).items.length).toBe(0);
    const discard = after.players[RESOURCE_PLAYER].discardPile;
    expect(discard.some(c => c.definitionId === BADE_TO_RULE)).toBe(true);
    // Sauron itself is in play.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SAURON)).toBe(true);
  });

  // ── Rule 7: Prevents subsequent play of Bade to Rule ─────────────────────

  test('prevents playing Bade to Rule while Sauron is in play', () => {
    const base = minionOrgState({ hand: [BADE_TO_RULE], p1Characters: [ADUNAPHEL] });
    const withSauron = addP1CardsInPlay(base, [sauronInPlay()]);
    const plays = playEventFor(withSauron, PLAYER_1, findHandCardId(withSauron, RESOURCE_PLAYER, BADE_TO_RULE));
    expect(plays.length).toBe(0);
  });

  // ── Rule 8: Org phase — sideboard fetch ──────────────────────────────────

  test('offers a once-per-org-phase sideboard fetch that moves the card to the play deck', () => {
    const base = minionOrgState({
      p1Characters: [THE_MOUTH],
      sideboard: [MORGUL_BLADE],
    });
    const withSauron = addP1CardsInPlay(base, [sauronInPlay()]);

    const fetches = viableActions(withSauron, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as { actionId?: string }).actionId === 'sauron-sideboard-fetch',
    );
    expect(fetches.length).toBe(1);
    const sbInstanceId = withSauron.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    expect((fetches[0].action as { targetCardId?: unknown }).targetCardId).toBe(sbInstanceId);

    const deckBefore = withSauron.players[RESOURCE_PLAYER].playDeck.length;
    const after = dispatch(withSauron, fetches[0].action);

    expect(after.players[RESOURCE_PLAYER].sideboard.some(c => c.instanceId === sbInstanceId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].playDeck.some(c => c.instanceId === sbInstanceId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].playDeck.length).toBe(deckBefore + 1);
    expect((after.phaseState as OrganizationPhaseState).sauronOrgActionUsed).toBe(true);

    // Used up for the rest of this organization phase.
    const again = viableActions(after, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as { actionId?: string }).actionId === 'sauron-sideboard-fetch',
    );
    expect(again.length).toBe(0);
  });

  // ── Rule 9: No limit to the number of characters brought into play ───────

  test('lifts the one-character-per-turn play limit while in play', () => {
    // A character was already played this turn (characterPlayedThisTurn=true);
    // a non-unique minion (Orc Brawler) waits in hand.
    const base = minionOrgState({ hand: [ORC_BRAWLER], p1Characters: [THE_MOUTH] });
    const played: GameState = {
      ...base,
      phaseState: {
        ...(base.phaseState as OrganizationPhaseState),
        characterPlayedThisTurn: true,
      } as OrganizationPhaseState,
    };
    const brawlerHandId = findHandCardId(played, RESOURCE_PLAYER, ORC_BRAWLER);

    // Without Sauron, the second character play is blocked by the per-turn limit.
    const before = playCharacterFor(played, PLAYER_1, brawlerHandId);
    expect(before.some(ea => ea.viable)).toBe(false);
    expect(before.length).toBeGreaterThan(0);
    expect(before[0].reason).toMatch(/already played a character/i);

    // With Sauron in play, the limit is lifted — the play is viable again.
    const withSauron = addP1CardsInPlay(played, [sauronInPlay()]);
    const after = playCharacterFor(withSauron, PLAYER_1, brawlerHandId);
    expect(after.some(ea => ea.viable)).toBe(true);
  });

  // ── Rule 10: Cannot be duplicated ────────────────────────────────────────

  test('a second copy cannot be played while one is already in play', () => {
    const base = minionOrgState({ hand: [SAURON], p1Characters: [THE_MOUTH] });
    const withSauron = addP1CardsInPlay(base, [sauronInPlay()]);
    const plays = playEventFor(withSauron, PLAYER_1, findHandCardId(withSauron, RESOURCE_PLAYER, SAURON));
    expect(plays.length).toBe(0);
  });

  // ── Rule 11: Cannot be included in a Balrog's/Fallen-wizard's deck ───────

  test('deck validation rejects Sauron in a Fallen-wizard deck', () => {
    const deck: DeckList = {
      id: 'test-fw-sauron',
      name: 'FW Sauron Ban Test',
      alignment: 'fallen-wizard',
      pool: [],
      sideboard: [],
      sites: [{ name: 'The White Towers', card: 'wh-58' as CardDefinitionId, qty: 1 }],
      deck: {
        characters: [{ name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 1 }],
        hazards: [...HAZARD_CREATURES_12],
        resources: [...HERO_RESOURCES_30, { name: 'Sauron', card: SAURON, qty: 1 }],
      },
    };
    expect(validateDeck(deck, pool).some(e => e.card === SAURON)).toBe(true);
  });

  test('deck validation rejects Sauron in a Balrog deck', () => {
    const deck: DeckList = {
      id: 'test-balrog-sauron',
      name: 'Balrog Sauron Ban Test',
      alignment: 'balrog',
      pool: [],
      sideboard: [],
      sites: [{ name: 'The Under-galleries', card: 'ba-99' as CardDefinitionId, qty: 1 }],
      deck: {
        characters: [{ name: 'Orc Brawler', card: ORC_BRAWLER, qty: 1 }],
        hazards: [...HAZARD_CREATURES_12],
        resources: [...HERO_RESOURCES_30, { name: 'Sauron', card: SAURON, qty: 1 }],
      },
    };
    expect(validateDeck(deck, pool).some(e => e.card === SAURON)).toBe(true);
  });
});
