/**
 * @module le-243.test
 *
 * Card test: Thing Stolen (le-243)
 * Type: minion-resource-event (short, ringwraith alignment), MP 0.
 *
 * Text: "Playable after a faction is successfully played at a Shadow-hold
 * [{S}] or Dark-hold [{D}]. Tap a character at the site to play a
 * non-unique, non-hoard minor or major item (even if the item is not
 * normally playable there)."
 *
 * Effects & engine support:
 * | # | Rule                                              | Mechanism                                                        |
 * |---|----------------------------------------------------|------------------------------------------------------------------|
 * | 1 | Playable during the site phase at a Shadow-hold    | `play-window` `phase: "site"`, `siteTypes: ["shadow-hold",       |
 * |   | or Dark-hold                                       | "dark-hold"]`                                                     |
 * | 2 | …after a faction is successfully played there      | `play-condition` `requires: "active-company"`,                   |
 * |   |                                                    | `condition: { "company.factionPlayedAtSite": true }` —           |
 * |   |                                                    | `SitePhaseState.factionPlayedAtSite`, set only in the             |
 * |   |                                                    | successful-influence-attempt branch of                            |
 * |   |                                                    | `resolveInfluenceAttemptRoll` (never on an ally play, unlike its  |
 * |   |                                                    | sibling `allyOrFactionPlayedAtSite`)                              |
 * | 3 | Tap a character at the site to play a non-unique,  | `on-event: self-enters-play` → `set-site-phase-flag`              |
 * |   | non-hoard minor or major item, even if not         | (`stolenItemUnlocked`), consulted by `legal-actions/site.ts` and  |
 * |   | normally playable there                            | `reducer-site.ts` (mirrors the War-forges wh-83 bonus-item unlock |
 * |   |                                                    | but widened to major items; the bearer is tapped by the ordinary  |
 * |   |                                                    | item-play mechanics — no separate tap cost to model)              |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LORIEN, MINAS_TIRITH,
  buildSitePhaseState, buildTestState, resetMint,
  viableActions, viableActionsForHandCard,
  findHandCardId, getCharacter,
  dispatch,
  CardStatus, Phase,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type {
  CardDefinitionId, GameState, SitePhaseState,
  PlayShortEventAction, PlayHeroResourceAction,
} from '../../index.js';
import { resolveInfluenceAttemptRoll } from '../../engine/reducer-site.js';

const THING_STOLEN = 'le-243' as CardDefinitionId;

/** Minion character (le-18), used as the sole company member. */
const LAGDUF = 'le-18' as CardDefinitionId;

/** Minion Shadow-hold with empty `playableResources` (le-394). */
const MOUNT_GRAM = 'le-394' as CardDefinitionId;

/** Minion Dark-hold with empty `playableResources` (le-361). */
const CIRITH_GORGOR = 'le-361' as CardDefinitionId;

/** Minion Darkhaven (le-390) — not a Shadow-hold or Dark-hold. */
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

/** Minion faction (le-286), playable at any Shadow-hold, influence# 10. */
const SNAGA_HAI = 'le-286' as CardDefinitionId;

/** Non-unique, non-hoard minor item (le-302). */
const BLAZON_OF_THE_EYE = 'le-302' as CardDefinitionId;

/** A second copy-distinct non-unique, non-hoard minor item, for the one-shot test. */
const FOUL_SMELLING_PASTE = 'le-310' as CardDefinitionId;

/** Non-unique, non-hoard major item (le-301). */
const BLACK_MAIL_COAT = 'le-301' as CardDefinitionId;

/** Non-unique, non-hoard greater item (le-299) — wrong subtype, must stay blocked. */
const BLACK_MACE = 'le-299' as CardDefinitionId;

/** Non-unique hoard minor item (as-129) — must stay blocked. */
const OLD_TREASURE = 'as-129' as CardDefinitionId;

/** Unique major item (le-313) — must stay blocked. */
const HIGH_HELM = 'le-313' as CardDefinitionId;

/** Build a Ringwraith site-phase state with Lagduf's company at `site`. */
function ringwraithSiteState(site: CardDefinitionId, hand: CardDefinitionId[]): GameState {
  return buildSitePhaseState({
    alignment: Alignment.Ringwraith,
    site,
    characters: [LAGDUF],
    hand,
  });
}

/** Force `factionPlayedAtSite` (and, optionally, `stolenItemUnlocked`) open directly. */
function withFactionPlayedAtSite(state: GameState, extra?: Partial<SitePhaseState>): GameState {
  const siteState = state.phaseState as SitePhaseState;
  return { ...state, phaseState: { ...siteState, factionPlayedAtSite: true, ...extra } };
}

describe('Thing Stolen (le-243)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: play-window — site phase, Shadow-hold or Dark-hold only ──

  test('NOT offered during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_GRAM, characters: [LAGDUF] }], hand: [THING_STOLEN], siteDeck: [CIRITH_GORGOR] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  test('NOT offered at a Darkhaven (not a Shadow-hold or Dark-hold), even with the faction window forced open', () => {
    const state = withFactionPlayedAtSite(ringwraithSiteState(MINAS_MORGUL, [THING_STOLEN]));
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  // ── Rule 2: play-condition — requires a faction successfully played here ──

  test('NOT offered at a Shadow-hold before any faction has been played', () => {
    const state = ringwraithSiteState(MOUNT_GRAM, [THING_STOLEN]);
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  test('NOT offered when only an ally (not a faction) has been played at the site', () => {
    // allyOrFactionPlayedAtSite is the broader sibling flag; le-243 must key
    // specifically off factionPlayedAtSite, not the ally-inclusive one.
    const base = ringwraithSiteState(MOUNT_GRAM, [THING_STOLEN]);
    const state = { ...base, phaseState: { ...(base.phaseState as SitePhaseState), allyOrFactionPlayedAtSite: true } };
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  test('offered at a Shadow-hold (Mount Gram) once a faction has been played there', () => {
    const state = withFactionPlayedAtSite(ringwraithSiteState(MOUNT_GRAM, [THING_STOLEN]));
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(1);
  });

  test('offered at a Dark-hold (Cirith Gorgor) once a faction has been played there', () => {
    const state = withFactionPlayedAtSite(ringwraithSiteState(CIRITH_GORGOR, [THING_STOLEN]));
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(1);
  });

  // ── Rule 2, real flow: a successful faction influence attempt opens the window ──

  test('a successful faction influence attempt at a Shadow-hold sets factionPlayedAtSite', () => {
    const base = ringwraithSiteState(MOUNT_GRAM, [SNAGA_HAI]);
    const factionCard = base.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === SNAGA_HAI)!;
    const lagdufId = getCharacter(base, RESOURCE_PLAYER, LAGDUF).instanceId;

    const result = resolveInfluenceAttemptRoll(
      { ...base, cheatRollTotal: 12 }, // 12 >= influence# 10 -> success
      { card: factionCard, declaredBy: PLAYER_1, payload: { type: 'influence-attempt', influencingCharacterId: lagdufId } },
    );

    expect(result.state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SNAGA_HAI)).toBe(true);
    expect((result.state.phaseState as SitePhaseState).factionPlayedAtSite).toBe(true);
  });

  test('a failed faction influence attempt does NOT set factionPlayedAtSite', () => {
    const base = ringwraithSiteState(MOUNT_GRAM, [SNAGA_HAI]);
    const factionCard = base.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === SNAGA_HAI)!;
    const lagdufId = getCharacter(base, RESOURCE_PLAYER, LAGDUF).instanceId;

    const result = resolveInfluenceAttemptRoll(
      { ...base, cheatRollTotal: 2 }, // 2 < influence# 10 -> failure
      { card: factionCard, declaredBy: PLAYER_1, payload: { type: 'influence-attempt', influencingCharacterId: lagdufId } },
    );

    expect(result.state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SNAGA_HAI)).toBe(false);
    expect((result.state.phaseState as SitePhaseState).factionPlayedAtSite).toBeFalsy();
  });

  // ── Rule 3: playing the event unlocks the bonus item (stolenItemUnlocked) ──

  test('playing the event sets stolenItemUnlocked in phaseState', () => {
    const state = withFactionPlayedAtSite(ringwraithSiteState(MOUNT_GRAM, [THING_STOLEN]));
    const eventInstance = findHandCardId(state, RESOURCE_PLAYER, THING_STOLEN);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === eventInstance);
    expect(playActions).toHaveLength(1);

    const next = dispatch(state, playActions[0]);
    expect((next.phaseState as SitePhaseState).stolenItemUnlocked).toBe(true);
  });

  // ── Rule 3: bonus item allowance — minor and major items bypass playableResources ──

  test('minor item playable at a Shadow-hold with empty playableResources once unlocked', () => {
    const state = withFactionPlayedAtSite(ringwraithSiteState(MOUNT_GRAM, [BLAZON_OF_THE_EYE]), { stolenItemUnlocked: true });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBeGreaterThanOrEqual(1);
  });

  test('major item playable at a Shadow-hold with empty playableResources once unlocked', () => {
    const state = withFactionPlayedAtSite(ringwraithSiteState(MOUNT_GRAM, [BLACK_MAIL_COAT]), { stolenItemUnlocked: true });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBeGreaterThanOrEqual(1);
  });

  test('minor item NOT playable at the same site without the unlock', () => {
    const state = withFactionPlayedAtSite(ringwraithSiteState(MOUNT_GRAM, [BLAZON_OF_THE_EYE]));
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ── Rule 3: exclusions — greater, hoard, and unique items stay blocked ──

  test('greater item NOT unlocked (only minor or major qualify)', () => {
    const state = withFactionPlayedAtSite(ringwraithSiteState(MOUNT_GRAM, [BLACK_MACE]), { stolenItemUnlocked: true });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('hoard item NOT unlocked (card text requires non-hoard)', () => {
    const state = withFactionPlayedAtSite(ringwraithSiteState(MOUNT_GRAM, [OLD_TREASURE]), { stolenItemUnlocked: true });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('unique item NOT unlocked (card text requires non-unique)', () => {
    const state = withFactionPlayedAtSite(ringwraithSiteState(MOUNT_GRAM, [HIGH_HELM]), { stolenItemUnlocked: true });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ── Rule 3: the unlock allows exactly one bonus item ──

  test('stolenItemUnlocked is consumed after one bonus item is played, blocking a second', () => {
    const state = withFactionPlayedAtSite(
      ringwraithSiteState(MOUNT_GRAM, [BLAZON_OF_THE_EYE, FOUL_SMELLING_PASTE]),
      { stolenItemUnlocked: true },
    );

    const firstActions = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLAZON_OF_THE_EYE);
    expect(firstActions).toHaveLength(1);

    const afterFirst = dispatch(state, firstActions[0].action);
    expect((afterFirst.phaseState as SitePhaseState).stolenItemPlayed).toBe(true);

    // The second minor item no longer qualifies for the (now-consumed) bonus.
    expect(viableActions(afterFirst, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ── Full flow: play the event, then play a bonus item, attached to the character ──

  test('full flow: event played at Mount Gram unlocks a minor item, which attaches to Lagduf', () => {
    const state = withFactionPlayedAtSite(ringwraithSiteState(MOUNT_GRAM, [THING_STOLEN, BLAZON_OF_THE_EYE]));

    // Item is not playable without the event.
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLAZON_OF_THE_EYE)).toHaveLength(0);

    const eventInstance = findHandCardId(state, RESOURCE_PLAYER, THING_STOLEN);
    const eventActions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === eventInstance);
    expect(eventActions).toHaveLength(1);
    const afterEvent = dispatch(state, eventActions[0]);
    expect((afterEvent.phaseState as SitePhaseState).stolenItemUnlocked).toBe(true);

    const itemActions = viableActionsForHandCard(afterEvent, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLAZON_OF_THE_EYE);
    expect(itemActions).toHaveLength(1);
    const afterItem = dispatch(afterEvent, (itemActions[0].action as PlayHeroResourceAction));

    expect(getCharacter(afterItem, RESOURCE_PLAYER, LAGDUF).items.map(i => i.definitionId)).toEqual([BLAZON_OF_THE_EYE]);
    expect((afterItem.phaseState as SitePhaseState).stolenItemPlayed).toBe(true);
  });

  // ── The bonus item does not additionally tap an already-untapped site ──

  test('playing the bonus item does not leave the site newly tapped beyond its prior state', () => {
    const state = withFactionPlayedAtSite(ringwraithSiteState(MOUNT_GRAM, [BLAZON_OF_THE_EYE]), { stolenItemUnlocked: true });
    expect(state.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(1);
    const next = dispatch(state, actions[0].action);

    expect(next.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
  });
});
