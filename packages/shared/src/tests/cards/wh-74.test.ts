/**
 * @module wh-74.test
 *
 * Card test: Guarded Haven (wh-74)
 * Type: minion-resource-event (permanent) · alignment: stage · stage points: 1
 *
 * Card text:
 *   "May not be used as a starting stage card. Playable on one of your
 *    Wizardhavens [{H}] other than Isengard, The White Towers, or Rhosgobel.
 *    The site is protected. Cards that give marshalling points may not be played
 *    at any version of the site by your opponent in all cases. Cannot be
 *    duplicated on a given site."
 *
 * Modelled as a stage permanent event bound to the Wizardhaven it is played on:
 *  - "May not be used as a starting stage card" — the card does NOT carry the
 *    `starting-item` keyword that marks a Fallen-wizard Stage resource as
 *    draftable at setup (Thrall of the Voice wh-82, Hidden Haven wh-75 both do).
 *    Without it, `isStageResourceCard` is false, so the draft layer never offers
 *    the card as a starting stage card.
 *  - "Playable on one of your Wizardhavens [{H}] other than …" — a
 *    `play-target` (target `site`) whose filter requires `effectiveSiteType`
 *    `haven` and excludes the three named sites by name.
 *  - "The site is protected. Cards that give marshalling points may not be
 *    played at any version of the site by your opponent in all cases." — an
 *    `until-cleared` `site-protected` constraint (added on `self-enters-play`),
 *    filtered by the site's definition id and targeted at the controlling
 *    player. The site.ts hand-card loop (`siteIsProtectedAgainstPlayer` +
 *    `givesMarshallingPoints`) bars any player other than the protector from
 *    playing an item/ally/faction worth ≥1 MP at any version of the site.
 *  - "Cannot be duplicated on a given site." — `duplication-limit` scope `site`
 *    (the counter also tallies site-attached copies in `cardsInPlay`).
 *  - The post-action sweep `discardOrphanedSiteAttachedEvents` discards the card
 *    and clears the constraint once no company occupies the bound site.
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | may not be drafted as a starting stage card                   | OK     |
 * | 2 | playable on a (non-excluded) Wizardhaven [{H}]                | OK     |
 * | 3 | not playable at Isengard / White Towers / Rhosgobel          | OK     |
 * | 4 | not playable at a non-haven site                              | OK     |
 * | 5 | binds to the site + adds site-protected constraint            | OK     |
 * | 6 | contributes 1 stage point while in play                      | OK     |
 * | 7 | opponent may not play MP cards at the protected site         | OK     |
 * | 8 | non-MP cards are unaffected; the protector is unaffected     | OK     |
 * | 9 | cannot be duplicated on a given site                          | OK     |
 * |10 | discarded (constraint cleared) when the site leaves play     | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  resetMint, buildFallenWizardOrgPhaseState, buildMinionSitePhaseState,
  playPermanentEventAndResolve, makePlayDeck, pool, draftInstId,
  createGame, reduce, LORIEN, Alignment, dispatch,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import type {
  CardDefinitionId, CardInstanceId, ConstraintId, GameState, GameConfig, PlayerId,
} from '../../index.js';

const GUARDED_HAVEN = 'wh-74' as CardDefinitionId;
const THRALL_OF_THE_VOICE = 'wh-82' as CardDefinitionId; // draftable Stage resource (control)
const WIZARDHAVEN = LORIEN;                               // a non-excluded haven Wizardhaven (Lórien)

// Wizardhaven sites.
const WH_ISENGARD = 'wh-56' as CardDefinitionId;       // FW haven, name "Isengard" (excluded)
const WH_WHITE_TOWERS = 'wh-58' as CardDefinitionId;   // FW haven, name "The White Towers" (excluded)
const WH_RHOSGOBEL = 'wh-57' as CardDefinitionId;      // FW haven, name "Rhosgobel" (excluded)
const HIMRING_HERO = 'tw-401' as CardDefinitionId;     // hero Ruins & Lairs (non-haven)

// Minion fixtures for the opponent MP-block tests.
const CAVES_OF_ULUND = 'le-360' as CardDefinitionId;   // minion Ruins & Lairs, plays major + minor
const REN_RW = 'le-56' as CardDefinitionId;            // Ringwraith avatar (item bearer)
const BLACK_MAIL_COAT = 'le-301' as CardDefinitionId;  // minion major item, 1 MP
const BLACK_HIDE_SHIELD = 'le-300' as CardDefinitionId; // minion minor item, 0 MP

function handInstance(state: GameState, defId: CardDefinitionId, playerIndex = RESOURCE_PLAYER): CardInstanceId {
  return state.players[playerIndex].hand.find(c => c.definitionId === defId)!.instanceId;
}

/** Is there a viable play action for `instanceId` (item or permanent event)? */
function canPlay(state: GameState, player: PlayerId, instanceId: CardInstanceId): boolean {
  return computeLegalActions(state, player).some(
    a => a.viable
      && (a.action.type === 'play-hero-resource' || a.action.type === 'play-permanent-event')
      && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === instanceId,
  );
}

/** Build a `site-protected` active constraint owned by `owner`, bound to `siteDefId`. */
function siteProtectedConstraint(owner: PlayerId, siteDefId: CardDefinitionId) {
  return {
    id: 'gh-protect' as ConstraintId,
    source: 'gh-protect-src' as CardInstanceId,
    sourceDefinitionId: GUARDED_HAVEN,
    scope: { kind: 'until-cleared' as const },
    target: { kind: 'player' as const, playerId: owner },
    kind: { type: 'site-flag' as const, flag: 'site-protected' as const, siteDefinitionId: siteDefId },
  };
}

function draftConfig(p1Alignment: Alignment): GameConfig {
  return {
    players: [
      {
        id: PLAYER_1, name: 'Alice', alignment: p1Alignment,
        draftPool: [GUARDED_HAVEN, THRALL_OF_THE_VOICE],
        playDeck: makePlayDeck(), siteDeck: [WIZARDHAVEN], sideboard: [],
      },
      {
        id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
        draftPool: [THRALL_OF_THE_VOICE],
        playDeck: makePlayDeck(), siteDeck: [WIZARDHAVEN], sideboard: [],
      },
    ],
    seed: 42,
  };
}

describe('Guarded Haven (wh-74)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: may not be used as a starting stage card ────────────────────────

  test('cannot be drafted as a starting stage card (a real Stage resource can)', () => {
    const state = createGame(draftConfig(Alignment.FallenWizard), pool);
    const guardedHavenViable = computeLegalActions(state, PLAYER_1).find(
      ea => ea.action.type === 'draft-pick'
        && (ea.action as { characterInstanceId?: CardInstanceId }).characterInstanceId
          === draftInstId(state, 0, GUARDED_HAVEN),
    )?.viable;
    const thrallViable = computeLegalActions(state, PLAYER_1).find(
      ea => ea.action.type === 'draft-pick'
        && (ea.action as { characterInstanceId?: CardInstanceId }).characterInstanceId
          === draftInstId(state, 0, THRALL_OF_THE_VOICE),
    )?.viable;
    expect(guardedHavenViable).toBe(false);
    expect(thrallViable).toBe(true);
  });

  test('the reducer rejects drafting Guarded Haven as a starting stage card', () => {
    const state = createGame(draftConfig(Alignment.FallenWizard), pool);
    const result = reduce(state, {
      type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, GUARDED_HAVEN),
    });
    // The pick is rejected and state is unchanged — nothing drafted as a stage card.
    expect(result.error).toBeTruthy();
    const draftState = (result.state.phaseState as {
      setupStep: { draftState: readonly { drafted: readonly unknown[]; draftedStageResources: readonly unknown[] }[] };
    }).setupStep.draftState;
    expect(draftState[0].drafted).toHaveLength(0);
    expect(draftState[0].draftedStageResources).toHaveLength(0);
  });

  // ── Rule 2: playable on a (non-excluded) Wizardhaven [{H}] ───────────────────

  test('playable on a Wizardhaven — the play action binds the card to that site', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: WIZARDHAVEN, characters: [REN_RW], hand: [GUARDED_HAVEN],
    });
    const id = handInstance(state, GUARDED_HAVEN);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId)
      .toBe(WIZARDHAVEN);
  });

  // ── Rule 3: excluded Wizardhavens ───────────────────────────────────────────

  test.each([
    ['Isengard', WH_ISENGARD],
    ['The White Towers', WH_WHITE_TOWERS],
    ['Rhosgobel', WH_RHOSGOBEL],
  ])('NOT playable at the excluded Wizardhaven %s', (_name, siteDef) => {
    const state = buildFallenWizardOrgPhaseState({
      site: siteDef, characters: [REN_RW], hand: [GUARDED_HAVEN],
    });
    expect(canPlay(state, PLAYER_1, handInstance(state, GUARDED_HAVEN))).toBe(false);
  });

  // ── Rule 4: only a haven [{H}] qualifies ────────────────────────────────────

  test('NOT playable at a non-haven site (requires a Wizardhaven [{H}])', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: HIMRING_HERO, characters: [REN_RW], hand: [GUARDED_HAVEN],
    });
    expect(canPlay(state, PLAYER_1, handInstance(state, GUARDED_HAVEN))).toBe(false);
  });

  // ── Rule 5: binding + site-protected constraint ─────────────────────────────

  test('playing it binds the card to the site and adds the site-protected constraint', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: WIZARDHAVEN, characters: [REN_RW], hand: [GUARDED_HAVEN],
    });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, handInstance(state, GUARDED_HAVEN), undefined,
      { targetSiteDefinitionId: WIZARDHAVEN },
    );

    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === GUARDED_HAVEN);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(WIZARDHAVEN);

    const constraint = after.activeConstraints.find(
      c => c.kind.type === 'site-flag' && c.kind.flag === 'site-protected' && c.kind.siteDefinitionId === WIZARDHAVEN,
    );
    expect(constraint).toBeDefined();
    expect(constraint!.scope.kind).toBe('until-cleared');
    expect(constraint!.target.kind).toBe('player');
    expect((constraint!.target as { playerId?: PlayerId }).playerId).toBe(PLAYER_1);
  });

  // ── Rule 6: contributes 1 stage point ───────────────────────────────────────

  test('contributes 1 stage point to the Fallen-wizard while in play', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: WIZARDHAVEN, characters: [REN_RW], hand: [GUARDED_HAVEN],
    });
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, handInstance(state, GUARDED_HAVEN), undefined,
      { targetSiteDefinitionId: WIZARDHAVEN },
    );
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(1);
  });

  // ── Rule 7: the site is protected — opponent MP cards barred ─────────────────

  test('opponent may not play a marshalling-point card at the protected site', () => {
    const base = buildMinionSitePhaseState({
      site: CAVES_OF_ULUND, characters: [REN_RW], hand: [BLACK_MAIL_COAT],
    });
    const coat = handInstance(base, BLACK_MAIL_COAT);

    // Without protection the major item (1 MP) is playable …
    expect(canPlay(base, PLAYER_1, coat)).toBe(true);

    // … but once PLAYER_2 protects this version of the site, PLAYER_1 (the
    // opponent of the protector) may no longer play the MP card there.
    const protectedState: GameState = {
      ...base,
      activeConstraints: [...base.activeConstraints, siteProtectedConstraint(PLAYER_2, CAVES_OF_ULUND)],
    };
    expect(canPlay(protectedState, PLAYER_1, coat)).toBe(false);
  });

  // ── Rule 8: scope — non-MP cards and the protector itself are unaffected ─────

  test('a card that gives no marshalling points is still playable under protection', () => {
    const base = buildMinionSitePhaseState({
      site: CAVES_OF_ULUND, characters: [REN_RW], hand: [BLACK_HIDE_SHIELD],
    });
    const shield = handInstance(base, BLACK_HIDE_SHIELD); // 0 MP
    expect(canPlay(base, PLAYER_1, shield)).toBe(true);

    const protectedState: GameState = {
      ...base,
      activeConstraints: [...base.activeConstraints, siteProtectedConstraint(PLAYER_2, CAVES_OF_ULUND)],
    };
    // Black-hide Shield gives no marshalling points, so it is not barred.
    expect(canPlay(protectedState, PLAYER_1, shield)).toBe(true);
  });

  test('the protector themselves may still play MP cards at their protected site', () => {
    const base = buildMinionSitePhaseState({
      site: CAVES_OF_ULUND, characters: [REN_RW], hand: [BLACK_MAIL_COAT],
    });
    const coat = handInstance(base, BLACK_MAIL_COAT);
    // The constraint is owned by the *active* player (PLAYER_1) — they are the
    // protector, not "your opponent", so the bar does not apply to them.
    const ownState: GameState = {
      ...base,
      activeConstraints: [...base.activeConstraints, siteProtectedConstraint(PLAYER_1, CAVES_OF_ULUND)],
    };
    expect(canPlay(ownState, PLAYER_1, coat)).toBe(true);
  });

  // ── Rule 9: cannot be duplicated on a given site ────────────────────────────

  test('a second copy cannot be played at a site that already holds one', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: WIZARDHAVEN, characters: [REN_RW], hand: [GUARDED_HAVEN, GUARDED_HAVEN],
    });
    const first = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === GUARDED_HAVEN)!.instanceId;
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, first, undefined, { targetSiteDefinitionId: WIZARDHAVEN },
    );
    // The remaining copy in hand may no longer be played at the same site.
    const second = after.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === GUARDED_HAVEN)!.instanceId;
    expect(canPlay(after, PLAYER_1, second)).toBe(false);
  });

  test('a second copy cannot be declared at the same site while the first is still on the chain, unresolved', () => {
    // Regression: the site-scope duplication-limit check only tallied
    // resolved copies in `cardsInPlay`, not copies still `declaring` on the
    // chain. A first Guarded Haven played at a site, followed by the
    // opponent merely passing priority back (the card has not resolved into
    // `cardsInPlay` yet), wrongly let a second copy be declared at the same
    // site.
    const state = buildFallenWizardOrgPhaseState({
      site: WIZARDHAVEN, characters: [REN_RW], hand: [GUARDED_HAVEN, GUARDED_HAVEN],
    });
    const first = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === GUARDED_HAVEN)!.instanceId;
    const declaring = dispatch(state, {
      type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: first, targetSiteDefinitionId: WIZARDHAVEN,
    });
    expect(declaring.chain).not.toBeNull();
    expect(declaring.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GUARDED_HAVEN)).toBe(false);

    const opponentPassed = dispatch(declaring, { type: 'pass-chain-priority', player: PLAYER_2 });
    const second = opponentPassed.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === GUARDED_HAVEN)!.instanceId;
    expect(canPlay(opponentPassed, PLAYER_1, second)).toBe(false);
  });

  // ── Rule 10: discarded when the site leaves play ────────────────────────────

  test('persists while a company occupies the bound site', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: WIZARDHAVEN, characters: [REN_RW], hand: [GUARDED_HAVEN],
    });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, handInstance(state, GUARDED_HAVEN), undefined,
      { targetSiteDefinitionId: WIZARDHAVEN },
    );
    const swept = discardOrphanedSiteAttachedEvents(after);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GUARDED_HAVEN)).toBe(true);
  });

  test('the card and its constraint are discarded once the site leaves play', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: WIZARDHAVEN, characters: [REN_RW], hand: [GUARDED_HAVEN],
    });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, handInstance(state, GUARDED_HAVEN), undefined,
      { targetSiteDefinitionId: WIZARDHAVEN },
    );
    const sourceId = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === GUARDED_HAVEN)!.instanceId;
    expect(after.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(1);

    // The company moves on — its current site is no longer Rivendell.
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
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GUARDED_HAVEN)).toBe(false);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === GUARDED_HAVEN)).toBe(true);
    expect(swept.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(0);
  });
});
