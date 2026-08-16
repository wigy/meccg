/**
 * @module wh-120.test
 *
 * Card test: Saruman's Machinery (wh-120)
 * Type: minion-resource-event (permanent) · alignment: stage · Stage resource
 *
 * Card text:
 *   "Saruman specific. Playable, if you are Saruman, on your protected Isengard
 *    or your protected The White Towers. One Technology item is playable at the
 *    site during your site phase whether the site is tapped or untapped. Discard
 *    when this site is discarded or returned to your location deck. Cannot be
 *    duplicated on a given site."
 *
 * Modelled effects (see `data/wh-resources.json`):
 *  - `marshallingPoints: 1` (miscellaneous) — printed MP value (top-left
 *    diamond on the card), independent of its stage points.
 *  - `stage-points: 4` — contributes 4 stage points to a Fallen-wizard who has
 *    it in play (summed by `recompute-derived`).
 *  - `play-target` site `{ name: { $in: ["Isengard", "The White Towers"] } }` —
 *    only offered while the active company is at Isengard / The White Towers;
 *    the play binds the card to that site (`attachedToSite`).
 *  - `play-condition` player-state `{ player.avatar: "Saruman" }` — "if you are
 *    Saruman".
 *  - `play-condition` `requires: 'site-protected'` — the site must already carry
 *    an active `site-protected` constraint owned by the player ("your protected
 *    Isengard / The White Towers"; protection comes from The Fortress of Isen
 *    wh-68 / Fortress of the Towers wh-69).
 *  - `duplication-limit` scope `site` — "Cannot be duplicated on a given site."
 *  - `self-enters-play → add-constraint technology-item-unlocked` (scope
 *    until-cleared, targeted at the controlling player): one Technology-keyword
 *    item may be played at the bound site this site phase whether the site is
 *    tapped or untapped (bypassing the site-tap precondition and the item's own
 *    `item-play-site` restriction). The one-per-site-phase limit is tracked by
 *    `SitePhaseState.technologyItemPlayed`; the played item does not tap the
 *    site and does not count as the company's tapping resource.
 *  - `discardOrphanedSiteAttachedEvents` discards the card and clears its
 *    constraint once no company occupies the bound site.
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 0 | worth 1 (miscellaneous) marshalling point                    | OK     |
 * | 1 | carries 4 stage points (Fallen-wizard only)                   | OK     |
 * | 2 | Saruman specific — playable only if your avatar is Saruman    | OK     |
 * | 3 | playable only on Isengard or The White Towers                 | OK     |
 * | 4 | the site must be protected (for the player)                   | OK     |
 * | 5 | playing it binds it to the site + adds the unlock constraint  | OK     |
 * | 6 | one Technology item becomes playable at the (haven) site      | OK     |
 * | 7 | …whether the site is tapped or untapped                       | OK     |
 * | 8 | only Technology-keyword items are unlocked                    | OK     |
 * | 9 | exactly one Technology item per site phase                    | OK     |
 * |10 | the Technology item does not tap the site                    | OK     |
 * |11 | cannot be duplicated on a given site                         | OK     |
 * |12 | discard when the bound site leaves play                      | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, CardStatus, computeLegalActions, reduce } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, ConstraintId, GameState, PlayerId } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import {
  buildTestState, buildFallenWizardSitePhaseState, buildFallenWizardOrgPhaseState, resetMint, viableActions, pool, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, RIVENDELL, MINAS_TIRITH, ARAGORN,
  playPermanentEventAndResolve,
} from '../test-helpers.js';

const SARUMANS_MACHINERY = 'wh-120' as CardDefinitionId;
const ISENGARD_WH = 'wh-56' as CardDefinitionId;        // FW Wizardhaven "Isengard"
const WHITE_TOWERS_WH = 'wh-58' as CardDefinitionId;    // FW Wizardhaven "The White Towers"
const RHOSGOBEL_WH = 'wh-57' as CardDefinitionId;       // FW Wizardhaven, but NOT a valid site for this card

// Fallen-wizard avatars.
const SARUMAN_FW = 'wh-9' as CardDefinitionId;          // qualifies ("if you are Saruman")
const ALATAR_FW = 'wh-1' as CardDefinitionId;           // does NOT qualify
const GANDALF_FW = 'wh-4' as CardDefinitionId;          // does NOT qualify

const ASTERNAK = 'le-1' as CardDefinitionId;            // Man — keeps the company non-empty without an avatar

// Technology-keyword item (real card) and a non-Technology minion item.
const BLASTING_FIRE = 'wh-51' as CardDefinitionId;      // minion item, keyword "technology"
const BLACK_MAIL_COAT = 'le-301' as CardDefinitionId;   // minion major item, NOT Technology
const MECHANICAL_BOW = 'wh-53' as CardDefinitionId;     // minion major item, keywords ["weapon", "technology"]
const VILE_FUMES = 'wh-54' as CardDefinitionId;         // minion special item, keyword "technology"

const STAGE_2 = 'test-stage-res-2-wh120' as CardDefinitionId;

function inPlay(defId: CardDefinitionId, instanceId: string, attachedToSite?: CardDefinitionId): CardInPlay {
  return {
    instanceId: instanceId as CardInstanceId,
    definitionId: defId,
    status: CardStatus.Untapped,
    ...(attachedToSite ? { attachedToSite } : {}),
  };
}

function instanceOf(state: GameState, defId: CardDefinitionId): CardInstanceId {
  return state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === defId)!.instanceId;
}

/** Whether a viable play action exists for `instanceId` (item or permanent event). */
function canPlay(state: GameState, player: PlayerId, instanceId: CardInstanceId): boolean {
  return computeLegalActions(state, player).some(
    a => a.viable
      && (a.action.type === 'play-hero-resource' || a.action.type === 'play-permanent-event')
      && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === instanceId,
  );
}

/** A `site-protected` constraint owned by `owner`, bound to `siteDefId`. */
function siteProtectedConstraint(owner: PlayerId, siteDefId: CardDefinitionId) {
  return {
    id: `protected-${siteDefId as string}` as ConstraintId,
    source: 'protected-src' as CardInstanceId,
    sourceDefinitionId: 'wh-68' as CardDefinitionId,
    scope: { kind: 'until-cleared' as const },
    target: { kind: 'player' as const, playerId: owner },
    kind: { type: 'site-flag' as const, flag: 'site-protected' as const, siteDefinitionId: siteDefId },
  };
}

/** A `technology-item-unlocked` constraint owned by `owner`, bound to `siteDefId`. */
function techUnlockConstraint(owner: PlayerId, siteDefId: CardDefinitionId) {
  return {
    id: `tech-unlock-${siteDefId as string}` as ConstraintId,
    source: 'machinery-src' as CardInstanceId,
    sourceDefinitionId: SARUMANS_MACHINERY,
    scope: { kind: 'until-cleared' as const },
    target: { kind: 'player' as const, playerId: owner },
    kind: { type: 'site-flag' as const, flag: 'technology-item-unlocked' as const, siteDefinitionId: siteDefId },
  };
}

/** FW site-phase state at `site` with Saruman, plus the given hand and constraints. */
function machineryState(opts: {
  site?: CardDefinitionId;
  avatar?: CardDefinitionId;
  hand?: CardDefinitionId[];
  siteStatus?: CardStatus;
  protectedFor?: PlayerId;
  techUnlock?: boolean;
}): GameState {
  const site = opts.site ?? ISENGARD_WH;
  const base = buildFallenWizardSitePhaseState({
    site,
    characters: [opts.avatar ?? SARUMAN_FW],
    hand: opts.hand ?? [SARUMANS_MACHINERY],
    siteStatus: opts.siteStatus,
  });
  const constraints = [
    ...(opts.protectedFor !== undefined ? [siteProtectedConstraint(opts.protectedFor, site)] : []),
    ...(opts.techUnlock ? [techUnlockConstraint(PLAYER_1, site)] : []),
  ];
  return constraints.length > 0 ? { ...base, activeConstraints: constraints } : base;
}

/**
 * FW *organization*-phase state at `site` with Saruman, plus the given hand and
 * constraints. Saruman's Machinery is a Stage resource, so it is played during
 * the organization phase (rule 5.F1); use this (not {@link machineryState}) for
 * its play/availability checks.
 */
function machineryOrgState(opts: {
  site?: CardDefinitionId;
  avatar?: CardDefinitionId;
  hand?: CardDefinitionId[];
  siteStatus?: CardStatus;
  protectedFor?: PlayerId;
}): GameState {
  const site = opts.site ?? ISENGARD_WH;
  const base = buildFallenWizardOrgPhaseState({
    site,
    characters: [opts.avatar ?? SARUMAN_FW],
    hand: opts.hand ?? [SARUMANS_MACHINERY],
    siteStatus: opts.siteStatus,
  });
  const constraints = opts.protectedFor !== undefined
    ? [siteProtectedConstraint(opts.protectedFor, site)]
    : [];
  return constraints.length > 0 ? { ...base, activeConstraints: constraints } : base;
}

/** Organization-phase state for a player of the given alignment with `cards` in play. */
function orgState(alignment: Alignment, cards: CardInPlay[]): GameState {
  return recomputeDerived(buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, alignment, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: cards },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  }));
}

/** Reduce the first viable play-hero-resource action for `instanceId`. */
function playItem(state: GameState, player: PlayerId, instanceId: CardInstanceId): GameState {
  const action = computeLegalActions(state, player).find(
    a => a.viable && a.action.type === 'play-hero-resource'
      && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === instanceId,
  );
  expect(action, 'expected a viable play action for the item').toBeDefined();
  const result = reduce(state, action!.action);
  expect(result.error).toBeUndefined();
  return result.state;
}

describe("Saruman's Machinery (wh-120)", () => {
  beforeEach(() => resetMint());

  // ── Rule 0: worth 1 (miscellaneous) marshalling point ──────────────────────

  // Regression test: the card's printed marshalling-point value (top-left
  // diamond) is 1, but the data file had it recorded as 0 — confirmed against
  // both the card image and the authoritative card database
  // (WH.cards["WH-120"].attributes.marshallingPoints === "1").
  test('is worth 1 miscellaneous marshalling point', () => {
    const state = orgState(Alignment.FallenWizard, [inPlay(SARUMANS_MACHINERY, 'p1-2000')]);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1);
  });

  // ── Rule 1: 4 stage points (Fallen-wizard only) ───────────────────────────

  test('contributes 4 stage points to a Fallen-wizard who has it in play', () => {
    const state = orgState(Alignment.FallenWizard, [inPlay(SARUMANS_MACHINERY, 'p1-2000')]);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(4);
  });

  test('stage points are not accrued by a non-Fallen-wizard player', () => {
    const state = orgState(Alignment.Wizard, [inPlay(SARUMANS_MACHINERY, 'p1-2000')]);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(0);
  });

  // ── Rules 2-4: play restrictions (Saruman, Isengard/White Towers, protected) ─

  test('playable at a protected Isengard while your avatar is Saruman', () => {
    const state = machineryOrgState({ site: ISENGARD_WH, protectedFor: PLAYER_1 });
    expect(canPlay(state, PLAYER_1, instanceOf(state, SARUMANS_MACHINERY))).toBe(true);
  });

  test('playable at a protected The White Towers', () => {
    const state = machineryOrgState({ site: WHITE_TOWERS_WH, protectedFor: PLAYER_1 });
    expect(canPlay(state, PLAYER_1, instanceOf(state, SARUMANS_MACHINERY))).toBe(true);
  });

  test('NOT playable on Isengard if the site is not protected', () => {
    const state = machineryOrgState({ site: ISENGARD_WH }); // no site-protected constraint
    expect(canPlay(state, PLAYER_1, instanceOf(state, SARUMANS_MACHINERY))).toBe(false);
  });

  test('NOT playable if the protection is owned by the opponent, not you', () => {
    const state = machineryOrgState({ site: ISENGARD_WH, protectedFor: PLAYER_2 });
    expect(canPlay(state, PLAYER_1, instanceOf(state, SARUMANS_MACHINERY))).toBe(false);
  });

  test('NOT playable at a protected Wizardhaven that is neither Isengard nor The White Towers', () => {
    const state = machineryOrgState({ site: RHOSGOBEL_WH, protectedFor: PLAYER_1 });
    expect(canPlay(state, PLAYER_1, instanceOf(state, SARUMANS_MACHINERY))).toBe(false);
  });

  test('NOT playable when your avatar is not Saruman (Alatar / Gandalf)', () => {
    const alatar = machineryOrgState({ site: ISENGARD_WH, avatar: ALATAR_FW, protectedFor: PLAYER_1 });
    expect(canPlay(alatar, PLAYER_1, instanceOf(alatar, SARUMANS_MACHINERY))).toBe(false);
    const gandalf = machineryOrgState({ site: ISENGARD_WH, avatar: GANDALF_FW, protectedFor: PLAYER_1 });
    expect(canPlay(gandalf, PLAYER_1, instanceOf(gandalf, SARUMANS_MACHINERY))).toBe(false);
  });

  // ── Rule 5: the play binds to the site and adds the unlock constraint ───────

  test('playing it binds the card to the site and adds a technology-item-unlocked constraint', () => {
    const state = machineryOrgState({ site: ISENGARD_WH, protectedFor: PLAYER_1 });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, instanceOf(state, SARUMANS_MACHINERY), undefined,
      { targetSiteDefinitionId: ISENGARD_WH },
    );

    const card = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === SARUMANS_MACHINERY);
    expect(card).toBeDefined();
    expect(card!.attachedToSite).toBe(ISENGARD_WH);

    const constraint = after.activeConstraints.find(
      c => c.kind.type === 'site-flag' && c.kind.flag === 'technology-item-unlocked' && c.kind.siteDefinitionId === ISENGARD_WH,
    );
    expect(constraint).toBeDefined();
    expect(constraint!.scope.kind).toBe('until-cleared');
    expect(constraint!.target.kind).toBe('player');
    expect((constraint!.target as { playerId?: PlayerId }).playerId).toBe(PLAYER_1);
  });

  // Regression test: Saruman's Machinery went straight to discard the instant
  // it resolved, because Saruman himself had not yet been played (only
  // declared in the play deck) — the post-reduce MEWH/2.2.F1 sweep mistook
  // "avatar not currently in play" for "avatar has left play" and discarded
  // every Saruman-specific Stage card immediately, including the one that
  // had just legally entered play. "Playable if you are Saruman" (CoE 2.2.F2)
  // only requires the avatar to be *declared*, not fielded.
  test('stays in play attached to the site even when Saruman has not been played yet (only declared)', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: ISENGARD_WH,
      characters: [ASTERNAK], // company has a non-avatar Man; Saruman is not in play
      playDeck: [SARUMAN_FW], // Saruman declared, still in the play deck
      hand: [SARUMANS_MACHINERY],
    });
    const protectedState: GameState = { ...state, activeConstraints: [siteProtectedConstraint(PLAYER_1, ISENGARD_WH)] };

    const instanceId = instanceOf(protectedState, SARUMANS_MACHINERY);
    expect(canPlay(protectedState, PLAYER_1, instanceId)).toBe(true);

    const after = playPermanentEventAndResolve(
      protectedState, PLAYER_1, instanceId, undefined,
      { targetSiteDefinitionId: ISENGARD_WH },
    );

    const card = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === SARUMANS_MACHINERY);
    expect(card).toBeDefined();
    expect(card!.attachedToSite).toBe(ISENGARD_WH);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === SARUMANS_MACHINERY)).toBe(false);
  });

  // ── Rule 6: one Technology item becomes playable at the (haven) site ────────

  test('a Technology item is NOT playable at Isengard without the unlock', () => {
    // Isengard is a haven with no item resources; Blasting Fire's own
    // item-play-site restriction (Shadow/Dark-holds) does not match it.
    const state = machineryState({ site: ISENGARD_WH, hand: [BLASTING_FIRE], protectedFor: PLAYER_1 });
    expect(canPlay(state, PLAYER_1, instanceOf(state, BLASTING_FIRE))).toBe(false);
  });

  test('a Technology item becomes playable at Isengard once the unlock is active', () => {
    const state = machineryState({ site: ISENGARD_WH, hand: [BLASTING_FIRE], techUnlock: true });
    expect(canPlay(state, PLAYER_1, instanceOf(state, BLASTING_FIRE))).toBe(true);
  });

  // Regression test: Mechanical Bow's data keyword was capitalized "Technology",
  // not matching the engine's lowercase "technology" check (used elsewhere by
  // Blasting Fire wh-51 / Liquid Fire wh-52), so the unlock never recognized it
  // as a technology item and it was rejected as a major item at a haven site.
  test('Mechanical Bow (wh-53) is recognized as a Technology item and becomes playable at Isengard once the unlock is active', () => {
    const state = machineryState({ site: ISENGARD_WH, hand: [MECHANICAL_BOW], techUnlock: true });
    expect(canPlay(state, PLAYER_1, instanceOf(state, MECHANICAL_BOW))).toBe(true);
  });

  // Regression test: Vile Fumes' data entry was missing the "technology"
  // keyword entirely (unlike its siblings Blasting Fire wh-51 / Liquid Fire
  // wh-52), so the unlock never recognized it as a Technology item — reported
  // as unplayable at Isengard despite an untapped character and an active
  // Saruman's Machinery unlock.
  test('Vile Fumes (wh-54) is recognized as a Technology item and becomes playable at Isengard once the unlock is active', () => {
    const state = machineryState({ site: ISENGARD_WH, hand: [VILE_FUMES], techUnlock: true });
    expect(canPlay(state, PLAYER_1, instanceOf(state, VILE_FUMES))).toBe(true);
  });

  test('the unlock is scoped to its own site — a Technology item stays blocked at a different site', () => {
    // Unlock bound to The White Towers, but the company is at Isengard.
    const base = buildFallenWizardSitePhaseState({ site: ISENGARD_WH, characters: [SARUMAN_FW], hand: [BLASTING_FIRE] });
    const state: GameState = { ...base, activeConstraints: [techUnlockConstraint(PLAYER_1, WHITE_TOWERS_WH)] };
    expect(canPlay(state, PLAYER_1, instanceOf(state, BLASTING_FIRE))).toBe(false);
  });

  // ── Rule 7: …whether the site is tapped or untapped ────────────────────────

  test('the Technology item is playable even when the site is already tapped', () => {
    const state = machineryState({
      site: ISENGARD_WH, hand: [BLASTING_FIRE], techUnlock: true, siteStatus: CardStatus.Tapped,
    });
    expect(canPlay(state, PLAYER_1, instanceOf(state, BLASTING_FIRE))).toBe(true);
  });

  // ── Rule 8: only Technology-keyword items are unlocked ─────────────────────

  test('a non-Technology item is NOT unlocked at the site', () => {
    const state = machineryState({
      site: ISENGARD_WH, hand: [BLASTING_FIRE, BLACK_MAIL_COAT], techUnlock: true,
    });
    // The Technology item is unlocked …
    expect(canPlay(state, PLAYER_1, instanceOf(state, BLASTING_FIRE))).toBe(true);
    // … but the ordinary minion major item is not.
    expect(canPlay(state, PLAYER_1, instanceOf(state, BLACK_MAIL_COAT))).toBe(false);
  });

  // ── Rules 9-10: exactly one per site phase, and it does not tap the site ───

  test('playing the Technology item leaves the site untapped and records the allowance as spent', () => {
    const state = machineryState({ site: ISENGARD_WH, hand: [BLASTING_FIRE, BLASTING_FIRE], techUnlock: true });
    const first = instanceOf(state, BLASTING_FIRE);

    const after = playItem(state, PLAYER_1, first);

    // Site stays untapped (the bonus item is independent of the site's tap state).
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
    // The allowance is consumed.
    expect((after.phaseState as { technologyItemPlayed?: boolean }).technologyItemPlayed).toBe(true);
    // Blasting Fire is now borne by Saruman.
    const saruman = after.players[RESOURCE_PLAYER].characters[
      after.players[RESOURCE_PLAYER].companies[0].characters[0]
    ];
    expect(saruman.items.some(i => i.definitionId === BLASTING_FIRE)).toBe(true);
  });

  test('only ONE Technology item is playable per site phase', () => {
    const state = machineryState({ site: ISENGARD_WH, hand: [BLASTING_FIRE, BLASTING_FIRE], techUnlock: true });
    const handCopies = state.players[RESOURCE_PLAYER].hand.filter(c => c.definitionId === BLASTING_FIRE);
    expect(handCopies).toHaveLength(2);

    const after = playItem(state, PLAYER_1, handCopies[0].instanceId);

    // The second copy is no longer offered — the one-per-phase allowance is spent.
    const secondCopy = after.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === BLASTING_FIRE)!;
    expect(canPlay(after, PLAYER_1, secondCopy.instanceId)).toBe(false);
  });

  // ── Rule 11: cannot be duplicated on a given site ──────────────────────────

  test('cannot be duplicated on a given site', () => {
    // With a copy already bound to Isengard, a second copy is not playable there.
    const base = machineryOrgState({ site: ISENGARD_WH, hand: [SARUMANS_MACHINERY], protectedFor: PLAYER_1 });
    expect(canPlay(base, PLAYER_1, instanceOf(base, SARUMANS_MACHINERY))).toBe(true);

    const withCopy: GameState = {
      ...base,
      players: [
        { ...base.players[RESOURCE_PLAYER], cardsInPlay: [inPlay(SARUMANS_MACHINERY, 'p1-3000', ISENGARD_WH)] },
        base.players[1],
      ] as GameState['players'],
    };
    expect(canPlay(withCopy, PLAYER_1, instanceOf(withCopy, SARUMANS_MACHINERY))).toBe(false);
  });

  // ── Rule 12: discard when the bound site leaves play ───────────────────────

  test('persists while a company occupies the bound site', () => {
    const state = machineryOrgState({ site: ISENGARD_WH, protectedFor: PLAYER_1 });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, instanceOf(state, SARUMANS_MACHINERY), undefined,
      { targetSiteDefinitionId: ISENGARD_WH },
    );
    const swept = discardOrphanedSiteAttachedEvents(after);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SARUMANS_MACHINERY)).toBe(true);
  });

  test('discarded (and its unlock constraint cleared) once the bound site leaves play', () => {
    const state = machineryOrgState({ site: ISENGARD_WH, protectedFor: PLAYER_1 });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, instanceOf(state, SARUMANS_MACHINERY), undefined,
      { targetSiteDefinitionId: ISENGARD_WH },
    );
    const sourceId = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === SARUMANS_MACHINERY)!.instanceId;
    expect(after.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(1);

    // The company leaves Isengard (its current site becomes a different site),
    // so no company occupies Isengard any longer.
    const movedCompany = {
      ...after.players[RESOURCE_PLAYER].companies[0],
      currentSite: { ...after.players[RESOURCE_PLAYER].companies[0].currentSite!, definitionId: WHITE_TOWERS_WH },
    };
    const moved: GameState = {
      ...after,
      players: [{ ...after.players[RESOURCE_PLAYER], companies: [movedCompany] }, after.players[1]] as GameState['players'],
    };

    const swept = discardOrphanedSiteAttachedEvents(moved);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SARUMANS_MACHINERY)).toBe(false);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === SARUMANS_MACHINERY)).toBe(true);
    expect(swept.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(0);
  });

  // ── Stage-resource discardability (does not drop the total below the cap) ───

  test('with another stage card present, the other card is the discardable one', () => {
    const stageDef = {
      cardType: 'minion-resource-event', alignment: 'stage', id: STAGE_2,
      name: 'Test Stage Two', unique: false, eventType: 'permanent',
      marshallingPoints: 0, marshallingCategory: 'misc',
      effects: [{ type: 'stage-points', value: 2 }], text: 'Gives 2 stage points.',
    };
    (pool as Record<string, unknown>)[STAGE_2 as string] = stageDef;
    try {
      const state = orgState(Alignment.FallenWizard, [inPlay(SARUMANS_MACHINERY, 'p1-2000'), inPlay(STAGE_2, 'p1-2001')]);
      expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(6);

      const targets = viableActions(state, PLAYER_1, 'discard-stage-resource')
        .map(a => (a.action as { cardInstanceId: string }).cardInstanceId);
      expect(targets).toContain('p1-2001');
      expect(targets).not.toContain('p1-2000');
    } finally {
      delete (pool as Record<string, unknown>)[STAGE_2 as string];
    }
  });
});
