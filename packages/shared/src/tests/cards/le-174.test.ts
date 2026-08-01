/**
 * @module le-174.test
 *
 * Card test: By the Ringwraith's Word (le-174)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 *
 * Text:
 *   "Playable during the organization phase on one of your other characters
 *    at the same Darkhaven [{DH}] as your Ringwraith. The character: becomes
 *    a leader (if not already), receives +4 direct influence against
 *    characters in his company, and cannot be discarded by a body check.
 *    Discard at any time if there is a character in his company with a
 *    higher mind. Cannot be duplicated by a given player. Cannot be included
 *    in a Balrog's deck."
 *
 * Engine Support:
 * | # | Rule                                                           | Status      |
 * |---|----------------------------------------------------------------|-------------|
 * | 1 | Playable during organization phase on non-Ringwraith character | IMPLEMENTED |
 * | 2 | Playability gated on target being at same Darkhaven as the    | IMPLEMENTED |
 * |   | controller's Ringwraith                                        |             |
 * | 3 | Target character becomes a leader (if not already)             | IMPLEMENTED |
 * | 4 | +4 direct influence for the bearer against characters in his  | IMPLEMENTED |
 * |   | own company                                                    |             |
 * | 5 | Bearer's discardBodyCheck is suppressed (not elimination)      | IMPLEMENTED |
 * | 6 | Auto-discard while a character in bearer's company has a       | IMPLEMENTED |
 * |   | higher mind than the bearer                                    |             |
 * | 7 | Cannot be duplicated by a given player (per-player copy limit) | IMPLEMENTED |
 * | 8 | Cannot be included in a Balrog's deck (deck construction)      | OUT OF SCOPE |
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

/** By the Ringwraith's Word — the card under test */
const BY_THE_RINGWRAITHS_WORD = 'le-174' as CardDefinitionId;
/** Adûnaphel the Ringwraith — a ringwraith-race character (le-50) */
const ADUNAPHEL = 'le-50' as CardDefinitionId;
/** The Mouth — a non-ringwraith minion character (le-24), mind=9, body=8, DI=4 */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Ciryaher — a non-ringwraith minion character (le-6), mind=5 */
const CIRYAHER = 'le-6' as CardDefinitionId;
/** Grishnákh — Orc character without Leader keyword (le-12), mind=3, DI=0 */
const GRISHNAKH = 'le-12' as CardDefinitionId;
/** Gorbag — Orc character WITH Leader keyword (le-11), mind=6 */
const GORBAG = 'le-11' as CardDefinitionId;
/** Dol Guldur — a minion haven site (le-367) */
const DOL_GULDUR = 'le-367' as CardDefinitionId;
/** Ettenmoors — a minion ruins-and-lairs site (not a haven) */
const ETTENMOORS = 'le-373' as CardDefinitionId;
/** Hoarmurath the Ringwraith — a second ringwraith for player 2 (le-53) */
const HOARMURATH = 'le-53' as CardDefinitionId;

// ── Builder ──────────────────────────────────────────────────────────────────

function orgStateAtHaven(opts: {
  targetSite?: CardDefinitionId;
  targetChars?: CardDefinitionId[];
  hand?: CardDefinitionId[];
  cardsInPlay?: import('../../index.js').CardInPlay[];
}) {
  const targetSite = opts.targetSite ?? DOL_GULDUR;
  const targetChars = opts.targetChars ?? [THE_MOUTH];
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [
          { site: DOL_GULDUR, characters: [ADUNAPHEL] },
          { site: targetSite, characters: targetChars },
        ],
        hand: opts.hand ?? [BY_THE_RINGWRAITHS_WORD],
        siteDeck: [DOL_GULDUR],
        playDeck: makePlayDeck(),
        cardsInPlay: opts.cardsInPlay ?? [],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
        hand: [],
        siteDeck: [DOL_GULDUR],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

describe('By the Ringwraith\'s Word (le-174)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1 & 2: Playability ───────────────────────────────────────────────

  test('playable during organization phase on a non-Ringwraith character at a Darkhaven', () => {
    const state = orgStateAtHaven({ targetChars: [THE_MOUTH] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const mouthId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);
    const action = actions[0].action as { targetCharacterId?: unknown };
    expect(action.targetCharacterId).toBe(mouthId);
  });

  test('playable on each qualifying non-Ringwraith character when multiple are at a Darkhaven', () => {
    const state = orgStateAtHaven({ targetChars: [THE_MOUTH, CIRYAHER] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(2);
  });

  test('NOT playable if the target character\'s company is not at a Darkhaven (ruins-and-lairs)', () => {
    const state = orgStateAtHaven({ targetSite: ETTENMOORS, targetChars: [THE_MOUTH] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('NOT playable on the Ringwraith itself ("one of your OTHER characters")', () => {
    // Company with only the Ringwraith at a haven — should not be offered as a target
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL] }],
          hand: [BY_THE_RINGWRAITHS_WORD],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rule 7: Player duplication limit ─────────────────────────────────────

  test('a player cannot play a second copy while one is already in play under their control', () => {
    const base = orgStateAtHaven({ targetChars: [THE_MOUTH], hand: [BY_THE_RINGWRAITHS_WORD, BY_THE_RINGWRAITHS_WORD] });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, BY_THE_RINGWRAITHS_WORD);
    const targetId = findCharInstanceId(base, RESOURCE_PLAYER, THE_MOUTH);
    const afterFirst = playPermanentEventAndResolve(base, PLAYER_1, cardId, targetId);
    // After the first copy is attached, the second should not be viable
    const actions = viableActions(afterFirst, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Resolved: card attaches to the target character ──────────────────────

  test('when played, card is attached to the target character as an item', () => {
    const state = orgStateAtHaven({ targetChars: [THE_MOUTH] });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, BY_THE_RINGWRAITHS_WORD);
    const targetId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, targetId);
    const items = getItemsOn(after, RESOURCE_PLAYER, THE_MOUTH);
    expect(items.some(i => i.definitionId === BY_THE_RINGWRAITHS_WORD)).toBe(true);
  });

  // ── Rule 2: Ringwraith at same Darkhaven ─────────────────────────────────

  test('NOT playable if the controller\'s Ringwraith is not at the same Darkhaven as the target', () => {
    // Company has only non-ringwraith characters at a haven; no ringwraith anywhere at that haven
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH, CIRYAHER] }],
          hand: [BY_THE_RINGWRAITHS_WORD],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rule 3: Bearer becomes a leader ──────────────────────────────────────

  test('while attached, the bearer counts as a leader even if the base character has no leader skill', () => {
    // Grishnákh has no Leader keyword; with the card attached he should count as one.
    // Merging with Gorbag (natural Leader, same Orc race) at a non-haven site is blocked
    // because it would produce two leaders.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [ADUNAPHEL] },
            { site: ETTENMOORS, characters: [{ defId: GRISHNAKH, items: [BY_THE_RINGWRAITHS_WORD] }] },
            { site: ETTENMOORS, characters: [GORBAG] },
          ],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });

    // Make both Ettenmoors companies share the same site instance
    const sharedSite = base.players[0].companies[1].currentSite!;
    const state = {
      ...base,
      players: [
        {
          ...base.players[0],
          companies: base.players[0].companies.map((c, i) =>
            i === 2 ? { ...c, currentSite: sharedSite, siteCardOwned: false } : c,
          ),
        },
        base.players[1],
      ] as typeof base.players,
    };

    // Merge should be blocked: Grishnákh (card grants Leader) + Gorbag (natural Leader) = two leaders
    const mergeActions = viableActions(state, PLAYER_1, 'merge-companies');
    expect(mergeActions).toHaveLength(0);

    // Countercheck: without the card, Grishnákh has no Leader — merge should be offered
    const baseNoCard = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [ADUNAPHEL] },
            { site: ETTENMOORS, characters: [GRISHNAKH] },
            { site: ETTENMOORS, characters: [GORBAG] },
          ],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });
    const sharedSiteNoCard = baseNoCard.players[0].companies[1].currentSite!;
    const stateNoCard = {
      ...baseNoCard,
      players: [
        {
          ...baseNoCard.players[0],
          companies: baseNoCard.players[0].companies.map((c, i) =>
            i === 2 ? { ...c, currentSite: sharedSiteNoCard, siteCardOwned: false } : c,
          ),
        },
        baseNoCard.players[1],
      ] as typeof baseNoCard.players,
    };
    const mergeActionsNoCard = viableActions(stateNoCard, PLAYER_1, 'merge-companies');
    expect(mergeActionsNoCard.length).toBeGreaterThan(0);
  });

  // ── Rule 4: +4 direct influence ───────────────────────────────────────────

  test('while attached, the bearer gets +4 direct influence', () => {
    // Grishnákh base DI = 0; with card it should be 4.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [ADUNAPHEL] },
            { site: DOL_GULDUR, characters: [{ defId: GRISHNAKH, items: [BY_THE_RINGWRAITHS_WORD] }] },
          ],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });
    const withCard = recomputeDerived(state);
    expect(withCard.players[0].characters[
      findCharInstanceId(withCard, RESOURCE_PLAYER, GRISHNAKH)
    ].effectiveStats.directInfluence).toBe(4);
  });

  test('without the card, bearer has base direct influence', () => {
    // Grishnákh base DI = 0; without card it stays 0.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [ADUNAPHEL] },
            { site: DOL_GULDUR, characters: [GRISHNAKH] },
          ],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });
    const withoutCard = recomputeDerived(state);
    expect(withoutCard.players[0].characters[
      findCharInstanceId(withoutCard, RESOURCE_PLAYER, GRISHNAKH)
    ].effectiveStats.directInfluence).toBe(0);
  });

  // ── Rule 5: Cannot be discarded by a body check ──────────────────────────
  //
  // Grishnákh has discardBodyCheck: [8] — a body check roll of exactly 8
  // sends him to the discard pile. "By the Ringwraith's Word" suppresses that
  // specific discard-number check, leaving him wounded instead.
  // The card does NOT protect against elimination (roll > body).

  test('while attached, a body check matching the discard number does not discard the bearer', () => {
    // Roll = 8 hits Grishnákh's discardBodyCheck; card suppresses → survives wounded.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: ETTENMOORS, characters: [{ defId: GRISHNAKH, items: [BY_THE_RINGWRAITHS_WORD] }] },
          ],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });

    const grishnakhId = findCharInstanceId(base, RESOURCE_PLAYER, GRISHNAKH);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const wounded = setCharStatus(base, RESOURCE_PLAYER, GRISHNAKH, CardStatus.Inverted);
    const readyState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: grishnakhId }),
      cheatRollTotal: 8, // roll 8 ∈ discardBodyCheck → would normally discard
    };

    const afterCheck = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 8, explanation: 'test' });

    // With the card: discard suppressed, Grishnákh remains in play
    expect(afterCheck.players[0].characters[grishnakhId]).toBeDefined();
    expect(afterCheck.players[0].discardPile.some(c => c.definitionId === GRISHNAKH)).toBe(false);
    expect(afterCheck.players[0].outOfPlayPile.some(c => c.definitionId === GRISHNAKH)).toBe(false);
  });

  test('without the card, a body check matching the discard number discards the bearer', () => {
    // Roll = 8 hits Grishnákh's discardBodyCheck → goes to discard pile.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: ETTENMOORS, characters: [GRISHNAKH] },
          ],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });

    const grishnakhId = findCharInstanceId(base, RESOURCE_PLAYER, GRISHNAKH);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const wounded = setCharStatus(base, RESOURCE_PLAYER, GRISHNAKH, CardStatus.Inverted);
    const readyState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: grishnakhId }),
      cheatRollTotal: 8, // roll 8 ∈ discardBodyCheck → discarded
    };

    const afterCheck = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 8, explanation: 'test' });

    // Without the card: Grishnákh is in the discard pile (not eliminated)
    expect(afterCheck.players[0].characters[grishnakhId]).toBeUndefined();
    expect(afterCheck.players[0].discardPile.some(c => c.definitionId === GRISHNAKH)).toBe(true);
    expect(afterCheck.players[0].outOfPlayPile.some(c => c.definitionId === GRISHNAKH)).toBe(false);
  });

  test('with the card attached, a body check roll above body still eliminates the bearer', () => {
    // protect-from-body-check only blocks the discard-number check, not elimination.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: ETTENMOORS, characters: [{ defId: GRISHNAKH, items: [BY_THE_RINGWRAITHS_WORD] }] },
          ],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });

    const grishnakhId = findCharInstanceId(base, RESOURCE_PLAYER, GRISHNAKH);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const wounded = setCharStatus(base, RESOURCE_PLAYER, GRISHNAKH, CardStatus.Inverted);
    const readyState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: grishnakhId }),
      cheatRollTotal: 12, // roll 12 > body 8 → eliminated even with card
    };

    const afterCheck = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 8, explanation: 'test' });

    // Card does not protect from elimination — Grishnákh is eliminated
    expect(afterCheck.players[0].characters[grishnakhId]).toBeUndefined();
    expect(afterCheck.players[0].outOfPlayPile.some(c => c.definitionId === GRISHNAKH)).toBe(true);
  });

  // ── Rule 6: Auto-discard when higher-mind character in company ────────────

  test('the bearer card is auto-discarded when a company-mate has a higher mind than the bearer', () => {
    // Grishnákh (mind=3) has the card; after merging with Gorbag (mind=6), card discards.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [ADUNAPHEL] },
            // Grishnákh bears the card (only character in his company — no discard yet)
            { site: DOL_GULDUR, characters: [{ defId: GRISHNAKH, items: [BY_THE_RINGWRAITHS_WORD] }] },
            // Gorbag (mind=6 > 3) is in a separate company at the same haven
            { site: DOL_GULDUR, characters: [GORBAG] },
          ],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });

    // Share the same haven site instance for companies 1 and 2 so they can merge
    const sharedSite = base.players[0].companies[1].currentSite!;
    const state = {
      ...base,
      players: [
        {
          ...base.players[0],
          companies: base.players[0].companies.map((c, i) =>
            i === 2 ? { ...c, currentSite: sharedSite, siteCardOwned: false } : c,
          ),
        },
        base.players[1],
      ] as typeof base.players,
    };

    // Card should be attached before the merge
    expect(getItemsOn(state, RESOURCE_PLAYER, GRISHNAKH).some(i => i.definitionId === BY_THE_RINGWRAITHS_WORD)).toBe(true);

    // Merge Gorbag's company into Grishnákh's company (havens exempt from leader/race restrictions).
    // All three companies now share the same haven definition (rule g.site.1 / 2.II.3.5.2), so
    // merges are also legal between the other pairs — match the exact Gorbag/Grishnákh pair.
    const mergeActions = viableActions(state, PLAYER_1, 'merge-companies');
    expect(mergeActions.length).toBeGreaterThan(0);
    const gorbagCompany = state.players[0].companies.find(c =>
      c.characters.includes(findCharInstanceId(state, RESOURCE_PLAYER, GORBAG)),
    )!;
    const grishnakhCompany = state.players[0].companies.find(c =>
      c.characters.includes(findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH)),
    )!;
    const mergeAction = mergeActions.find(ea => {
      const a = ea.action as { sourceCompanyId: string; targetCompanyId: string };
      return (a.sourceCompanyId === gorbagCompany.id && a.targetCompanyId === grishnakhCompany.id)
        || (a.sourceCompanyId === grishnakhCompany.id && a.targetCompanyId === gorbagCompany.id);
    })!;
    const afterMerge = dispatch(state, mergeAction.action);

    // After merge, Gorbag (mind=6) is in the same company as Grishnákh (mind=3)
    // → sweepAutoDiscardResourceEvents fires → card discards
    const grishnakhItems = getItemsOn(afterMerge, RESOURCE_PLAYER, GRISHNAKH);
    expect(grishnakhItems.some(i => i.definitionId === BY_THE_RINGWRAITHS_WORD)).toBe(false);
    // Card should be in player 1's discard pile
    expect(afterMerge.players[0].discardPile.some(c => c.definitionId === BY_THE_RINGWRAITHS_WORD)).toBe(true);
  });

  test('the bearer card stays in play while no company-mate has a higher mind than the bearer', () => {
    // The Mouth (mind=9) has the card; Grishnákh (mind=3) is in the same company.
    // 3 < 9 → no auto-discard.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [ADUNAPHEL] },
            { site: DOL_GULDUR, characters: [
              { defId: THE_MOUTH, items: [BY_THE_RINGWRAITHS_WORD] },
              GRISHNAKH,
            ] },
          ],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });

    // The card should still be attached (Grishnákh 3 < The Mouth 9, no discard)
    expect(getItemsOn(state, RESOURCE_PLAYER, THE_MOUTH).some(i => i.definitionId === BY_THE_RINGWRAITHS_WORD)).toBe(true);
  });

  test('card immediately discards when played on a character whose company already has a higher-mind member', () => {
    // Play the card on Grishnákh (mind=3) when The Mouth (mind=9) is already in the company.
    // The sweep runs right after permanent event resolution → card discards immediately.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [ADUNAPHEL] },
            { site: DOL_GULDUR, characters: [GRISHNAKH, THE_MOUTH] },
          ],
          hand: [BY_THE_RINGWRAITHS_WORD],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });

    const cardId = findHandCardId(state, RESOURCE_PLAYER, BY_THE_RINGWRAITHS_WORD);
    const grishnakhId = findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH);

    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, cardId, grishnakhId);

    // Card should have discarded immediately (The Mouth mind=9 > Grishnákh mind=3)
    expect(getItemsOn(afterPlay, RESOURCE_PLAYER, GRISHNAKH).some(i => i.definitionId === BY_THE_RINGWRAITHS_WORD)).toBe(false);
    expect(afterPlay.players[0].discardPile.some(c => c.definitionId === BY_THE_RINGWRAITHS_WORD)).toBe(true);
  });

  // ── Opposing player may play their own copy ───────────────────────────────

  test('the opposing Ringwraith player may still play their own copy while one is in play under the other player', () => {
    // Player 1 has their copy on The Mouth.
    // Player 2 has Hoarmurath + another character at their Darkhaven — they can play their copy too.
    const theOtherCharForP2 = GRISHNAKH; // not a ringwraith, mind=3
    const state = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [ADUNAPHEL, { defId: THE_MOUTH, items: [BY_THE_RINGWRAITHS_WORD] }] },
          ],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [HOARMURATH] },
            { site: DOL_GULDUR, characters: [theOtherCharForP2] },
          ],
          hand: [BY_THE_RINGWRAITHS_WORD],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
      ],
    });

    const actions = viableActions(state, PLAYER_2, 'play-permanent-event');
    // Player 2's copy is available (scope is per-player, not game-wide)
    expect(actions.length).toBeGreaterThan(0);
  });
});
