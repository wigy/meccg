/**
 * @module ba-66.test
 *
 * Card test: Maker's Map (ba-66)
 * Type: minion-resource-event (permanent), alignment ringwraith, non-unique.
 * Marshalling Points: 2 (miscellaneous).
 * Keyword: Balrog specific (deck-construction only, no play-time gate — the
 * ba-45/ba-46 precedent).
 *
 * Card text: "Balrog specific. Playable during the site phase on an untapped
 * ranger at an untapped site where Information is playable. Tap the ranger and
 * the site. +2 to all rolls for his company to move to adjacent Under-deeps
 * sites."
 *
 * Rule coverage:
 *
 * | # | Rule                                                          | Mechanism                                             |
 * |---|---------------------------------------------------------------|-------------------------------------------------------|
 * | 1 | Playable on a ranger (skill gate)                             | play-target character, filter target.skills ranger    |
 * | 2 | Only on an *untapped* ranger                                  | play-target character filter target.status: untapped  |
 * | 3 | Only at a site where Information is playable                  | play-target site, playableResources includes info     |
 * | 4 | Only at an *untapped* site                                    | play-flag untapped-site-required                       |
 * | 5 | Tap the ranger on play                                        | play-flag tap-character-on-play                        |
 * | 6 | Tap the site on play                                          | play-flag tap-site-on-play                             |
 * | 7 | +2 to bearer's-company Under-deeps movement rolls             | under-deeps-roll-modifier value:2                      |
 *
 * Playable: YES — CERTIFIED. Every effect maps to an implemented DSL primitive
 * (play-target site/character, the three play-flags, under-deeps-roll-modifier),
 * all of which the engine already composes; the modifier flows from the
 * attached permanent-event (it lives in the ranger's items slot) through
 * `collectCharacterEffects` at the Under-deeps reveal step.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  Alignment, CardStatus,
  buildTestState, buildMinionSitePhaseState, resetMint, makeMHState,
  reduce, dispatch, resolveChain,
  findCharInstanceId, findHandCardId, getCharacter, setCharStatus,
  viableActions,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  Phase,
} from '../test-helpers.js';
import { MovementType } from '../../types/common.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState } from '../../index.js';

const MAKERS_MAP = 'ba-66' as CardDefinitionId;
const ORC_TRACKER = 'le-34' as CardDefinitionId;  // minion warrior/ranger, non-unique
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;  // minion warrior (non-ranger), non-unique

const DIMRILL_DALE = 'le-365' as CardDefinitionId; // ruins-and-lairs, Information playable
const ETTENMOORS = 'le-373' as CardDefinitionId;   // ruins-and-lairs, NO Information

// Under-deeps movement fixtures (as-127 uses the same pair; roll 8 apart).
const DROWNING_DEEPS = 'ba-89' as CardDefinitionId;  // ruins-and-lairs, under-deeps
const UNDER_VAULTS = 'ba-103' as CardDefinitionId;   // ruins-and-lairs, under-deeps; adjacent (roll 8)

function playPermanentEventActions(state: ReturnType<typeof buildMinionSitePhaseState>) {
  return viableActions(state, PLAYER_1, 'play-permanent-event');
}

describe("Maker's Map (ba-66)", () => {
  beforeEach(() => resetMint());

  // ── Rules 1-4: playability gates ─────────────────────────────────────────

  test('offered on an untapped ranger at an untapped Information site', () => {
    const state = buildMinionSitePhaseState({
      site: DIMRILL_DALE,
      characters: [ORC_TRACKER],
      hand: [MAKERS_MAP],
    });
    const mapId = findHandCardId(state, RESOURCE_PLAYER, MAKERS_MAP);
    const actions = playPermanentEventActions(state).filter(
      ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === (mapId as string),
    );
    expect(actions.length).toBeGreaterThanOrEqual(1);
    const trackerId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_TRACKER);
    expect(actions.some(ea => (ea.action as { targetCharacterId?: string }).targetCharacterId === (trackerId as string))).toBe(true);
  });

  test('NOT offered on a non-ranger character (Orc Captain)', () => {
    const state = buildMinionSitePhaseState({
      site: DIMRILL_DALE,
      characters: [ORC_CAPTAIN],
      hand: [MAKERS_MAP],
    });
    const mapId = findHandCardId(state, RESOURCE_PLAYER, MAKERS_MAP);
    const actions = playPermanentEventActions(state).filter(
      ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === (mapId as string),
    );
    expect(actions).toHaveLength(0);
  });

  test('NOT offered on a tapped ranger', () => {
    const base = buildMinionSitePhaseState({
      site: DIMRILL_DALE,
      characters: [ORC_TRACKER],
      hand: [MAKERS_MAP],
    });
    const state = setCharStatus(base, RESOURCE_PLAYER, ORC_TRACKER, CardStatus.Tapped);
    const mapId = findHandCardId(state, RESOURCE_PLAYER, MAKERS_MAP);
    const actions = playPermanentEventActions(state).filter(
      ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === (mapId as string),
    );
    expect(actions).toHaveLength(0);
  });

  test('NOT offered at a site where Information is not playable (Ettenmoors)', () => {
    const state = buildMinionSitePhaseState({
      site: ETTENMOORS,
      characters: [ORC_TRACKER],
      hand: [MAKERS_MAP],
    });
    const mapId = findHandCardId(state, RESOURCE_PLAYER, MAKERS_MAP);
    const actions = playPermanentEventActions(state).filter(
      ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === (mapId as string),
    );
    expect(actions).toHaveLength(0);
  });

  test('NOT offered at an already-tapped site (untapped-site-required)', () => {
    const state = buildMinionSitePhaseState({
      site: DIMRILL_DALE,
      characters: [ORC_TRACKER],
      hand: [MAKERS_MAP],
      siteStatus: CardStatus.Tapped,
    });
    const mapId = findHandCardId(state, RESOURCE_PLAYER, MAKERS_MAP);
    const actions = playPermanentEventActions(state).filter(
      ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === (mapId as string),
    );
    expect(actions).toHaveLength(0);
  });

  // ── Rules 5+6: playing it taps the ranger and the site, and attaches ──────

  test('playing it taps the ranger and the site, and attaches to the ranger', () => {
    const state = buildMinionSitePhaseState({
      site: DIMRILL_DALE,
      characters: [ORC_TRACKER],
      hand: [MAKERS_MAP],
    });
    const mapId = findHandCardId(state, RESOURCE_PLAYER, MAKERS_MAP);
    const action = playPermanentEventActions(state).find(
      ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === (mapId as string),
    )!.action;
    const after = resolveChain(dispatch(state, action));

    const trackerId = findCharInstanceId(after, RESOURCE_PLAYER, ORC_TRACKER);
    const tracker = after.players[RESOURCE_PLAYER].characters[trackerId];
    expect(tracker.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    // Resource permanent-event on a character → items slot.
    expect(tracker.items.some(i => i.definitionId === MAKERS_MAP)).toBe(true);
  });

  // ── Rule 7: +2 to Under-deeps movement rolls for the bearer's company ─────

  test('a company whose ranger bears the Map has its Under-deeps roll reduced by 2 (8 → 6)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DROWNING_DEEPS, characters: [{ defId: ORC_TRACKER, items: [MAKERS_MAP] }], destinationSite: UNDER_VAULTS }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const result = reduce(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.UnderDeeps });
    expect(result.error).toBeUndefined();
    const mhState = result.state.phaseState as MovementHazardPhaseState;
    expect(mhState.step).toBe('under-deeps-roll');
    expect(mhState.underDeepsRollRequired).toBe(6);
  });

  test('negative control: without the Map the Under-deeps roll is unmodified (8)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DROWNING_DEEPS, characters: [ORC_TRACKER], destinationSite: UNDER_VAULTS }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const result = reduce(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.UnderDeeps });
    expect(result.error).toBeUndefined();
    const mhState = result.state.phaseState as MovementHazardPhaseState;
    expect(mhState.underDeepsRollRequired).toBe(8);
  });

  // End-to-end: play it during the site phase, then move Under-deeps next turn.
  test('end-to-end: play the Map during the site phase, then its bonus reduces the roll', () => {
    const sitePhase = buildMinionSitePhaseState({
      site: DIMRILL_DALE,
      characters: [ORC_TRACKER],
      hand: [MAKERS_MAP],
    });
    const mapId = findHandCardId(sitePhase, RESOURCE_PLAYER, MAKERS_MAP);
    const playAction = playPermanentEventActions(sitePhase).find(
      ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === (mapId as string),
    )!.action;
    const afterPlay = resolveChain(dispatch(sitePhase, playAction));
    const trackerId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, ORC_TRACKER);
    expect(getCharacter(afterPlay, RESOURCE_PLAYER, ORC_TRACKER).items.some(i => i.definitionId === MAKERS_MAP)).toBe(true);

    // Rebuild a movement/hazard state with the same (now Map-bearing) ranger at
    // an Under-deeps site, moving to the adjacent one. The permanent event sits
    // in the ranger's items slot; the roll modifier must flow from there.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DROWNING_DEEPS, characters: [{ defId: ORC_TRACKER, items: [MAKERS_MAP] }], destinationSite: UNDER_VAULTS }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const mhBase = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };
    const result = reduce(mhBase, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.UnderDeeps });
    expect(result.error).toBeUndefined();
    expect((result.state.phaseState as MovementHazardPhaseState).underDeepsRollRequired).toBe(6);
    expect(trackerId).toBeTruthy();
  });
});
