/**
 * @module ba-69.test
 *
 * Card test: Obey Him or Die (ba-69)
 * Type: minion-resource-event (permanent) — Balrog specific
 * Alignment: ringwraith (Balrog specific)
 *
 * Text:
 *   "Balrog specific. Playable during the organization phase on a leader in
 *    The Balrog's company. The leader receives +2 direct influence and cannot
 *    be discarded by a body check. Discard whenever there is a character in his
 *    company with a higher mind. Cannot be duplicated on a given character."
 *
 * This is the Balrog-specific sibling of By the Ringwraith's Word (le-174):
 * the same attach-to-a-leader package (direct-influence boost + body-check
 * discard immunity + higher-mind auto-discard), but keyed to a leader already
 * in The Balrog's company (not "becomes a leader"), a +2 (not +4) boost, and a
 * per-character (not per-player) duplication limit.
 *
 * Engine Support:
 * | # | Rule                                                            | Status      |
 * |---|-----------------------------------------------------------------|-------------|
 * | 1 | Playable in the org phase only on a leader (printed keyword)    | IMPLEMENTED |
 * | 2 | Target's company must contain The Balrog                        | IMPLEMENTED |
 * | 3 | Bearer receives +2 direct influence                             | IMPLEMENTED |
 * | 4 | Bearer's body-check discard number is suppressed (not elim.)    | IMPLEMENTED |
 * | 5 | Auto-discard while a company-mate has a higher mind than bearer | IMPLEMENTED |
 * | 6 | Cannot be duplicated on a given character (per-character limit)  | IMPLEMENTED |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint,
  viableActions,
  findCharInstanceId, findHandCardId,
  playPermanentEventAndResolve,
  getItemsOn,
  dispatch, companyIdAt, recomputeDerived,
  makeShadowMHState, makeBodyCheckCombat, setCharStatus,
  CardStatus,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import { Phase, Alignment } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Obey Him or Die — the card under test */
const OBEY_HIM_OR_DIE = 'ba-69' as CardDefinitionId;
/** The Balrog — the avatar whose company the card keys to (ba-3, mind=null) */
const THE_BALROG = 'ba-3' as CardDefinitionId;
/** Gorbag — Orc leader, mind=6, body=9, DI=0, discardBodyCheck=[9] (le-11) */
const GORBAG = 'le-11' as CardDefinitionId;
/** Shagrat — Orc leader, mind=6, body=9, DI=0, discardBodyCheck=[9] (le-39) */
const SHAGRAT = 'le-39' as CardDefinitionId;
/** Azog — Orc leader, mind=7 (higher than Gorbag), body=9 (ba-2) */
const AZOG = 'ba-2' as CardDefinitionId;
/** Grishnákh — Orc WITHOUT the leader keyword, mind=3 (le-12) */
const GRISHNAKH = 'le-12' as CardDefinitionId;
/** Barad-dûr — a Balrog dark-hold site (ba-84) */
const BARAD_DUR = 'ba-84' as CardDefinitionId;

describe('Obey Him or Die (ba-69)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1 & 2: Playability ────────────────────────────────────────────────

  test('playable in the org phase on a leader in The Balrog\'s company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR, characters: [THE_BALROG, GORBAG] }],
          hand: [OBEY_HIM_OR_DIE],
          siteDeck: [BARAD_DUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [BARAD_DUR], playDeck: makePlayDeck() },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    // Only Gorbag is a leader; The Balrog (keyword "spawn") is not offered.
    expect(actions.length).toBe(1);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    expect((actions[0].action as { targetCharacterId?: unknown }).targetCharacterId).toBe(gorbagId);
  });

  test('NOT playable outside the organization phase ("Playable during the organization phase")', () => {
    // Regression: the card declared no phase gate, so the permanent-event
    // emitter offered it in every resource-play window (movement/hazard,
    // site, end-of-turn) despite the printed restriction.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR, characters: [THE_BALROG, GORBAG] }],
          hand: [OBEY_HIM_OR_DIE],
          siteDeck: [BARAD_DUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [BARAD_DUR], playDeck: makePlayDeck() },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable on a non-leader character in The Balrog\'s company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR, characters: [THE_BALROG, GRISHNAKH] }],
          hand: [OBEY_HIM_OR_DIE],
          siteDeck: [BARAD_DUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [BARAD_DUR], playDeck: makePlayDeck() },
      ],
    });
    // Grishnákh lacks the leader keyword → no valid target.
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable on a leader whose company does not contain The Balrog', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR, characters: [GORBAG, SHAGRAT] }],
          hand: [OBEY_HIM_OR_DIE],
          siteDeck: [BARAD_DUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [BARAD_DUR], playDeck: makePlayDeck() },
      ],
    });
    // Two leaders present, but The Balrog is not in the company → company-context fails.
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('when played, the card attaches to the target leader as an item', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR, characters: [THE_BALROG, GORBAG] }],
          hand: [OBEY_HIM_OR_DIE],
          siteDeck: [BARAD_DUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [BARAD_DUR], playDeck: makePlayDeck() },
      ],
    });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, OBEY_HIM_OR_DIE);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, gorbagId);
    expect(getItemsOn(after, RESOURCE_PLAYER, GORBAG).some(i => i.definitionId === OBEY_HIM_OR_DIE)).toBe(true);
  });

  // ── Rule 6: Per-character duplication limit ────────────────────────────────

  test('cannot be duplicated on a given character (but may key another leader)', () => {
    // Gorbag and Shagrat both mind=6 → no higher-mind auto-discard after play.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR, characters: [THE_BALROG, GORBAG, SHAGRAT] }],
          hand: [OBEY_HIM_OR_DIE, OBEY_HIM_OR_DIE],
          siteDeck: [BARAD_DUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [BARAD_DUR], playDeck: makePlayDeck() },
      ],
    });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, OBEY_HIM_OR_DIE);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const afterFirst = playPermanentEventAndResolve(state, PLAYER_1, cardId, gorbagId);
    // First copy stayed on Gorbag (no company-mate has a higher mind).
    expect(getItemsOn(afterFirst, RESOURCE_PLAYER, GORBAG).some(i => i.definitionId === OBEY_HIM_OR_DIE)).toBe(true);

    const shagratId = findCharInstanceId(afterFirst, RESOURCE_PLAYER, SHAGRAT);
    const remaining = viableActions(afterFirst, PLAYER_1, 'play-permanent-event');
    const targets = remaining.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);
    // Second copy: not offered on Gorbag (dup limit), still offered on Shagrat.
    expect(targets).not.toContain(gorbagId);
    expect(targets).toContain(shagratId);
  });

  // ── Rule 3: +2 direct influence ────────────────────────────────────────────

  test('while attached, the bearer gets +2 direct influence', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR, characters: [THE_BALROG, { defId: GORBAG, items: [OBEY_HIM_OR_DIE] }] }],
          hand: [],
          siteDeck: [BARAD_DUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [BARAD_DUR], playDeck: makePlayDeck() },
      ],
    });
    const withCard = recomputeDerived(state);
    // Gorbag base DI = 0 → +2 with the card.
    expect(withCard.players[0].characters[
      findCharInstanceId(withCard, RESOURCE_PLAYER, GORBAG)
    ].effectiveStats.directInfluence).toBe(2);
  });

  test('without the card, the bearer has base direct influence', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR, characters: [THE_BALROG, GORBAG] }],
          hand: [],
          siteDeck: [BARAD_DUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [BARAD_DUR], playDeck: makePlayDeck() },
      ],
    });
    const withoutCard = recomputeDerived(state);
    expect(withoutCard.players[0].characters[
      findCharInstanceId(withoutCard, RESOURCE_PLAYER, GORBAG)
    ].effectiveStats.directInfluence).toBe(0);
  });

  // ── Rule 4: Cannot be discarded by a body check ────────────────────────────
  //
  // Gorbag has discardBodyCheck: [9] — an (unmodified) body-check roll of 9
  // sends him to the discard pile. Obey Him or Die suppresses that discard
  // (leaving him wounded) but does NOT protect against elimination (roll > body).

  test('a body check matching the discard number does not discard the bearer while attached', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR, characters: [THE_BALROG, { defId: GORBAG, items: [OBEY_HIM_OR_DIE] }] }],
          hand: [],
          siteDeck: [BARAD_DUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [BARAD_DUR], playDeck: makePlayDeck() },
      ],
    });
    const gorbagId = findCharInstanceId(base, RESOURCE_PLAYER, GORBAG);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const wounded = setCharStatus(base, RESOURCE_PLAYER, GORBAG, CardStatus.Inverted);
    const readyState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: gorbagId }),
      cheatRollTotal: 9, // roll 9 ∈ discardBodyCheck → would normally discard
    };
    const afterCheck = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 9, explanation: 'test' });
    // With the card: discard suppressed → Gorbag remains in play, not discarded.
    expect(afterCheck.players[0].characters[gorbagId]).toBeDefined();
    expect(afterCheck.players[0].discardPile.some(c => c.definitionId === GORBAG)).toBe(false);
    expect(afterCheck.players[0].outOfPlayPile.some(c => c.definitionId === GORBAG)).toBe(false);
  });

  test('without the card, a body check matching the discard number discards the bearer', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR, characters: [THE_BALROG, GORBAG] }],
          hand: [],
          siteDeck: [BARAD_DUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [BARAD_DUR], playDeck: makePlayDeck() },
      ],
    });
    const gorbagId = findCharInstanceId(base, RESOURCE_PLAYER, GORBAG);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const wounded = setCharStatus(base, RESOURCE_PLAYER, GORBAG, CardStatus.Inverted);
    const readyState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: gorbagId }),
      cheatRollTotal: 9,
    };
    const afterCheck = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 9, explanation: 'test' });
    // Without the card: Gorbag is discarded (not eliminated).
    expect(afterCheck.players[0].characters[gorbagId]).toBeUndefined();
    expect(afterCheck.players[0].discardPile.some(c => c.definitionId === GORBAG)).toBe(true);
    expect(afterCheck.players[0].outOfPlayPile.some(c => c.definitionId === GORBAG)).toBe(false);
  });

  test('with the card attached, a body check roll above body still eliminates the bearer', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR, characters: [THE_BALROG, { defId: GORBAG, items: [OBEY_HIM_OR_DIE] }] }],
          hand: [],
          siteDeck: [BARAD_DUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [BARAD_DUR], playDeck: makePlayDeck() },
      ],
    });
    const gorbagId = findCharInstanceId(base, RESOURCE_PLAYER, GORBAG);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const wounded = setCharStatus(base, RESOURCE_PLAYER, GORBAG, CardStatus.Inverted);
    const readyState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: gorbagId }),
      cheatRollTotal: 12, // roll 12 > body 9 (and ∉ discardBodyCheck) → eliminated even with card
    };
    const afterCheck = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 12, explanation: 'test' });
    // The card protects only from the discard number, not from elimination.
    expect(afterCheck.players[0].characters[gorbagId]).toBeUndefined();
    expect(afterCheck.players[0].outOfPlayPile.some(c => c.definitionId === GORBAG)).toBe(true);
  });

  // ── Rule 5: Auto-discard when a company-mate has a higher mind ──────────────

  test('the card auto-discards immediately when played into a company with a higher-mind member', () => {
    // Azog (mind=7) is already in the company; playing on Gorbag (mind=6) discards at once.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR, characters: [THE_BALROG, GORBAG, AZOG] }],
          hand: [OBEY_HIM_OR_DIE],
          siteDeck: [BARAD_DUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [BARAD_DUR], playDeck: makePlayDeck() },
      ],
    });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, OBEY_HIM_OR_DIE);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, gorbagId);
    // Azog (mind 7) > Gorbag (mind 6) → sweepAutoDiscardResourceEvents discards the card.
    expect(getItemsOn(after, RESOURCE_PLAYER, GORBAG).some(i => i.definitionId === OBEY_HIM_OR_DIE)).toBe(false);
    expect(after.players[0].discardPile.some(c => c.definitionId === OBEY_HIM_OR_DIE)).toBe(true);
  });

  test('the card stays in play while no company-mate has a higher mind than the bearer', () => {
    // Shagrat (mind=6) equals Gorbag (mind=6); The Balrog has no mind → no discard.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR, characters: [THE_BALROG, GORBAG, SHAGRAT] }],
          hand: [OBEY_HIM_OR_DIE],
          siteDeck: [BARAD_DUR],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [BARAD_DUR], playDeck: makePlayDeck() },
      ],
    });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, OBEY_HIM_OR_DIE);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, gorbagId);
    expect(getItemsOn(after, RESOURCE_PLAYER, GORBAG).some(i => i.definitionId === OBEY_HIM_OR_DIE)).toBe(true);
    expect(after.players[0].discardPile.some(c => c.definitionId === OBEY_HIM_OR_DIE)).toBe(false);
  });
});
