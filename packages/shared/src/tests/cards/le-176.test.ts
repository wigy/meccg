/**
 * @module le-176.test
 *
 * Card test: Come By Night Upon Them (le-176)
 * Type: minion-resource-event (short), non-unique, Ringwraith. MP 0.
 *
 * Card text:
 *   "Playable on a Border-hold [{B}]. -1 to the prowess of all automatic-attacks
 *    at the site (-2 if Doors of Night is in play). The first item played at the
 *    site does not tap the site."
 *
 * Effects (data):
 *   - play-window (phase site, siteTypes ["border-hold"]): restricts play to the
 *       site phase while the active company is at a Border-hold.
 *   - on-event self-enters-play → add-constraint auto-attack-prowess-boost
 *       (scope company-site-phase, value -1, siteType border-hold,
 *       doublesWithDoorsOfNight): installs a *persistent* auto-attack.prowess
 *       modifier on the active company's site so every automatic-attack faced
 *       there loses 1 prowess (2 while Doors of Night is in play — the doubled
 *       amount is baked in at play time). Unlike a one-shot boost (Choking
 *       Shadows, Arouse Defenders), the modifier is NOT consumed after the first
 *       attack — it applies for the whole site phase.
 *   - on-event self-enters-play → set-site-phase-flag firstItemNoTapAvailable:
 *       the first item played at the site this site phase does not tap the site.
 *
 * Engine support:
 * | # | Rule                                                          | Status |
 * |---|-------------------------------------------------------------|--------|
 * | 1 | Playable at a Border-hold during the site phase             | OK     |
 * | 2 | NOT playable at a non-Border-hold (dark-hold)               | OK     |
 * | 3 | Resolution installs a persistent auto-attack.prowess -1     | OK     |
 * | 4 | Resolution sets the firstItemNoTapAvailable flag            | OK     |
 * | 5 | All automatic-attacks at the site lose 1 prowess           | OK     |
 * | 6 | The modifier is -2 while Doors of Night is in play         | OK     |
 * | 7 | The modifier persists past the first attack (not consumed) | OK     |
 * | 8 | The first item played does not tap the site               | OK     |
 * | 9 | A later item at the site taps it normally                 | OK     |
 *
 * Player-index convention: the minion (resource) company is P1 /
 * RESOURCE_PLAYER; P2 / HAZARD_PLAYER holds Doors of Night in play for rule 6.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint, Phase,
  PLAYER_1, RESOURCE_PLAYER, HAZARD_PLAYER,
  CardStatus, CardDefinitionId,
  buildMinionSitePhaseState, setupAutoAttackStep,
  addCardInPlay, dispatch, findHandCardId, findCharInstanceId,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { GameState, SitePhaseState, ActiveConstraint } from '../../index.js';

const COME_BY_NIGHT = 'le-176' as CardDefinitionId;
const BREE_LE = 'le-356' as CardDefinitionId;    // minion border-hold: Dúnedain 1 strike / 7 prowess; minor items playable
const CARN_DUM = 'le-359' as CardDefinitionId;   // minion dark-hold (not a Border-hold)
const GORBAG = 'le-11' as CardDefinitionId;      // minion character (orc), untapped bearer
const SHAGRAT = 'le-39' as CardDefinitionId;     // second minion character (orc) for a second bearer
const BLACK_HIDE_SHIELD = 'le-300' as CardDefinitionId;  // minor item, no effects
const DOORS_OF_NIGHT = 'le-110' as CardDefinitionId;     // hazard environment

/** Move a site-phase state to the enter-or-skip decision window (site not yet entered). */
function atEnterOrSkip(state: GameState): GameState {
  const base = state.phaseState as SitePhaseState;
  return { ...state, phaseState: { ...base, step: 'enter-or-skip', siteEntered: false } };
}

/** The play-short-event action for Come By Night in the resource player's hand. */
function comeByNightPlays(state: GameState) {
  const cardId = findHandCardId(state, RESOURCE_PLAYER, COME_BY_NIGHT);
  return computeLegalActions(state, PLAYER_1).filter(
    ea => ea.viable && ea.action.type === 'play-short-event'
      && (ea.action as { cardInstanceId?: string }).cardInstanceId === (cardId as string),
  );
}

/** The persistent auto-attack.prowess modifier installed by the card, if any. */
function autoAttackProwessMod(state: GameState): ActiveConstraint | undefined {
  return state.activeConstraints.find(
    c => c.kind.type === 'attribute-modifier' && c.kind.attribute === 'auto-attack.prowess',
  );
}

describe('Come By Night Upon Them (le-176)', () => {
  beforeEach(() => resetMint());

  // ─── Rules 1 & 2: playability gate (Border-hold, site phase) ────────────────

  test('offered at a Border-hold during the site phase', () => {
    const state = atEnterOrSkip(buildMinionSitePhaseState({
      site: BREE_LE, characters: [GORBAG], hand: [COME_BY_NIGHT],
    }));
    expect(comeByNightPlays(state)).toHaveLength(1);
  });

  test('NOT offered at a Dark-hold (only at a Border-hold)', () => {
    const state = atEnterOrSkip(buildMinionSitePhaseState({
      site: CARN_DUM, characters: [GORBAG], hand: [COME_BY_NIGHT],
    }));
    expect(comeByNightPlays(state)).toHaveLength(0);
  });

  // ─── Rules 3 & 4: resolution installs the constraint and the no-tap flag ─────

  test('playing it installs a persistent company-site-phase auto-attack.prowess -1 and sets the no-tap flag', () => {
    const state = atEnterOrSkip(buildMinionSitePhaseState({
      site: BREE_LE, characters: [GORBAG], hand: [COME_BY_NIGHT],
    }));
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;
    const after = dispatch(state, comeByNightPlays(state)[0].action);

    const mod = autoAttackProwessMod(after);
    expect(mod).toBeDefined();
    if (mod?.kind.type !== 'attribute-modifier') throw new Error('unreachable');
    expect(mod.kind.value).toBe(-1);
    expect(mod.kind.persistent).toBe(true);
    expect(mod.kind.filter).toEqual({ 'site.type': 'border-hold' });
    expect(mod.target).toEqual({ kind: 'company', companyId });
    expect(mod.scope).toEqual({ kind: 'company-site-phase', companyId });

    // The first-item-no-tap flag is set on the site phase state.
    expect((after.phaseState as SitePhaseState & { firstItemNoTapAvailable?: boolean }).firstItemNoTapAvailable).toBe(true);

    // The short event is spent (moved out of hand to the discard pile).
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === COME_BY_NIGHT)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === COME_BY_NIGHT)).toBe(true);
  });

  // ─── Rule 5 (+ baseline control): the automatic-attack loses 1 prowess ───────

  test('baseline: Bree\'s Dúnedain automatic-attack is 7 prowess without the event', () => {
    const state = buildMinionSitePhaseState({ site: BREE_LE, characters: [GORBAG] });
    const base = dispatch(setupAutoAttackStep(state), { type: 'pass', player: PLAYER_1 });
    expect(base.combat).not.toBeNull();
    expect(base.combat!.strikeProwess).toBe(7);
    expect(base.combat!.creatureRace).toBe('dunadan');
  });

  test('after playing the event, the automatic-attack is 7 → 6 (-1)', () => {
    const state = atEnterOrSkip(buildMinionSitePhaseState({
      site: BREE_LE, characters: [GORBAG], hand: [COME_BY_NIGHT],
    }));
    const played = dispatch(state, comeByNightPlays(state)[0].action);
    const combatStart = dispatch(setupAutoAttackStep(played), { type: 'pass', player: PLAYER_1 });
    expect(combatStart.combat).not.toBeNull();
    expect(combatStart.combat!.strikeProwess).toBe(6);   // 7 - 1
  });

  // ─── Rule 6: -2 while Doors of Night is in play ─────────────────────────────

  test('with Doors of Night in play, the automatic-attack is 7 → 5 (-2)', () => {
    let state = atEnterOrSkip(buildMinionSitePhaseState({
      site: BREE_LE, characters: [GORBAG], hand: [COME_BY_NIGHT],
    }));
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const played = dispatch(state, comeByNightPlays(state)[0].action);

    // Doubled amount is baked into the constraint at play time.
    const mod = autoAttackProwessMod(played);
    if (mod?.kind.type !== 'attribute-modifier') throw new Error('unreachable');
    expect(mod.kind.value).toBe(-2);

    const combatStart = dispatch(setupAutoAttackStep(played), { type: 'pass', player: PLAYER_1 });
    expect(combatStart.combat!.strikeProwess).toBe(5);   // 7 - 2
  });

  // ─── Rule 7: the modifier persists past the first attack (not consumed) ──────

  test('the auto-attack.prowess modifier is NOT consumed after the first attack initiates', () => {
    const state = atEnterOrSkip(buildMinionSitePhaseState({
      site: BREE_LE, characters: [GORBAG], hand: [COME_BY_NIGHT],
    }));
    const played = dispatch(state, comeByNightPlays(state)[0].action);
    const combatStart = dispatch(setupAutoAttackStep(played), { type: 'pass', player: PLAYER_1 });
    // A one-shot boost (Choking Shadows / Arouse Defenders) would be gone here;
    // this persistent modifier survives to weaken any further attacks at the site.
    const mod = autoAttackProwessMod(combatStart);
    expect(mod).toBeDefined();
    if (mod?.kind.type !== 'attribute-modifier') throw new Error('unreachable');
    expect(mod.kind.value).toBe(-1);
  });

  // ─── Rules 8 & 9: the first item played does not tap the site ───────────────

  test('with the no-tap flag set, the first item played leaves the Border-hold untapped and consumes the flag', () => {
    let state = buildMinionSitePhaseState({
      site: BREE_LE, characters: [GORBAG], hand: [BLACK_HIDE_SHIELD],
    });
    state = {
      ...state,
      phaseState: { ...(state.phaseState as SitePhaseState), firstItemNoTapAvailable: true },
    };
    const shieldId = findHandCardId(state, RESOURCE_PLAYER, BLACK_HIDE_SHIELD);
    const play = computeLegalActions(state, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (shieldId as string),
    );
    expect(play).toBeDefined();
    const after = dispatch(state, play!.action);

    // Site stays untapped; flag consumed.
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
    expect((after.phaseState as SitePhaseState & { firstItemNoTapAvailable?: boolean }).firstItemNoTapAvailable).toBe(false);
    // Item attached to the bearer.
    const gorbagId = findCharInstanceId(after, RESOURCE_PLAYER, GORBAG);
    expect(after.players[RESOURCE_PLAYER].characters[gorbagId].items.some(i => i.definitionId === BLACK_HIDE_SHIELD)).toBe(true);
  });

  test('control: without the flag, the first item played taps the Border-hold', () => {
    const state = buildMinionSitePhaseState({
      site: BREE_LE, characters: [GORBAG], hand: [BLACK_HIDE_SHIELD],
    });
    const shieldId = findHandCardId(state, RESOURCE_PLAYER, BLACK_HIDE_SHIELD);
    const play = computeLegalActions(state, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (shieldId as string),
    );
    expect(play).toBeDefined();
    const after = dispatch(state, play!.action);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
  });

  test('a second item played after the free one taps the site normally', () => {
    // Two characters so the second item (which taps its bearer) has an untapped
    // bearer available; the point under test is the *site* tap, not the bearer.
    let state = buildMinionSitePhaseState({
      site: BREE_LE, characters: [GORBAG, SHAGRAT], hand: [BLACK_HIDE_SHIELD, BLACK_HIDE_SHIELD],
    });
    state = {
      ...state,
      phaseState: { ...(state.phaseState as SitePhaseState), firstItemNoTapAvailable: true },
    };
    // First item: free (site untapped).
    const firstId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const firstPlay = computeLegalActions(state, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (firstId as string),
    );
    const afterFirst = dispatch(state, firstPlay!.action);
    expect(afterFirst.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);

    // Second item: taps the site (flag already consumed).
    const secondId = afterFirst.players[RESOURCE_PLAYER].hand[0].instanceId;
    const secondPlay = computeLegalActions(afterFirst, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (secondId as string),
    );
    expect(secondPlay).toBeDefined();
    const afterSecond = dispatch(afterFirst, secondPlay!.action);
    expect(afterSecond.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
  });
});
