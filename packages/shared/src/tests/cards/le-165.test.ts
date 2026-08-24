/**
 * @module le-165.test
 *
 * Card test: Awaiting the Call (le-165)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 *
 * Text:
 *   "Playable during the organization phase on a character with a mind of 6
 *    or less at a non-Darkhaven. For the purposes of controlling this
 *    character, his mind is halved (round down). Discard this card when the
 *    character moves. Cannot be duplicated on a given character."
 *
 * Engine support:
 * | # | Rule                                                  | Status      |
 * |---|-------------------------------------------------------|-------------|
 * | 0 | Playable only during the organization phase (play-condition phase) | IMPLEMENTED |
 * | 1 | Org-phase, on a character with mind ≤ 6 (play-target) | IMPLEMENTED |
 * | 2 | Only at a non-Darkhaven (play-condition site-type)    | IMPLEMENTED |
 * | 3 | Bearer's mind halved, round down (stat-modifier)      | IMPLEMENTED |
 * | 4 | Discard when the character moves (bearer-company-moves)| IMPLEMENTED |
 * | 5 | Cannot be duplicated on a given character (dup-limit)  | IMPLEMENTED |
 *
 * Mind-halving is consumed by `recomputeDerived` as the character's
 * general-influence control cost (the "controlling" calculation), exactly as
 * for the certified troll-triplet mind reductions (as-1/as-5/as-6).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  Phase, CardStatus,
  buildTestState, makePlayDeck, resetMint,
  viableActions,
  findCharInstanceId, findHandCardId,
  playPermanentEventAndResolve,
  makeMHState,
  dispatch,
  getCharacter,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Awaiting the Call — the card under test */
const AWAITING_THE_CALL = 'le-165' as CardDefinitionId;
/** Calendal (le-4) — minion character, mind 6 (even → halves to 3) */
const CALENDAL = 'le-4' as CardDefinitionId;
/** Asternak (le-1) — minion character, mind 5 (odd → halves to 2, round down) */
const ASTERNAK = 'le-1' as CardDefinitionId;
/** The Mouth (le-24) — minion character, mind 9 (> 6, ineligible) */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Ettenmoors (le-373) — a minion ruins-and-lairs site (non-Darkhaven) */
const ETTENMOORS = 'le-373' as CardDefinitionId;
/** Dol Guldur (le-367) — a minion haven (a Darkhaven) */
const DOL_GULDUR = 'le-367' as CardDefinitionId;

// ── Builder ──────────────────────────────────────────────────────────────────

function orgState(opts: {
  character?: CardDefinitionId;
  site?: CardDefinitionId;
  hand?: CardDefinitionId[];
}) {
  const character = opts.character ?? CALENDAL;
  const site = opts.site ?? ETTENMOORS;
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site, characters: [character] }],
        hand: opts.hand ?? [AWAITING_THE_CALL],
        siteDeck: [ETTENMOORS],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
        hand: [],
        siteDeck: [DOL_GULDUR],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

describe('Awaiting the Call (le-165)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playable on a mind ≤ 6 character at a non-Darkhaven ────────────

  test('playable during organization on a mind-6 character at a non-Darkhaven', () => {
    const state = orgState({ character: CALENDAL, site: ETTENMOORS });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const action = actions[0].action as { targetCharacterId?: unknown };
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, CALENDAL);
    expect(action.targetCharacterId).toBe(charId);
  });

  test('NOT playable on a character whose mind exceeds 6 (The Mouth, mind 9)', () => {
    const state = orgState({ character: THE_MOUTH, site: ETTENMOORS });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('NOT playable outside the organization phase (end-of-turn)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: ETTENMOORS, characters: [CALENDAL] }],
          hand: [AWAITING_THE_CALL],
          siteDeck: [ETTENMOORS],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rule 2: Only at a non-Darkhaven ───────────────────────────────────────

  test('NOT playable when the company is at a Darkhaven (haven site)', () => {
    const state = orgState({ character: CALENDAL, site: DOL_GULDUR });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rule 3: Mind halved, round down ───────────────────────────────────────

  test('halves an even mind: Calendal (mind 6) becomes effective mind 3', () => {
    const base = orgState({ character: CALENDAL });
    const charId = findCharInstanceId(base, RESOURCE_PLAYER, CALENDAL);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, AWAITING_THE_CALL);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, charId);
    expect(getCharacter(after, RESOURCE_PLAYER, CALENDAL).effectiveStats.mind).toBe(3);
  });

  test('halves an odd mind rounding down: Asternak (mind 5) becomes effective mind 2', () => {
    const base = orgState({ character: ASTERNAK });
    const charId = findCharInstanceId(base, RESOURCE_PLAYER, ASTERNAK);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, AWAITING_THE_CALL);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, charId);
    expect(getCharacter(after, RESOURCE_PLAYER, ASTERNAK).effectiveStats.mind).toBe(2);
  });

  test('without the card, no effective-mind override is set', () => {
    const base = orgState({ character: CALENDAL });
    expect(getCharacter(base, RESOURCE_PLAYER, CALENDAL).effectiveStats.mind).toBeUndefined();
  });

  test('halved mind lowers the general-influence cost of controlling the character', () => {
    const base = orgState({ character: CALENDAL });
    // Before: Calendal costs its full mind (6) of general influence.
    expect(base.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(6);
    const charId = findCharInstanceId(base, RESOURCE_PLAYER, CALENDAL);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, AWAITING_THE_CALL);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, charId);
    // After: control cost is the halved mind (3).
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(3);
  });

  // ── Rule 4: Discard when the character moves ──────────────────────────────

  test('auto-discards when the bearer company moves', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: ETTENMOORS,
            characters: [{ defId: CALENDAL, items: [AWAITING_THE_CALL] }],
          }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    // Set a destination so the company actually moves.
    const destCard = base.players[0].siteDeck[0];
    const withDest = {
      ...base,
      players: [
        {
          ...base.players[0],
          companies: [{
            ...base.players[0].companies[0],
            destinationSite: { instanceId: destCard.instanceId, definitionId: destCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        base.players[1],
      ] as typeof base.players,
    };
    const stateAtMH = { ...withDest, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const charId = findCharInstanceId(stateAtMH, RESOURCE_PLAYER, CALENDAL);
    expect(getCharacter(stateAtMH, RESOURCE_PLAYER, CALENDAL).items.some(i => i.definitionId === AWAITING_THE_CALL)).toBe(true);

    // Both players pass → M/H completes and the company moves.
    const afterResourcePass = dispatch(stateAtMH, { type: 'pass', player: PLAYER_1 });
    const afterHazardPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const charAfter = afterHazardPass.players[RESOURCE_PLAYER].characters[charId];
    expect(charAfter.items.some(i => i.definitionId === AWAITING_THE_CALL)).toBe(false);
    expect(afterHazardPass.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === AWAITING_THE_CALL)).toBe(true);
  });

  // ── Rule 5: Cannot be duplicated on a given character ──────────────────────

  test('a second copy cannot be played on a character that already bears one', () => {
    const base = orgState({ character: CALENDAL, hand: [AWAITING_THE_CALL, AWAITING_THE_CALL] });
    const charId = findCharInstanceId(base, RESOURCE_PLAYER, CALENDAL);
    const firstCardId = findHandCardId(base, RESOURCE_PLAYER, AWAITING_THE_CALL);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, firstCardId, charId);
    const actions = viableActions(attached, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('a copy is still playable on a different eligible character', () => {
    // Two eligible characters in one company; one already bears the card.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: ETTENMOORS, characters: [CALENDAL, ASTERNAK] }],
          hand: [AWAITING_THE_CALL, AWAITING_THE_CALL],
          siteDeck: [ETTENMOORS],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const calendalId = findCharInstanceId(base, RESOURCE_PLAYER, CALENDAL);
    const firstCardId = findHandCardId(base, RESOURCE_PLAYER, AWAITING_THE_CALL);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, firstCardId, calendalId);
    // The remaining copy must still target Asternak (but not Calendal again).
    const asternakId = findCharInstanceId(attached, RESOURCE_PLAYER, ASTERNAK);
    const actions = viableActions(attached, PLAYER_1, 'play-permanent-event');
    const targets = actions.map(a => (a.action as { targetCharacterId?: unknown }).targetCharacterId);
    expect(targets).toContain(asternakId);
    expect(targets).not.toContain(calendalId);
  });
});
