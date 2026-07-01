/**
 * @module le-175.test
 *
 * Card test: Catch an Elusive Scent (le-175)
 * Type: minion-resource-event (short, ringwraith alignment)
 *
 * Card text: "Scout only. Playable during the site phase on an untapped scout.
 * Tap the scout. Another character in his company may play any minor, major,
 * or gold ring item normally playable at the site. This does not tap the
 * site, and Catch an Elusive Scent can be played at a site that is already
 * tapped."
 *
 * Effects:
 *   1. play-window: phase "site" — only playable during the site phase
 *   2. play-target: character with filter (scout skill) + cost (tap) — targets
 *      an untapped scout; the scout is tapped when played
 *   3. on-event: self-enters-play → set-site-phase-flag(thoroughSearchAvailable) —
 *      sets SitePhaseState.thoroughSearchAvailable, allowing one additional minor,
 *      major, or gold ring item to be played without tapping the site.
 *
 * Same mechanism as the certified hero-side twin, Thorough Search (tw-349),
 * which shares the flag name (the flag is scoped per-player site-phase state,
 * so there is no cross-card interference).
 *
 * Engine Support:
 * | # | Effect Type               | Status      | Notes                                          |
 * |---|---------------------------|-------------|------------------------------------------------|
 * | 1 | play-window site          | IMPLEMENTED | playResourceShortEventActions + site filter    |
 * | 2 | play-target scout + tap   | IMPLEMENTED | DSL filter + cost via condition-matcher        |
 * | 3 | set-site-phase-flag       | IMPLEMENTED | applyShortEventOnEntersPlay, reducer-site      |
 *
 * Fixture alignment: minion (ringwraith)
 *   - CALENDAL (le-4):    elf scout/sage — untapped scout target
 *   - THE_MOUTH (le-24):  man warrior/diplomat, NOT a scout — "another character"
 *   - DANCING_SPIRE (as-143): minion ruins-and-lairs, playable items (minor,
 *     major, greater, gold ring) — resource player's site
 *   - SAW_TOOTHED_BLADE (le-342): minor item, no site restriction beyond type
 *   - HIGH_HELM (le-313): major item, no site restriction beyond type
 *   - A_LITTLE_GOLD_RING (le-297): gold-ring item, playable at a Ruins & Lairs
 *     where gold rings are playable (Dancing Spire qualifies)
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildMinionSitePhaseState, resetMint,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  Phase, Alignment, CardStatus,
  handCardId, findCharInstanceId,
  dispatch, viableActions,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction, SitePhaseState } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const CATCH_AN_ELUSIVE_SCENT = 'le-175' as CardDefinitionId;

const DANCING_SPIRE = 'as-143' as CardDefinitionId; // minion ruins-and-lairs: minor/major/greater/gold-ring
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven

const CALENDAL = 'le-4' as CardDefinitionId;   // elf, scout/sage
const THE_MOUTH = 'le-24' as CardDefinitionId; // man, warrior/diplomat — not a scout

const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;  // minor
const HIGH_HELM = 'le-313' as CardDefinitionId;          // major, unique
const A_LITTLE_GOLD_RING = 'le-297' as CardDefinitionId; // gold-ring

describe('Catch an Elusive Scent (le-175)', () => {
  beforeEach(() => resetMint());

  // ─── play-window: only playable during site phase ────────────────────────────

  test('not offered during organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [CALENDAL] }], hand: [CATCH_AN_ELUSIVE_SCENT], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  test('offered during site phase at play-resources step', () => {
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [CALENDAL],
      hand: [CATCH_AN_ELUSIVE_SCENT],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── play-target: scout only ─────────────────────────────────────────────────

  test('only offered when a scout is in the company', () => {
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [THE_MOUTH],
      hand: [CATCH_AN_ELUSIVE_SCENT],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  test('targets the untapped scout character via targetScoutInstanceId', () => {
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [CALENDAL],
      hand: [CATCH_AN_ELUSIVE_SCENT],
    });
    const calendalId = findCharInstanceId(state, RESOURCE_PLAYER, CALENDAL);

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
    expect(playActions.every(a => a.targetScoutInstanceId === calendalId)).toBe(true);
  });

  test('not offered when the scout is tapped', () => {
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [{ defId: CALENDAL, status: CardStatus.Tapped }],
      hand: [CATCH_AN_ELUSIVE_SCENT],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  // ─── can be played at a tapped site ──────────────────────────────────────────

  test('offered at a tapped site', () => {
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [CALENDAL],
      siteStatus: CardStatus.Tapped,
      hand: [CATCH_AN_ELUSIVE_SCENT],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── core effect: playing the event sets thoroughSearchAvailable ──────────────

  test('playing the event sets thoroughSearchAvailable in phaseState', () => {
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [CALENDAL],
      hand: [CATCH_AN_ELUSIVE_SCENT],
    });
    const eventInstance = handCardId(state, RESOURCE_PLAYER);

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === eventInstance);
    expect(playActions).toHaveLength(1);

    const next = dispatch(state, playActions[0]);
    expect((next.phaseState as SitePhaseState).thoroughSearchAvailable).toBe(true);
  });

  // ─── thoroughSearchBonus: allows minor/major/gold-ring item at tapped site ───

  test('minor item playable at tapped site when thoroughSearchAvailable', () => {
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [CALENDAL],
      siteStatus: CardStatus.Tapped,
      hand: [SAW_TOOTHED_BLADE],
    });
    const searchState = {
      ...state,
      phaseState: { ...(state.phaseState), thoroughSearchAvailable: true },
    };

    const playActions = viableActions(searchState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major item playable at tapped site when thoroughSearchAvailable', () => {
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [CALENDAL],
      siteStatus: CardStatus.Tapped,
      hand: [HIGH_HELM],
    });
    const searchState = {
      ...state,
      phaseState: { ...(state.phaseState), thoroughSearchAvailable: true },
    };

    const playActions = viableActions(searchState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold ring item playable at tapped site when thoroughSearchAvailable', () => {
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [CALENDAL],
      siteStatus: CardStatus.Tapped,
      hand: [A_LITTLE_GOLD_RING],
    });
    const searchState = {
      ...state,
      phaseState: { ...(state.phaseState), thoroughSearchAvailable: true },
    };

    const playActions = viableActions(searchState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── item via Catch an Elusive Scent does NOT tap the site ───────────────────

  test('playing item via thoroughSearch does not tap the site', () => {
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [CALENDAL],
      hand: [SAW_TOOTHED_BLADE],
    });
    const searchState = {
      ...state,
      phaseState: { ...(state.phaseState), thoroughSearchAvailable: true },
    };

    const playActions = viableActions(searchState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(searchState, playActions[0].action);
    const company = next.players[0].companies[0];
    expect(company.currentSite?.status).toBe(CardStatus.Untapped);
  });

  // ─── thoroughSearchAvailable is cleared after the item is played ─────────────

  test('thoroughSearchAvailable is cleared after playing a minor item', () => {
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [CALENDAL],
      siteStatus: CardStatus.Tapped,
      hand: [SAW_TOOTHED_BLADE],
    });
    const searchState = {
      ...state,
      phaseState: { ...(state.phaseState), thoroughSearchAvailable: true },
    };

    const playActions = viableActions(searchState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(searchState, playActions[0].action);
    expect((next.phaseState as SitePhaseState).thoroughSearchAvailable).toBe(false);
  });

  // ─── item via Catch an Elusive Scent does NOT set resourcePlayed ─────────────

  test('playing item via thoroughSearch does not set resourcePlayed', () => {
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [CALENDAL],
      hand: [SAW_TOOTHED_BLADE],
    });
    const searchState = {
      ...state,
      phaseState: { ...(state.phaseState), thoroughSearchAvailable: true },
    };

    const playActions = viableActions(searchState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(searchState, playActions[0].action);
    expect((next.phaseState as SitePhaseState).resourcePlayed).toBe(false);
  });

  // ─── without thoroughSearchAvailable, item not playable at a tapped site ─────

  test('minor item not playable at tapped site without thoroughSearchAvailable', () => {
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [CALENDAL],
      siteStatus: CardStatus.Tapped,
      hand: [SAW_TOOTHED_BLADE],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  // ─── full flow: play event, then another character plays the item ───────────

  test('full flow: event played at tapped site unlocks minor item play by another character without tapping site', () => {
    // Calendal (scout) taps to play Catch an Elusive Scent; The Mouth
    // (non-scout) plays the item. Two characters are needed since the scout
    // gets tapped by the event cost.
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [CALENDAL, THE_MOUTH],
      siteStatus: CardStatus.Tapped,
      hand: [CATCH_AN_ELUSIVE_SCENT, SAW_TOOTHED_BLADE],
    });

    // Item is not playable without the event (site is tapped)
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);

    // Play Catch an Elusive Scent on Calendal
    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    const eventActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === eventInstance);
    expect(eventActions).toHaveLength(1);
    const afterEvent = dispatch(state, eventActions[0]);

    // thoroughSearchAvailable is now set
    expect((afterEvent.phaseState as SitePhaseState).thoroughSearchAvailable).toBe(true);

    // Item is now playable (The Mouth is still untapped and can bear it)
    const itemActions = viableActions(afterEvent, PLAYER_1, 'play-hero-resource');
    expect(itemActions.length).toBeGreaterThanOrEqual(1);

    // Play the item — site should remain tapped (not double-tapped), flag cleared
    const afterItem = dispatch(afterEvent, itemActions[0].action);
    expect((afterItem.phaseState as SitePhaseState).thoroughSearchAvailable).toBe(false);
    const company = afterItem.players[0].companies[0];
    expect(company.currentSite?.status).toBe(CardStatus.Tapped);

    // Saw-toothed Blade is attached to The Mouth (the untapped character)
    const mouthChar = Object.values(afterItem.players[0].characters)
      .find(ch => ch.definitionId === THE_MOUTH);
    expect(mouthChar?.items.some(i => i.definitionId === SAW_TOOTHED_BLADE)).toBe(true);
  });
});
