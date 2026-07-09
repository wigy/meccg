/**
 * @module wh-37.test
 *
 * Card test: A Panoply of Wings (wh-37)
 * Type: hero-resource-faction (wizard, non-unique, 1 MP, influence # 12, Animal)
 *
 * Card text: "Playable at any tapped or untapped non-Haven, non-Shadow-hold,
 * non-Dark-hold site in a Wilderness [{w}] if the influence check is greater
 * than 11. Standard Modifications: if Radagast is your Wizard (+3). Discard
 * this faction to make information playable at such a site."
 *
 * Effects:
 *   1. `playableAt` — a `PlayableAtAny` entry (`{ any: true, when }`): any site
 *      whose type is not haven/shadow-hold/dark-hold and whose region type is
 *      Wilderness. Evaluated in `siteMatchesEntry` (site.ts) with the site's
 *      `site.siteType` + `site.regionType` context. Influence # 12 gives the
 *      "greater than 11" threshold.
 *   2. play-flag "playable-at-tapped-site" — the influence attempt may be made
 *      at a tapped qualifying site.
 *   3. check-modifier influence +3 when the player's Wizard is Radagast
 *      (`controller.wizard`).
 *   4. grant-action "panoply-unlock-information", cost `{ discard: "self" }`,
 *      apply `add-constraint` `site-resource-unlocked` (subtype "information",
 *      scope "turn", target "player") with a compound `siteCondition` (the same
 *      "such a site" selector). While the faction is in play, the controlling
 *      player may discard it during their organization/site phase to unlock
 *      Information at any qualifying site for the rest of the turn.
 *
 * The bearer-less faction discard rides `inPlayFactionGrantActions`
 * (organization.ts) → `handleInPlayCardGrantAction` (grant-action-apply.ts);
 * the generalized `site-resource-unlocked` consumer (`isSiteResourceUnlocked`)
 * evaluates the `siteCondition` against the site.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  makeSitePhase, setCompanySiteStatus,
  firstFactionInfluenceAttempt, viableActions, dispatch,
  findCharInstanceId, expectInDiscardPile,
} from '../test-helpers.js';
import { matchesCondition } from '../../index.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, GameState,
  InfluenceAttemptAction, ActivateGrantedAction,
} from '../../index.js';

const PANOPLY = 'wh-37' as CardDefinitionId;
const RADAGAST = 'tw-178' as CardDefinitionId;             // hero wizard avatar
const LEGOLAS = 'tw-168' as CardDefinitionId;              // hero elf, DI 2 (no Panoply bonus)

const LONELY_MOUNTAIN = 'le-387' as CardDefinitionId;      // ruins-and-lairs in Northern Rhovanion (wilderness) — qualifies
const WELLINGHALL = 'tw-437' as CardDefinitionId;          // free-hold in Fangorn (wilderness) — qualifies (any non-hold type)
const MORIA = 'tw-413' as CardDefinitionId;                // shadow-hold in Redhorn Gate (wilderness) — excluded (type)
const BANDIT_LAIR = 'le-351' as CardDefinitionId;          // ruins-and-lairs in Brown Lands (shadow-land) — excluded (region)
const RIVENDELL = 'tw-421' as CardDefinitionId;            // haven in Rhudaur (wilderness) — excluded (type)
const LORIEN = 'tw-408' as CardDefinitionId;               // hero haven (opponent site)
const ARAGORN = 'tw-120' as CardDefinitionId;              // hero dunadan (opponent filler)

const UNLOCK_ACTION = 'panoply-unlock-information';

/** The influence-attempt for a specific influencing character against a faction. */
function attemptBy(state: GameState, factionId: CardInstanceId, charId: CardInstanceId): InfluenceAttemptAction | undefined {
  return viableActions(state, PLAYER_1, 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .find(a => a.factionInstanceId === factionId && a.influencingCharacterId === charId);
}

/** Hero player holding A Panoply of Wings in hand at `site`, in the site phase. */
function handState(site: CardDefinitionId, chars: CardDefinitionId[] = [LEGOLAS]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site, characters: chars }], hand: [PANOPLY], siteDeck: [RIVENDELL] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
  return { ...base, phaseState: makeSitePhase() };
}

describe('A Panoply of Wings (wh-37)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playability — any non-Haven/non-Shadow-hold/non-Dark-hold Wilderness site ──

  test('influence-attempt is legal at a Ruins & Lairs in a Wilderness (need = 12 - DI)', () => {
    const state = handState(LONELY_MOUNTAIN);
    const factionId = state.players[0].hand[0].instanceId;
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const attempt = attemptBy(state, factionId, legolasId);
    expect(attempt).toBeDefined();
    // influence # 12, Legolas DI 2, no Panoply-specific bonus → need 10 (> 11 threshold).
    expect(attempt!.need).toBe(10);
  });

  test('influence-attempt is legal at a Free-hold in a Wilderness (any non-hold site type)', () => {
    const state = handState(WELLINGHALL);
    const factionId = state.players[0].hand[0].instanceId;
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    expect(attemptBy(state, factionId, legolasId)).toBeDefined();
  });

  test('NOT playable at a Haven (excluded site type, even in a Wilderness)', () => {
    // Put the company at a haven; a hero company at a haven cannot influence
    // this faction because havens are excluded.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [PANOPLY], siteDeck: [LONELY_MOUNTAIN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  test('NOT playable at a Shadow-hold in a Wilderness (excluded site type)', () => {
    const state = handState(MORIA);
    const factionId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  test('NOT playable at a Ruins & Lairs NOT in a Wilderness (wrong region type)', () => {
    const state = handState(BANDIT_LAIR);
    const factionId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  test('playable at a TAPPED qualifying site (playable-at-tapped-site)', () => {
    const base = handState(LONELY_MOUNTAIN);
    const state = setCompanySiteStatus(base, RESOURCE_PLAYER, 0, CardStatus.Tapped);
    const factionId = state.players[0].hand[0].instanceId;
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    expect(attemptBy(state, factionId, legolasId)).toBeDefined();
  });

  // ── Rule 2 (Standard Modification): Radagast is your Wizard (+3) ──

  test('Radagast as your Wizard lowers the required roll by 3', () => {
    const stateA = handState(LONELY_MOUNTAIN);
    const factionA = stateA.players[0].hand[0].instanceId;
    const legolasA = findCharInstanceId(stateA, RESOURCE_PLAYER, LEGOLAS);
    const needWithout = attemptBy(stateA, factionA, legolasA)!.need;

    const stateB = handState(LONELY_MOUNTAIN, [LEGOLAS, RADAGAST]);
    const factionB = stateB.players[0].hand[0].instanceId;
    const legolasB = findCharInstanceId(stateB, RESOURCE_PLAYER, LEGOLAS);
    const needWith = attemptBy(stateB, factionB, legolasB)!.need;

    // Same influencer (Legolas); Radagast avatar in play → +3 to the check → need 3 lower.
    expect(needWithout).toBe(10);
    expect(needWith).toBe(7);
  });

  // ── Rule 3: discard the in-play faction to unlock Information at such a site ──

  /** Hero player with A Panoply of Wings already in play as a controlled faction. */
  function factionInPlayState(site: CardDefinitionId): GameState {
    const panoply: CardInPlay = {
      instanceId: 'panoply-inplay' as CardInstanceId, definitionId: PANOPLY, status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL], cardsInPlay: [panoply] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    return { ...base, phaseState: makeSitePhase() };
  }

  /** The `activate-granted-action` for the Panoply unlock, if offered. */
  function unlockAction(state: GameState): ActivateGrantedAction | undefined {
    return viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as ActivateGrantedAction)
      .find(a => a.actionId === UNLOCK_ACTION);
  }

  test('discard-to-unlock is offered during the site phase while the faction is in play', () => {
    const state = factionInPlayState(LONELY_MOUNTAIN);
    expect(unlockAction(state)).toBeDefined();
  });

  test('discard-to-unlock is NOT offered when the faction is not in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    expect(unlockAction(state)).toBeUndefined();
  });

  test('discarding the faction removes it from play (to the discard pile) and adds the Information unlock', () => {
    const state = factionInPlayState(LONELY_MOUNTAIN);
    const action = unlockAction(state)!;
    const after = dispatch(state, action);

    // Faction left play — no instance lost.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === PANOPLY)).toBe(false);
    expectInDiscardPile(after, RESOURCE_PLAYER, PANOPLY);

    // The site-resource-unlocked constraint is added for the discarding player.
    const constraint = after.activeConstraints.find(c => c.kind.type === 'site-resource-unlocked');
    expect(constraint).toBeDefined();
    const kind = constraint!.kind as { type: 'site-resource-unlocked'; subtype: string; siteCondition?: unknown; siteType?: string };
    expect(kind.subtype).toBe('information');
    expect(kind.siteType).toBeUndefined();          // compound selector, not a single site type
    expect(kind.siteCondition).toBeDefined();
    expect(constraint!.target).toEqual({ kind: 'player', playerId: PLAYER_1 });
  });

  test('the added Information unlock keys exactly to "such a site" (engine condition-matcher)', () => {
    const state = factionInPlayState(LONELY_MOUNTAIN);
    const after = dispatch(state, unlockAction(state)!);
    const constraint = after.activeConstraints.find(c => c.kind.type === 'site-resource-unlocked')!;
    const cond = (constraint.kind as { siteCondition: Parameters<typeof matchesCondition>[0] }).siteCondition;

    const at = (siteType: string, regionType: string) => matchesCondition(cond, { site: { siteType, regionType } });

    // Any non-hold site type in a Wilderness qualifies.
    expect(at('ruins-and-lairs', 'wilderness')).toBe(true);
    expect(at('free-hold', 'wilderness')).toBe(true);
    expect(at('border-hold', 'wilderness')).toBe(true);
    // Excluded site types (even in a Wilderness).
    expect(at('haven', 'wilderness')).toBe(false);
    expect(at('shadow-hold', 'wilderness')).toBe(false);
    expect(at('dark-hold', 'wilderness')).toBe(false);
    // Right type, wrong region.
    expect(at('ruins-and-lairs', 'shadow')).toBe(false);
    expect(at('free-hold', 'border')).toBe(false);
  });
});
