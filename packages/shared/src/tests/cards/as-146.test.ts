/**
 * @module as-146.test
 *
 * Card test: Framsburg (as-146)
 * Type: minion-site, ruins-and-lairs, unique, Ringwraith.
 *
 * Card text:
 *   "Nearest Darkhaven: Dol Guldur
 *    Playable: Items (minor)
 *    Automatic-attacks: Men — 1 strike with 10 prowess
 *    Special: The first minor item played at this site each turn does not tap
 *    the site. Contains a hoard."
 *
 * Data shape (documented here, not asserted): siteType ruins-and-lairs;
 * playableResources ["minor"]; automaticAttacks [{ Men, 1 strike, 10 prowess }];
 * keywords ["hoard"]; effects [{ site-rule first-minor-item-no-tap }].
 *
 * Engine support:
 * | # | Rule                                                            | Status |
 * |---|-----------------------------------------------------------------|--------|
 * | 1 | select-company at Framsburg seeds firstMinorItemNoTapAvailable  | OK     |
 * | 2 | first minor item played leaves the site untapped, consumes flag | OK     |
 * | 3 | a second minor item taps the site normally                      | OK     |
 * | 4 | control: a site without the rule taps on the first minor item   | OK     |
 * | 5 | "Contains a hoard" → a hoard item (Old Treasure) is playable    | OK     |
 * | 6 | control: the hoard item is NOT playable at a non-hoard site     | OK     |
 *
 * The Men — 1 strike / 10 prowess automatic-attack is a plain printed
 * auto-attack handled structurally by the site reducer and is not re-tested
 * here (no special combat rule on the card).
 *
 * Player-index convention: the minion (resource) company is P1 / RESOURCE_PLAYER.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint,
  PLAYER_1, RESOURCE_PLAYER,
  CardStatus, CardDefinitionId,
  buildMinionSitePhaseState,
  dispatch, findHandCardId, findCharInstanceId,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { GameState, SitePhaseState } from '../../index.js';

const FRAMSBURG = 'as-146' as CardDefinitionId;    // minion R&L, first-minor-item-no-tap + hoard
const BREE_LE = 'le-356' as CardDefinitionId;       // minion border-hold, minor items, NO special tap rule, NO hoard
const GORBAG = 'le-11' as CardDefinitionId;         // minion character (orc), untapped bearer
const SHAGRAT = 'le-39' as CardDefinitionId;        // second minion character (orc), second bearer
const BLACK_HIDE_SHIELD = 'le-300' as CardDefinitionId;  // plain minor item, no play restriction
const OLD_TREASURE = 'as-129' as CardDefinitionId;  // minor HOARD item (playable only at a hoard site)

type NoTapState = SitePhaseState & { firstMinorItemNoTapAvailable?: boolean };

/** Move a play-resources state back to the select-company decision. */
function atSelectCompany(state: GameState): GameState {
  const base = state.phaseState as SitePhaseState;
  return { ...state, phaseState: { ...base, step: 'select-company', siteEntered: false } };
}

/** The viable play-hero-resource action for a specific card in the resource player's hand. */
function itemPlay(state: GameState, cardDef: CardDefinitionId) {
  const cardId = findHandCardId(state, RESOURCE_PLAYER, cardDef);
  return computeLegalActions(state, PLAYER_1).find(
    ea => ea.viable && ea.action.type === 'play-hero-resource'
      && (ea.action as { cardInstanceId?: string }).cardInstanceId === (cardId as string),
  );
}

describe('Framsburg (as-146)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: the passive site rule seeds the free-minor-item allowance ───────

  test('selecting the company at Framsburg seeds firstMinorItemNoTapAvailable', () => {
    const state = atSelectCompany(buildMinionSitePhaseState({
      site: FRAMSBURG, characters: [GORBAG], hand: [BLACK_HIDE_SHIELD],
    }));
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;
    const after = dispatch(state, { type: 'select-company', player: PLAYER_1, companyId: companyId as never });
    expect((after.phaseState as NoTapState).firstMinorItemNoTapAvailable).toBe(true);
  });

  test('control: selecting the company at a site without the rule does NOT seed the flag', () => {
    const state = atSelectCompany(buildMinionSitePhaseState({
      site: BREE_LE, characters: [GORBAG], hand: [BLACK_HIDE_SHIELD],
    }));
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;
    const after = dispatch(state, { type: 'select-company', player: PLAYER_1, companyId: companyId as never });
    expect((after.phaseState as NoTapState).firstMinorItemNoTapAvailable).toBeFalsy();
  });

  // ─── Rule 2: the first minor item leaves the site untapped, consumes flag ────

  test('the first minor item played at Framsburg leaves the site untapped and consumes the allowance', () => {
    let state = buildMinionSitePhaseState({
      site: FRAMSBURG, characters: [GORBAG], hand: [BLACK_HIDE_SHIELD],
    });
    state = { ...state, phaseState: { ...(state.phaseState as SitePhaseState), firstMinorItemNoTapAvailable: true } };

    const play = itemPlay(state, BLACK_HIDE_SHIELD);
    expect(play).toBeDefined();
    const after = dispatch(state, play!.action);

    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
    expect((after.phaseState as NoTapState).firstMinorItemNoTapAvailable).toBe(false);
    // The item is attached to its bearer.
    const gorbagId = findCharInstanceId(after, RESOURCE_PLAYER, GORBAG);
    expect(after.players[RESOURCE_PLAYER].characters[gorbagId].items.some(i => i.definitionId === BLACK_HIDE_SHIELD)).toBe(true);
  });

  // ─── Rule 4 (control): without the allowance, the first minor item taps ──────

  test('control: with no allowance set, the first minor item taps the site', () => {
    const state = buildMinionSitePhaseState({
      site: FRAMSBURG, characters: [GORBAG], hand: [BLACK_HIDE_SHIELD],
    });
    const play = itemPlay(state, BLACK_HIDE_SHIELD);
    expect(play).toBeDefined();
    const after = dispatch(state, play!.action);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
  });

  // ─── Rule 3: a second minor item after the free one taps the site ────────────

  test('a second minor item after the free one taps the site normally', () => {
    let state = buildMinionSitePhaseState({
      site: FRAMSBURG, characters: [GORBAG, SHAGRAT], hand: [BLACK_HIDE_SHIELD, BLACK_HIDE_SHIELD],
    });
    state = { ...state, phaseState: { ...(state.phaseState as SitePhaseState), firstMinorItemNoTapAvailable: true } };

    // First minor item: free — site stays untapped.
    const firstId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const firstPlay = computeLegalActions(state, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (firstId as string),
    );
    const afterFirst = dispatch(state, firstPlay!.action);
    expect(afterFirst.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
    expect((afterFirst.phaseState as NoTapState).firstMinorItemNoTapAvailable).toBe(false);

    // Second minor item: allowance consumed — site taps.
    const secondId = afterFirst.players[RESOURCE_PLAYER].hand[0].instanceId;
    const secondPlay = computeLegalActions(afterFirst, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (secondId as string),
    );
    expect(secondPlay).toBeDefined();
    const afterSecond = dispatch(afterFirst, secondPlay!.action);
    expect(afterSecond.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
  });

  // ─── Rules 5 & 6: "Contains a hoard" — a hoard item is playable here only ────

  test('a hoard item (Old Treasure) is playable at Framsburg because it contains a hoard', () => {
    const state = buildMinionSitePhaseState({
      site: FRAMSBURG, characters: [GORBAG], hand: [OLD_TREASURE],
    });
    expect(itemPlay(state, OLD_TREASURE)).toBeDefined();
  });

  test('control: the hoard item is NOT playable at a non-hoard site', () => {
    const state = buildMinionSitePhaseState({
      site: BREE_LE, characters: [GORBAG], hand: [OLD_TREASURE],
    });
    expect(itemPlay(state, OLD_TREASURE)).toBeUndefined();
  });
});
