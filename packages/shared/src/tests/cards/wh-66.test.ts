/**
 * @module wh-66.test
 *
 * Card test: Double-dealing (wh-66)
 * Type: minion-resource-event (permanent) · alignment: stage
 * Stage points: 1
 *
 * Card text:
 *   "Playable on a site. If the site is a minion site, you may play appropriate
 *    hero resources there. If the site is a hero site, you may play appropriate
 *    minion resources there. Discard when this site is discarded or returned to
 *    your location deck."
 *
 * Modelled as a stage permanent event bound to the site it is played on
 * (`play-target` target `site`, no filter — "playable on a site"). On entering
 * play it adds an `until-cleared` `cross-alignment-resources-unlocked`
 * constraint, filtered by the site's definition id and targeted at the
 * controlling player. The MEWH §10 cross-alignment site-tap block in
 * `legal-actions/site.ts` (`siteTapCrossAlignmentBlocked`) — which normally
 * stops a Fallen-wizard from playing a hero resource that taps a minion site
 * (or a minion resource at a hero site) — is lifted at the bound site while the
 * constraint is active, so the opposite alignment's items/allies/factions
 * become playable there. The `stage-points` effect contributes 1 to the
 * Fallen-wizard's stage-point total. The post-action sweep
 * `discardOrphanedSiteAttachedEvents` discards the card and clears the
 * constraint once no company occupies the bound site.
 *
 * | # | Rule                                                       | Status |
 * |---|------------------------------------------------------------|--------|
 * | 1 | playable on a site (binds the card to that site)           | OK     |
 * | 2 | at a minion site, appropriate hero resources are playable  | OK     |
 * | 3 | at a hero site, appropriate minion resources are playable  | OK     |
 * | 4 | contributes 1 stage point while in play                    | OK     |
 * | 5 | discarded (constraint cleared) when the site leaves play   | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  resetMint, buildFallenWizardSitePhaseState, playPermanentEventAndResolve,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const DOUBLE_DEALING = 'wh-66' as CardDefinitionId;

// Sites (the FW visits both hero- and minion-aligned versions).
const CAVES_OF_ULUND_MINION = 'le-360' as CardDefinitionId; // minion (ringwraith) Ruins & Lairs, plays major items
const HIMRING_HERO = 'tw-401' as CardDefinitionId;          // hero (wizard) Ruins & Lairs, plays major items

// FW company character (carries items).
const ARAGORN = 'tw-120' as CardDefinitionId;

// Cross-alignment major items.
const GLAMDRING = 'tw-244' as CardDefinitionId;        // hero (wizard) major item
const BLACK_MAIL_COAT = 'le-301' as CardDefinitionId;  // minion (ringwraith) major item

function instanceOf(state: GameState, defId: CardDefinitionId): CardInstanceId {
  return state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === defId)!.instanceId;
}

/** Is there a viable play action (item or permanent event) for `instanceId`? */
function canPlay(state: GameState, instanceId: CardInstanceId): boolean {
  return computeLegalActions(state, PLAYER_1).some(
    a => a.viable
      && (a.action.type === 'play-hero-resource' || a.action.type === 'play-permanent-event')
      && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === instanceId,
  );
}

describe('Double-dealing (wh-66)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable on a site, binding to it ───────────────────────────────

  test('playable on a site — the play action binds the card to that site', () => {
    const state = buildFallenWizardSitePhaseState({
      site: CAVES_OF_ULUND_MINION, characters: [ARAGORN], hand: [DOUBLE_DEALING],
    });
    const id = instanceOf(state, DOUBLE_DEALING);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId)
      .toBe(CAVES_OF_ULUND_MINION);
  });

  test('playing it binds the card to the site and adds the cross-alignment unlock constraint', () => {
    const state = buildFallenWizardSitePhaseState({
      site: CAVES_OF_ULUND_MINION, characters: [ARAGORN], hand: [DOUBLE_DEALING],
    });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, instanceOf(state, DOUBLE_DEALING), undefined,
      { targetSiteDefinitionId: CAVES_OF_ULUND_MINION },
    );

    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === DOUBLE_DEALING);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(CAVES_OF_ULUND_MINION);

    const constraint = after.activeConstraints.find(
      c => c.kind.type === 'cross-alignment-resources-unlocked'
        && c.kind.siteDefinitionId === CAVES_OF_ULUND_MINION,
    );
    expect(constraint).toBeDefined();
    expect(constraint!.scope.kind).toBe('until-cleared');
    expect(constraint!.target.kind).toBe('player');
    expect((constraint!.target as { playerId?: typeof PLAYER_1 }).playerId).toBe(PLAYER_1);
  });

  // ── Rule 2: at a minion site, hero resources become playable ────────────────

  test('without the card, a hero item is barred at a minion site (cross-alignment §10)', () => {
    const state = buildFallenWizardSitePhaseState({
      site: CAVES_OF_ULUND_MINION, characters: [ARAGORN],
      hand: [DOUBLE_DEALING, GLAMDRING, BLACK_MAIL_COAT],
    });
    // The hero major item is blocked at the minion site …
    expect(canPlay(state, instanceOf(state, GLAMDRING))).toBe(false);
    // … but the same-alignment minion major item is playable, proving the
    // setup is otherwise valid and only the cross-alignment play is blocked.
    expect(canPlay(state, instanceOf(state, BLACK_MAIL_COAT))).toBe(true);
  });

  test('after the card is played, the hero item becomes playable at the minion site', () => {
    const before = buildFallenWizardSitePhaseState({
      site: CAVES_OF_ULUND_MINION, characters: [ARAGORN],
      hand: [DOUBLE_DEALING, GLAMDRING],
    });
    const glamdring = instanceOf(before, GLAMDRING);
    expect(canPlay(before, glamdring)).toBe(false);

    const after = playPermanentEventAndResolve(
      before, PLAYER_1, instanceOf(before, DOUBLE_DEALING), undefined,
      { targetSiteDefinitionId: CAVES_OF_ULUND_MINION },
    );
    // Glamdring is still in hand and is now playable at the (minion) site.
    expect(canPlay(after, glamdring)).toBe(true);
  });

  // ── Rule 3: at a hero site, minion resources become playable ────────────────

  test('without the card, a minion item is barred at a hero site (cross-alignment §10)', () => {
    const state = buildFallenWizardSitePhaseState({
      site: HIMRING_HERO, characters: [ARAGORN],
      hand: [DOUBLE_DEALING, GLAMDRING, BLACK_MAIL_COAT],
    });
    // The minion major item is blocked at the hero site …
    expect(canPlay(state, instanceOf(state, BLACK_MAIL_COAT))).toBe(false);
    // … while the same-alignment hero major item is playable.
    expect(canPlay(state, instanceOf(state, GLAMDRING))).toBe(true);
  });

  test('after the card is played, the minion item becomes playable at the hero site', () => {
    const before = buildFallenWizardSitePhaseState({
      site: HIMRING_HERO, characters: [ARAGORN],
      hand: [DOUBLE_DEALING, BLACK_MAIL_COAT],
    });
    const coat = instanceOf(before, BLACK_MAIL_COAT);
    expect(canPlay(before, coat)).toBe(false);

    const after = playPermanentEventAndResolve(
      before, PLAYER_1, instanceOf(before, DOUBLE_DEALING), undefined,
      { targetSiteDefinitionId: HIMRING_HERO },
    );
    expect(canPlay(after, coat)).toBe(true);
  });

  test('the unlock is scoped to the bound site only — another site stays blocked', () => {
    // Double-dealing played on the minion site does NOT unlock cross-alignment
    // play at a different (hero) site. We approximate "another site" by checking
    // that the constraint is filtered by the bound site's definition id, so the
    // site.ts gate (which matches on `siteDefinitionId`) cannot fire elsewhere.
    const state = buildFallenWizardSitePhaseState({
      site: CAVES_OF_ULUND_MINION, characters: [ARAGORN], hand: [DOUBLE_DEALING],
    });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, instanceOf(state, DOUBLE_DEALING), undefined,
      { targetSiteDefinitionId: CAVES_OF_ULUND_MINION },
    );
    const constraint = after.activeConstraints.find(
      c => c.kind.type === 'cross-alignment-resources-unlocked',
    );
    expect(constraint!.kind.type === 'cross-alignment-resources-unlocked'
      && constraint!.kind.siteDefinitionId).toBe(CAVES_OF_ULUND_MINION);
    expect(constraint!.kind.type === 'cross-alignment-resources-unlocked'
      && constraint!.kind.siteDefinitionId === HIMRING_HERO).toBe(false);
  });

  // ── Rule 4: contributes 1 stage point while in play ─────────────────────────

  test('contributes 1 stage point to the Fallen-wizard while in play', () => {
    const state = buildFallenWizardSitePhaseState({
      site: CAVES_OF_ULUND_MINION, characters: [ARAGORN], hand: [DOUBLE_DEALING],
    });
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, instanceOf(state, DOUBLE_DEALING), undefined,
      { targetSiteDefinitionId: CAVES_OF_ULUND_MINION },
    );
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(1);
  });

  // ── Rule 5: discarded when the site leaves play ─────────────────────────────

  test('persists while a company occupies the bound site', () => {
    const state = buildFallenWizardSitePhaseState({
      site: CAVES_OF_ULUND_MINION, characters: [ARAGORN], hand: [DOUBLE_DEALING],
    });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, instanceOf(state, DOUBLE_DEALING), undefined,
      { targetSiteDefinitionId: CAVES_OF_ULUND_MINION },
    );
    const swept = discardOrphanedSiteAttachedEvents(after);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === DOUBLE_DEALING)).toBe(true);
  });

  test('the card and its constraint are discarded once the site leaves play', () => {
    const state = buildFallenWizardSitePhaseState({
      site: CAVES_OF_ULUND_MINION, characters: [ARAGORN], hand: [DOUBLE_DEALING],
    });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, instanceOf(state, DOUBLE_DEALING), undefined,
      { targetSiteDefinitionId: CAVES_OF_ULUND_MINION },
    );
    const sourceId = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === DOUBLE_DEALING)!.instanceId;
    expect(after.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(1);

    // The company moves on — its current site is no longer Caves of Ûlund, so
    // the site was returned to the location deck.
    const movedCompany = {
      ...after.players[RESOURCE_PLAYER].companies[0],
      currentSite: {
        ...after.players[RESOURCE_PLAYER].companies[0].currentSite!,
        definitionId: HIMRING_HERO,
      },
    };
    const moved: GameState = {
      ...after,
      players: [
        { ...after.players[RESOURCE_PLAYER], companies: [movedCompany] },
        after.players[1],
      ] as GameState['players'],
    };

    const swept = discardOrphanedSiteAttachedEvents(moved);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === DOUBLE_DEALING)).toBe(false);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === DOUBLE_DEALING)).toBe(true);
    expect(swept.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(0);
  });
});
