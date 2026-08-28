/**
 * @module wh-83.test
 *
 * Card test: War-forges (wh-83)
 * Type: minion-resource-event (permanent) · alignment: stage · Stage resource
 *
 * Card text:
 *   "Playable on one of your protected Wizardhavens [{H}] (not by Radagast).
 *    You may tap War-forges to make an additional non-hoard, non-unique minor
 *    item playable at this site this turn (if the site is tapped or not). The
 *    item may be taken from your discard pile or sideboard. Discard when this
 *    site is discarded or returned to your location deck. Cannot be
 *    duplicated on a given site."
 *
 * Modelled effects (see `data/wh-resources.json`):
 *  - `stage-points: 2` — contributes 2 stage points to a Fallen-wizard who has
 *    it in play.
 *  - `play-target` site `{ effectiveSiteType: "haven" }` — playable on a
 *    Wizardhaven; the play binds the card to that site (`attachedToSite`).
 *  - `play-condition` `requires: 'site-protected'` — the site must already
 *    carry an active `site-protected` constraint owned by the player.
 *  - `play-condition` player-state `{ player.avatar: { $ne: "Radagast" } }` —
 *    "not by Radagast".
 *  - `duplication-limit` scope `site` — "Cannot be duplicated on a given
 *    site."
 *  - `grant-action` `action: "war-forges-unlock-item"`, `cost: { tap: "self"
 *    }`, `apply: add-constraint war-forges-item-unlocked` (scope `turn`,
 *    targeted at the controlling player): unlike Saruman's Machinery
 *    (wh-120), which unlocks automatically on entering play, War-forges'
 *    unlock is TAP-ACTIVATED. While active, one non-hoard, non-unique minor
 *    item may be played at the bound site this site phase whether the site is
 *    tapped or untapped, sourced from hand, the discard pile (`fromDiscard`),
 *    or the sideboard (`fromSideboard`). `SitePhaseState.warForgesItemPlayed`
 *    tracks the one-per-site-phase consumption; the played item does not tap
 *    the site.
 *  - `discardOrphanedSiteAttachedEvents` discards the card and clears its
 *    constraints once no company occupies the bound site.
 *
 * | #  | Rule                                                          | Status |
 * |----|----------------------------------------------------------------|--------|
 * | 1  | carries 2 stage points while in play                          | OK     |
 * | 2  | playable on a protected Wizardhaven, not by Radagast           | OK     |
 * | 3  | NOT playable without site protection                          | OK     |
 * | 4  | NOT playable when your avatar is Radagast                     | OK     |
 * | 5  | NOT playable at a non-haven site                               | OK     |
 * | 6  | playing it binds the card to the site (no automatic unlock)    | OK     |
 * | 7  | cannot be duplicated on a given site                           | OK     |
 * | 8  | tap grant-action offered only while untapped and in play       | OK     |
 * | 9  | activation taps it and adds the item-unlock constraint         | OK     |
 * | 10 | without the unlock, a minor item is not playable at a tapped   | OK     |
 * |    | site                                                            |        |
 * | 11 | with the unlock, a minor item becomes playable at a tapped site| OK     |
 * | 12 | a unique minor item is NOT unlocked                            | OK     |
 * | 13 | a hoard minor item is NOT unlocked                             | OK     |
 * | 14 | a major item is NOT unlocked                                   | OK     |
 * | 15 | the unlock is scoped to its own bound site                     | OK     |
 * | 16 | the item may be taken from the discard pile                    | OK     |
 * | 17 | the item may be taken from the sideboard, moving it to the     | OK     |
 * |    | character and leaving the site untapped                        |        |
 * | 18 | only ONE bonus item playable per site phase                    | OK     |
 * | 19 | discard (and constraint clear) when the bound site leaves play | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { CardStatus, computeLegalActions } from '../../index.js';
import type {
  ActivateGrantedAction, CardDefinitionId, CardInPlay, CardInstance, CardInstanceId, ConstraintId, GameState, PlayerId,
} from '../../index.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import {
  PLAYER_1, RESOURCE_PLAYER, resetMint, mint, viableActions, findHandCardId, dispatch,
  buildFallenWizardSitePhaseState, buildFallenWizardOrgPhaseState, playPermanentEventAndResolve,
  MINAS_TIRITH,
} from '../test-helpers.js';

const WAR_FORGES = 'wh-83' as CardDefinitionId;
const ISENGARD_WH = 'wh-56' as CardDefinitionId; // FW Wizardhaven, non-Radagast-specific

// Fallen-wizard avatars.
const SARUMAN_FW = 'wh-9' as CardDefinitionId;  // qualifies ("not by Radagast")
const RADAGAST_FW = 'wh-8' as CardDefinitionId; // does NOT qualify

// A non-haven Fallen-wizard site (Ruins & Lairs) for the {H} gate.
const DEEP_MINES = 'wh-55' as CardDefinitionId;

// Minion items for the bonus-item filter.
const BLACK_HIDE_SHIELD = 'le-300' as CardDefinitionId; // minor, non-unique, no hoard — eligible
const THRORS_MAP = 'as-134' as CardDefinitionId;        // minor, UNIQUE — excluded
const OLD_TREASURE = 'as-129' as CardDefinitionId;      // minor, hoard — excluded
const BLACK_MAIL_COAT = 'le-301' as CardDefinitionId;   // major — excluded (wrong subtype)

/** A `site-protected` constraint owned by `owner`, bound to `siteDefId`. */
function siteProtectedConstraint(owner: PlayerId, siteDefId: CardDefinitionId) {
  return {
    id: `protected-${siteDefId as string}` as ConstraintId,
    source: 'protected-src' as CardInstance['instanceId'],
    sourceDefinitionId: 'wh-74' as CardDefinitionId,
    scope: { kind: 'until-cleared' as const },
    target: { kind: 'player' as const, playerId: owner },
    kind: { type: 'site-flag' as const, flag: 'site-protected' as const, siteDefinitionId: siteDefId },
  };
}

/** A `war-forges-item-unlocked` constraint owned by `owner`, bound to `siteDefId`. */
function warForgesUnlockConstraint(owner: PlayerId, siteDefId: CardDefinitionId) {
  return {
    id: `wf-unlock-${siteDefId as string}` as ConstraintId,
    source: 'war-forges-src' as CardInstance['instanceId'],
    sourceDefinitionId: WAR_FORGES,
    scope: { kind: 'turn' as const },
    target: { kind: 'player' as const, playerId: owner },
    kind: { type: 'site-flag' as const, flag: 'war-forges-item-unlocked' as const, siteDefinitionId: siteDefId },
  };
}

/** Organization-phase state for playing War-forges itself, plus optional protection. */
function warForgesOrgState(opts: {
  site?: CardDefinitionId;
  avatar?: CardDefinitionId;
  hand?: CardDefinitionId[];
  protectedFor?: PlayerId;
}): GameState {
  const site = opts.site ?? ISENGARD_WH;
  const base = buildFallenWizardOrgPhaseState({
    site,
    characters: [opts.avatar ?? SARUMAN_FW],
    hand: opts.hand ?? [WAR_FORGES],
  });
  return opts.protectedFor !== undefined
    ? { ...base, activeConstraints: [siteProtectedConstraint(opts.protectedFor, site)] }
    : base;
}

/** Site-phase state with an optional War-forges unlock constraint active. */
function warForgesSiteState(opts: {
  site?: CardDefinitionId;
  avatar?: CardDefinitionId;
  hand?: CardDefinitionId[];
  siteStatus?: CardStatus;
  unlockAtSite?: CardDefinitionId;
}): GameState {
  const site = opts.site ?? ISENGARD_WH;
  const base = buildFallenWizardSitePhaseState({
    site,
    characters: [opts.avatar ?? SARUMAN_FW],
    hand: opts.hand ?? [],
    siteStatus: opts.siteStatus,
  });
  return opts.unlockAtSite !== undefined
    ? { ...base, activeConstraints: [warForgesUnlockConstraint(PLAYER_1, opts.unlockAtSite)] }
    : base;
}

/** A `CardInPlay` entry for War-forges bound to `siteDefId`. */
function warForgesInPlay(siteDefId: CardDefinitionId, status: CardStatus = CardStatus.Untapped): CardInPlay {
  return { instanceId: mint(), definitionId: WAR_FORGES, status, attachedToSite: siteDefId };
}

function addP1CardsInPlay(state: GameState, cards: CardInPlay[]): GameState {
  const [p1, p2] = state.players;
  return { ...state, players: [{ ...p1, cardsInPlay: [...p1.cardsInPlay, ...cards] }, p2] as GameState['players'] };
}

/** Whether a viable play action exists for `instanceId` (item or permanent event). */
function canPlay(state: GameState, player: PlayerId, instanceId: CardInstanceId): boolean {
  return computeLegalActions(state, player).some(
    a => a.viable
      && (a.action.type === 'play-hero-resource' || a.action.type === 'play-permanent-event')
      && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === instanceId,
  );
}

describe('War-forges (wh-83)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: 2 stage points while in play ────────────────────────────────

  test('contributes 2 stage points to a Fallen-wizard who has it in play', () => {
    const state = buildFallenWizardOrgPhaseState({ site: ISENGARD_WH, characters: [SARUMAN_FW] });
    const withCard = addP1CardsInPlay(state, [warForgesInPlay(ISENGARD_WH)]);
    const recomputed = recomputeDerived(withCard);
    expect(recomputed.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  // ── Rules 2-5: play restrictions ─────────────────────────────────────────

  test('playable on a protected Wizardhaven while your avatar is not Radagast', () => {
    const state = warForgesOrgState({ protectedFor: PLAYER_1 });
    expect(canPlay(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, WAR_FORGES))).toBe(true);
  });

  test('NOT playable without site protection', () => {
    const state = warForgesOrgState({});
    expect(canPlay(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, WAR_FORGES))).toBe(false);
  });

  test('NOT playable when your avatar is Radagast, even at a protected Wizardhaven', () => {
    const state = warForgesOrgState({ avatar: RADAGAST_FW, protectedFor: PLAYER_1 });
    expect(canPlay(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, WAR_FORGES))).toBe(false);
  });

  test('NOT playable at a non-haven site, even if protected', () => {
    const state = warForgesOrgState({ site: DEEP_MINES, protectedFor: PLAYER_1 });
    expect(canPlay(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, WAR_FORGES))).toBe(false);
  });

  // ── Rule 6: binds to the site, no automatic unlock ──────────────────────

  test('playing it binds the card to the site and does NOT automatically add the item-unlock constraint', () => {
    const state = warForgesOrgState({ protectedFor: PLAYER_1 });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, WAR_FORGES), undefined,
      { targetSiteDefinitionId: ISENGARD_WH },
    );
    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === WAR_FORGES);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(ISENGARD_WH);
    expect(inPlay!.status).toBe(CardStatus.Untapped);
    expect(after.activeConstraints.some(c => c.kind.type === 'site-flag' && c.kind.flag === 'war-forges-item-unlocked')).toBe(false);
  });

  // ── Rule 7: cannot be duplicated on a given site ────────────────────────

  test('cannot be duplicated on a given site', () => {
    const base = warForgesOrgState({ hand: [WAR_FORGES], protectedFor: PLAYER_1 });
    const withCopy: GameState = {
      ...base,
      players: [
        { ...base.players[RESOURCE_PLAYER], cardsInPlay: [warForgesInPlay(ISENGARD_WH)] },
        base.players[1],
      ] as GameState['players'],
    };
    expect(canPlay(withCopy, PLAYER_1, findHandCardId(withCopy, RESOURCE_PLAYER, WAR_FORGES))).toBe(false);
  });

  // ── Rules 8-9: the tap grant-action ──────────────────────────────────────

  test('the unlock grant-action is offered while War-forges is untapped and in play', () => {
    const base = buildFallenWizardSitePhaseState({ site: ISENGARD_WH, characters: [SARUMAN_FW], hand: [] });
    const state = addP1CardsInPlay(base, [warForgesInPlay(ISENGARD_WH)]);
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'war-forges-unlock-item');
    expect(actions).toHaveLength(1);
  });

  test('the unlock grant-action is NOT offered while War-forges is tapped', () => {
    const base = buildFallenWizardSitePhaseState({ site: ISENGARD_WH, characters: [SARUMAN_FW], hand: [] });
    const state = addP1CardsInPlay(base, [warForgesInPlay(ISENGARD_WH, CardStatus.Tapped)]);
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'war-forges-unlock-item');
    expect(actions).toHaveLength(0);
  });

  test('activating it taps War-forges in place and adds a turn-scoped item-unlock constraint bound to its site', () => {
    const base = buildFallenWizardSitePhaseState({ site: ISENGARD_WH, characters: [SARUMAN_FW], hand: [] });
    const state = addP1CardsInPlay(base, [warForgesInPlay(ISENGARD_WH)]);
    const activate = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'war-forges-unlock-item')!;
    expect(activate).toBeDefined();
    const after = dispatch(state, activate.action);

    const cip = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === WAR_FORGES)!;
    expect(cip.status).toBe(CardStatus.Tapped);

    const constraint = after.activeConstraints.find(
      c => c.kind.type === 'site-flag' && c.kind.flag === 'war-forges-item-unlocked' && c.kind.siteDefinitionId === ISENGARD_WH,
    );
    expect(constraint).toBeDefined();
    expect(constraint!.scope.kind).toBe('turn');
    expect(constraint!.target.kind).toBe('player');
    expect((constraint!.target as { playerId?: PlayerId }).playerId).toBe(PLAYER_1);
  });

  // ── Rules 10-15: the bonus item unlock ──────────────────────────────────

  test('without the unlock, a minor item is NOT playable at a tapped site', () => {
    const state = warForgesSiteState({ hand: [BLACK_HIDE_SHIELD], siteStatus: CardStatus.Tapped });
    expect(canPlay(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, BLACK_HIDE_SHIELD))).toBe(false);
  });

  test('with the unlock active, a non-hoard non-unique minor item becomes playable at a tapped site', () => {
    const state = warForgesSiteState({ hand: [BLACK_HIDE_SHIELD], siteStatus: CardStatus.Tapped, unlockAtSite: ISENGARD_WH });
    expect(canPlay(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, BLACK_HIDE_SHIELD))).toBe(true);
  });

  test('a unique minor item is NOT unlocked', () => {
    const state = warForgesSiteState({ hand: [THRORS_MAP], siteStatus: CardStatus.Tapped, unlockAtSite: ISENGARD_WH });
    expect(canPlay(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, THRORS_MAP))).toBe(false);
  });

  test('a hoard minor item is NOT unlocked', () => {
    const state = warForgesSiteState({ hand: [OLD_TREASURE], siteStatus: CardStatus.Tapped, unlockAtSite: ISENGARD_WH });
    expect(canPlay(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, OLD_TREASURE))).toBe(false);
  });

  test('a major item is NOT unlocked (wrong subtype)', () => {
    const state = warForgesSiteState({ hand: [BLACK_MAIL_COAT], siteStatus: CardStatus.Tapped, unlockAtSite: ISENGARD_WH });
    expect(canPlay(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, BLACK_MAIL_COAT))).toBe(false);
  });

  test('the unlock is scoped to its own bound site — no effect at a different site', () => {
    const state = warForgesSiteState({
      site: ISENGARD_WH, hand: [BLACK_HIDE_SHIELD], siteStatus: CardStatus.Tapped, unlockAtSite: MINAS_TIRITH,
    });
    expect(canPlay(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, BLACK_HIDE_SHIELD))).toBe(false);
  });

  // ── Rules 16-17: sourced from the discard pile or sideboard ────────────

  test('a matching item in the discard pile is playable via the unlock (fromDiscard)', () => {
    const base = warForgesSiteState({ hand: [], siteStatus: CardStatus.Tapped, unlockAtSite: ISENGARD_WH });
    const discardCard: CardInstance = { instanceId: mint(), definitionId: BLACK_HIDE_SHIELD };
    const [p1, p2] = base.players;
    const state: GameState = { ...base, players: [{ ...p1, discardPile: [...p1.discardPile, discardCard] }, p2] as GameState['players'] };

    const actions = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: string }).cardInstanceId === discardCard.instanceId,
    );
    expect(actions).toHaveLength(1);
    expect((actions[0].action as { fromDiscard?: boolean }).fromDiscard).toBe(true);
  });

  test('a matching item in the sideboard is playable via the unlock (fromSideboard); resolving it moves the item to the character and leaves the site untapped', () => {
    const base = warForgesSiteState({ hand: [], siteStatus: CardStatus.Untapped, unlockAtSite: ISENGARD_WH });
    const sideboardCard: CardInstance = { instanceId: mint(), definitionId: BLACK_HIDE_SHIELD };
    const [p1, p2] = base.players;
    const state: GameState = { ...base, players: [{ ...p1, sideboard: [...p1.sideboard, sideboardCard] }, p2] as GameState['players'] };

    const action = computeLegalActions(state, PLAYER_1).find(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: string }).cardInstanceId === sideboardCard.instanceId,
    );
    expect(action).toBeDefined();
    expect((action!.action as { fromSideboard?: boolean }).fromSideboard).toBe(true);

    const after = dispatch(state, action!.action);
    expect(after.players[RESOURCE_PLAYER].sideboard.some(c => c.instanceId === sideboardCard.instanceId)).toBe(false);
    const saruman = after.players[RESOURCE_PLAYER].characters[
      after.players[RESOURCE_PLAYER].companies[0].characters[0]
    ];
    expect(saruman.items.some(i => i.definitionId === BLACK_HIDE_SHIELD)).toBe(true);

    // "Whether the site is tapped or untapped" — the bonus item does not tap the site.
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
    expect((after.phaseState as { warForgesItemPlayed?: boolean }).warForgesItemPlayed).toBe(true);
  });

  // ── Rule 18: only ONE bonus item per site phase ─────────────────────────

  test('only ONE bonus item is playable per site phase', () => {
    const state = warForgesSiteState({
      hand: [BLACK_HIDE_SHIELD, BLACK_HIDE_SHIELD], siteStatus: CardStatus.Tapped, unlockAtSite: ISENGARD_WH,
    });
    const copies = state.players[RESOURCE_PLAYER].hand.filter(c => c.definitionId === BLACK_HIDE_SHIELD);
    expect(copies).toHaveLength(2);

    const action = computeLegalActions(state, PLAYER_1).find(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: string }).cardInstanceId === copies[0].instanceId,
    )!;
    const after = dispatch(state, action.action);
    expect((after.phaseState as { warForgesItemPlayed?: boolean }).warForgesItemPlayed).toBe(true);

    const remaining = after.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === BLACK_HIDE_SHIELD)!;
    expect(canPlay(after, PLAYER_1, remaining.instanceId)).toBe(false);
  });

  // ── Rule 19: discard when the bound site leaves play ────────────────────

  test('persists while a company occupies the bound site', () => {
    const state = warForgesOrgState({ protectedFor: PLAYER_1 });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, WAR_FORGES), undefined,
      { targetSiteDefinitionId: ISENGARD_WH },
    );
    const swept = discardOrphanedSiteAttachedEvents(after);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === WAR_FORGES)).toBe(true);
  });

  test('the card and its unlock constraint are discarded once the bound site leaves play', () => {
    const base = buildFallenWizardSitePhaseState({ site: ISENGARD_WH, characters: [SARUMAN_FW], hand: [] });
    let state = addP1CardsInPlay(base, [warForgesInPlay(ISENGARD_WH)]);
    const sourceId = state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === WAR_FORGES)!.instanceId;
    state = {
      ...state,
      activeConstraints: [{
        id: 'wf-unlock-live' as ConstraintId,
        source: sourceId,
        sourceDefinitionId: WAR_FORGES,
        scope: { kind: 'turn' as const },
        target: { kind: 'player' as const, playerId: PLAYER_1 },
        kind: { type: 'site-flag' as const, flag: 'war-forges-item-unlocked' as const, siteDefinitionId: ISENGARD_WH },
      }],
    };
    expect(state.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(1);

    // The company leaves Isengard for a different site.
    const movedCompany = {
      ...state.players[RESOURCE_PLAYER].companies[0],
      currentSite: { ...state.players[RESOURCE_PLAYER].companies[0].currentSite!, definitionId: MINAS_TIRITH },
    };
    const moved: GameState = {
      ...state,
      players: [{ ...state.players[RESOURCE_PLAYER], companies: [movedCompany] }, state.players[1]] as GameState['players'],
    };

    const swept = discardOrphanedSiteAttachedEvents(moved);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === WAR_FORGES)).toBe(false);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === WAR_FORGES)).toBe(true);
    expect(swept.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(0);
  });
});
