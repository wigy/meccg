/**
 * @module wh-89.test
 *
 * Card test: Keys to the White Towers (wh-89)
 * Type: minion-resource-item · alignment: stage · Stage resource (special item)
 *
 * Card text:
 *   "Unique. Playable at Barrow-downs. During your organization phase, you
 *    may: take the Fortress of the Towers card from your play deck or discard
 *    pile to your hand or discard the Fortress of the Towers card if in play
 *    by another player. Reshuffle your play deck if searched."
 *
 * Modelled as:
 *  - `item-play-site` `sites: ["Barrow-downs"]` — playable only where the
 *    company stands at Barrow-downs (bypasses the site's `playableResources`).
 *  - `stage-points: 1` (data: 2 MP item, 1 CP — both engine-generic).
 *  - Two `grant-action` effects sharing the action name
 *    `fetch-or-discard-named`, each `oncePerTurn` (the shared name makes the
 *    `granted-action-used` lock cover both — one choice per turn):
 *     - mode A (no `targets`): `enqueue-pending-fetch` from
 *       `["deck", "discard-pile"]` to hand, filtered to
 *       `name: "Fortress of the Towers"`; the fetch machinery reshuffles the
 *       play deck exactly when the deck was the searched source.
 *     - mode B (`targets.scope: "opponent-cards-in-play"` + name filter):
 *       `discard-target-in-play` — discards the opponent's in-play Fortress
 *       of the Towers and clears the constraints it sourced.
 *
 * | # | Rule                                                        | Status |
 * |---|-------------------------------------------------------------|--------|
 * | 1 | Unique                                                      | data (generic uniqueness gate) |
 * | 2 | Playable at Barrow-downs (and nowhere else)                 | OK     |
 * | 3 | org phase: take Fortress from play deck to hand (reshuffle) | OK     |
 * | 4 | org phase: take Fortress from discard pile to hand          | OK     |
 * | 5 | org phase: discard opponent's in-play Fortress              | OK     |
 * | 6 | "you may: A or B" — a single choice, once per turn          | OK     |
 * | 7 | 1 stage point while in play (borne item)                    | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { CardStatus, computeLegalActions } from '../../index.js';
import type {
  ActivateGrantedAction, CardDefinitionId, CardInPlay, CardInstanceId,
  ConstraintId, GameState,
} from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import {
  resetMint, viableActions, dispatch, findHandCardId, findCharInstanceId,
  buildFallenWizardOrgPhaseState, buildFallenWizardSitePhaseState,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER, RIVENDELL, ARAGORN,
} from '../test-helpers.js';

const KEYS = 'wh-89' as CardDefinitionId;
const FORTRESS = 'wh-69' as CardDefinitionId;          // "Fortress of the Towers"
const BARROW_DOWNS = 'tw-375' as CardDefinitionId;      // hero Ruins & Lairs "Barrow-downs"
const WHITE_TOWERS_WH = 'wh-58' as CardDefinitionId;    // FW Wizardhaven the Fortress protects
const DAGGER = 'tw-206' as CardDefinitionId;            // filler deck card (never fetchable)

const FORT_IN_PLAY = 'p2-fortress' as CardInstanceId;

// An opponent's in-play Fortress of the Towers. Left unbound (`attachedToSite`
// omitted) so the orphaned-site-event post-reduce sweep cannot discard it
// behind the test's back — the discard asserted here must come from the Keys.
const OPPONENT_FORTRESS: CardInPlay = {
  instanceId: FORT_IN_PLAY,
  definitionId: FORTRESS,
  status: CardStatus.Untapped,
};

// The site-protected constraint the opponent's Fortress sources (as wh-69
// adds on entering play) — must be cleared when the Keys discard it.
const FORTRESS_CONSTRAINT = {
  id: 'fortress-protection' as ConstraintId,
  source: FORT_IN_PLAY,
  sourceDefinitionId: FORTRESS,
  scope: { kind: 'until-cleared' as const },
  target: { kind: 'player' as const, playerId: PLAYER_2 },
  kind: { type: 'site-flag' as const, flag: 'site-protected' as const, siteDefinitionId: WHITE_TOWERS_WH },
};

describe('Keys to the White Towers (wh-89)', () => {
  beforeEach(() => resetMint());

  // ── Rule 2: playable at Barrow-downs, and only there ───────────────────────

  test('playable at Barrow-downs — one play action, attaching to the character', () => {
    const state = buildFallenWizardSitePhaseState({
      site: BARROW_DOWNS, characters: [ARAGORN], hand: [KEYS],
    });
    const keysId = findHandCardId(state, RESOURCE_PLAYER, KEYS);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource').filter(
      ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === keysId,
    );
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { attachToCharacterId?: CardInstanceId }).attachToCharacterId).toBe(aragornId);

    const after = dispatch(state, plays[0].action);
    expect(after.players[RESOURCE_PLAYER].characters[aragornId].items.some(i => i.definitionId === KEYS)).toBe(true);
  });

  test('NOT playable at a site other than Barrow-downs', () => {
    const state = buildFallenWizardSitePhaseState({
      site: RIVENDELL, characters: [ARAGORN], hand: [KEYS],
    });
    const keysId = findHandCardId(state, RESOURCE_PLAYER, KEYS);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource').filter(
      ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === keysId,
    );
    expect(plays).toHaveLength(0);
  });

  // ── Rule 3: take the Fortress from the play deck to hand, reshuffling ─────

  test('org phase: fetch offers the Fortress from the play deck, moves it to hand', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: RIVENDELL,
      characters: [{ defId: ARAGORN, items: [KEYS] }],
      playDeck: [FORTRESS, DAGGER, DAGGER],
    });

    const activations = viableActions(state, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-or-discard-named',
    );
    // Opponent has no Fortress in play: only the fetch mode (no target) is offered.
    expect(activations).toHaveLength(1);
    expect((activations[0].action as ActivateGrantedAction).targetCardId).toBeUndefined();

    const pending = dispatch(state, activations[0].action);
    expect(pending.pendingEffects).toHaveLength(1);
    const effect = (pending.pendingEffects[0] as { effect: { type: string; source: readonly string[]; to?: string } }).effect;
    expect(effect.type).toBe('fetch-to-deck');
    expect(effect.source).toEqual(['deck', 'discard-pile']);
    expect(effect.to).toBe('hand');

    // The only fetchable card is the Fortress, from the deck (fillers filtered out).
    const fortInstance = pending.players[RESOURCE_PLAYER].playDeck.find(c => c.definitionId === FORTRESS)!;
    const fetches = computeLegalActions(pending, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'fetch-from-pile',
    );
    expect(fetches).toHaveLength(1);
    expect((fetches[0].action as { cardInstanceId: CardInstanceId }).cardInstanceId).toBe(fortInstance.instanceId);
    expect((fetches[0].action as { source: string }).source).toBe('deck');

    const after = dispatch(pending, fetches[0].action);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === fortInstance.instanceId)).toBe(true);
    // The searched deck no longer holds the Fortress; the fillers remain
    // (reshuffled in place).
    expect(after.players[RESOURCE_PLAYER].playDeck.some(c => c.definitionId === FORTRESS)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].playDeck).toHaveLength(2);
    expect(after.pendingEffects).toHaveLength(0);
  });

  // ── Rule 4: take the Fortress from the discard pile to hand ───────────────

  test('org phase: fetch offers the Fortress from the discard pile, moves it to hand', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: RIVENDELL,
      characters: [{ defId: ARAGORN, items: [KEYS] }],
      playDeck: [DAGGER],
      discardPile: [FORTRESS],
    });

    const activation = viableActions(state, PLAYER_1, 'activate-granted-action').find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-or-discard-named',
    )!;
    const pending = dispatch(state, activation.action);

    const fortInstance = pending.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === FORTRESS)!;
    const fetches = computeLegalActions(pending, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'fetch-from-pile',
    );
    expect(fetches).toHaveLength(1);
    expect((fetches[0].action as { source: string }).source).toBe('discard-pile');

    const after = dispatch(pending, fetches[0].action);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === fortInstance.instanceId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile).toHaveLength(0);
    // The deck was not searched — its contents are untouched.
    expect(after.players[RESOURCE_PLAYER].playDeck).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].playDeck[0].definitionId).toBe(DAGGER);
  });

  // ── Rule 5: discard the Fortress if in play by another player ─────────────

  test('org phase: discards the opponent\'s in-play Fortress and clears its constraint', () => {
    const base = buildFallenWizardOrgPhaseState({
      site: RIVENDELL,
      characters: [{ defId: ARAGORN, items: [KEYS] }],
      opponentCardsInPlay: [OPPONENT_FORTRESS],
    });
    const state: GameState = { ...base, activeConstraints: [...base.activeConstraints, FORTRESS_CONSTRAINT] };

    const discardMode = viableActions(state, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-or-discard-named'
        && (ea.action as ActivateGrantedAction).targetCardId !== undefined,
    );
    expect(discardMode).toHaveLength(1);
    expect((discardMode[0].action as ActivateGrantedAction).targetCardId).toBe(FORT_IN_PLAY);

    const after = dispatch(state, discardMode[0].action);
    expect(after.players[HAZARD_PLAYER].cardsInPlay).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === FORT_IN_PLAY)).toBe(true);
    expect(after.activeConstraints.some(c => c.source === FORT_IN_PLAY)).toBe(false);
  });

  test('discard mode is NOT offered when the opponent has no Fortress in play', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: RIVENDELL,
      characters: [{ defId: ARAGORN, items: [KEYS] }],
    });
    const withTarget = viableActions(state, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-or-discard-named'
        && (ea.action as ActivateGrantedAction).targetCardId !== undefined,
    );
    expect(withTarget).toHaveLength(0);
  });

  test('discard mode is NOT offered against your OWN in-play Fortress', () => {
    const base = buildFallenWizardOrgPhaseState({
      site: RIVENDELL,
      characters: [{ defId: ARAGORN, items: [KEYS] }],
    });
    const ownFortress: CardInPlay = { instanceId: 'p1-fortress' as CardInstanceId, definitionId: FORTRESS, status: CardStatus.Untapped };
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0], cardsInPlay: [...base.players[0].cardsInPlay, ownFortress] },
        base.players[1],
      ] as GameState['players'],
    };
    const withTarget = viableActions(state, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-or-discard-named'
        && (ea.action as ActivateGrantedAction).targetCardId !== undefined,
    );
    expect(withTarget).toHaveLength(0);
  });

  // ── Rule 6: "you may: A or B" — one choice, once per turn ─────────────────

  test('after discarding the opponent\'s Fortress, neither mode is offered again this turn', () => {
    const base = buildFallenWizardOrgPhaseState({
      site: RIVENDELL,
      characters: [{ defId: ARAGORN, items: [KEYS] }],
      playDeck: [FORTRESS],
      opponentCardsInPlay: [OPPONENT_FORTRESS],
    });
    // Both modes available: the fetch (deck holds a Fortress) and the discard.
    const before = viableActions(base, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-or-discard-named',
    );
    expect(before).toHaveLength(2);

    const discardAction = before.find(ea => (ea.action as ActivateGrantedAction).targetCardId !== undefined)!;
    const after = dispatch(base, discardAction.action);

    const remaining = viableActions(after, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-or-discard-named',
    );
    expect(remaining).toHaveLength(0);
  });

  test('after fetching, the discard mode is not offered either', () => {
    const base = buildFallenWizardOrgPhaseState({
      site: RIVENDELL,
      characters: [{ defId: ARAGORN, items: [KEYS] }],
      discardPile: [FORTRESS],
      opponentCardsInPlay: [OPPONENT_FORTRESS],
    });
    const fetchMode = viableActions(base, PLAYER_1, 'activate-granted-action').find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-or-discard-named'
        && (ea.action as ActivateGrantedAction).targetCardId === undefined,
    )!;
    const pending = dispatch(base, fetchMode.action);
    const fetch = computeLegalActions(pending, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'fetch-from-pile',
    )!;
    const after = dispatch(pending, fetch.action);

    const remaining = viableActions(after, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'fetch-or-discard-named',
    );
    expect(remaining).toHaveLength(0);
  });

  // ── Rule 7: 1 stage point while borne by a character ──────────────────────

  test('contributes 1 stage point to the Fallen-wizard while borne', () => {
    const state = recomputeDerived(buildFallenWizardOrgPhaseState({
      site: RIVENDELL,
      characters: [{ defId: ARAGORN, items: [KEYS] }],
    }));
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(1);
  });
});
