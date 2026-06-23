/**
 * @module wh-68.test
 *
 * Card test: The Fortress of Isen (wh-68)
 * Type: minion-resource-event (permanent) · alignment: stage · Stage resource
 *
 * Card text:
 *   "Unique. May not be a starting stage card. Playable if you are Alatar,
 *    Pallando, or Saruman. Playable on Isengard. Isengard is protected. Other
 *    Fallen-wizards may not use the Wizardhaven [{H}] card for Isengard. Cards
 *    that give marshalling points cannot be played at Isengard by your opponent
 *    in all cases. Discard this card when the site is discarded or returned to
 *    its location deck."
 *
 * Modelled as a Fallen-wizard stage permanent-event bound to the named site it
 * is played on (mirroring Double-dealing wh-66 and Hold Rebuilt and Repaired
 * as-88):
 *  - `play-target` site with `filter { name: "Isengard" }` — only offered while
 *    the active company is at Isengard (the play binds the card to it via
 *    `attachedToSite`).
 *  - `play-condition` player-state `{ player.avatar: { $in: [Alatar, Pallando,
 *    Saruman] } }` — "Playable if you are Alatar, Pallando, or Saruman."
 *  - `self-enters-play → add-constraint opponent-mp-play-blocked-at-site` (scope
 *    until-cleared, targeted at the controlling player): while active, the
 *    opponent (any non-owner active player) may not play a marshalling-point
 *    card at the bound site (`legal-actions/site.ts`).
 *  - `stage-points: 3`.
 *  - The post-action sweep `discardOrphanedSiteAttachedEvents` discards the card
 *    and clears its constraint once no company occupies the bound site (the
 *    haven leaving play when the last company departs).
 *
 * | # | Rule                                                      | Status |
 * |---|-----------------------------------------------------------|--------|
 * | 1 | Unique                                                    | OK     |
 * | 2 | carries 3 stage points                                    | OK     |
 * | 3 | may not be a starting stage card                          | vacuous: the engine has no starting-stage-deck, so a stage card can never be placed at setup — the rule is never violable |
 * | 4 | playable only if you are Alatar/Pallando/Saruman          | OK     |
 * | 5 | playable on Isengard (bound to the site)                  | OK     |
 * | 6 | Isengard is protected                                     | no-op (CRF: the "protected" keyword has no standalone effect) |
 * | 7 | other Fallen-wizards may not Wizardhaven Isengard         | no-op (single-Fallen-wizard, two-player engine) |
 * | 8 | opponent cannot play MP-giving cards at Isengard          | OK     |
 * | 9 | discard when the site is discarded / returned to its deck | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, CardStatus, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, GameState, ConstraintId } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import {
  buildTestState, resetMint, dispatch, viableActions, pool, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  RIVENDELL, MINAS_TIRITH, ARAGORN,
  buildFallenWizardSitePhaseState, buildSitePhaseState, playPermanentEventAndResolve,
} from '../test-helpers.js';

const FORTRESS_OF_ISEN = 'wh-68' as CardDefinitionId;
const ISENGARD = 'tw-404' as CardDefinitionId;
const HIMRING = 'tw-401' as CardDefinitionId;          // a non-Isengard site

// Fallen-wizard avatars.
const SARUMAN_FW = 'wh-9' as CardDefinitionId;          // qualifies
const ALATAR_FW = 'wh-1' as CardDefinitionId;           // qualifies
const GANDALF_FW = 'wh-4' as CardDefinitionId;          // does NOT qualify

// A non-unique hero major item worth marshalling points, playable at Isengard
// (which offers minor/major/gold-ring) — used for the opponent MP-block tests.
const HAUBERK = 'tw-254' as CardDefinitionId;           // hero major item, MP 2

// A second stage card so a discard can be offered without dropping below 3.
const STAGE_2 = 'test-stage-res-2' as CardDefinitionId;

function inPlay(defId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId: defId, status: CardStatus.Untapped };
}

function handInstance(state: GameState, defId: CardDefinitionId, playerIdx = RESOURCE_PLAYER): CardInstanceId {
  return state.players[playerIdx].hand.find(c => c.definitionId === defId)!.instanceId;
}

/** Whether a viable play action exists for `instanceId` (item or permanent event). */
function canPlay(state: GameState, player: typeof PLAYER_1, instanceId: CardInstanceId): boolean {
  return computeLegalActions(state, player).some(
    a => a.viable
      && (a.action.type === 'play-hero-resource' || a.action.type === 'play-permanent-event')
      && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === instanceId,
  );
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

describe('The Fortress of Isen (wh-68)', () => {
  beforeEach(() => resetMint());

  // ── Rule 5: playable on Isengard, bound to that site ───────────────────────

  test('playable while a qualifying Fallen-wizard is at Isengard — the play binds it to the site', () => {
    const state = buildFallenWizardSitePhaseState({ site: ISENGARD, characters: [SARUMAN_FW], hand: [FORTRESS_OF_ISEN] });
    const id = handInstance(state, FORTRESS_OF_ISEN);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId).toBe(ISENGARD);
  });

  test('not playable at any site other than Isengard', () => {
    const state = buildFallenWizardSitePhaseState({ site: HIMRING, characters: [SARUMAN_FW], hand: [FORTRESS_OF_ISEN] });
    expect(canPlay(state, PLAYER_1, handInstance(state, FORTRESS_OF_ISEN))).toBe(false);
  });

  test('playing it binds the card to Isengard and adds the opponent-MP-block constraint', () => {
    const state = buildFallenWizardSitePhaseState({ site: ISENGARD, characters: [SARUMAN_FW], hand: [FORTRESS_OF_ISEN] });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, handInstance(state, FORTRESS_OF_ISEN), undefined, { targetSiteDefinitionId: ISENGARD },
    );

    const card = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === FORTRESS_OF_ISEN);
    expect(card).toBeDefined();
    expect(card!.attachedToSite).toBe(ISENGARD);

    const constraint = after.activeConstraints.find(
      c => c.kind.type === 'opponent-mp-play-blocked-at-site' && c.kind.siteDefinitionId === ISENGARD,
    );
    expect(constraint).toBeDefined();
    expect(constraint!.scope.kind).toBe('until-cleared');
    expect(constraint!.target.kind).toBe('player');
    expect((constraint!.target as { playerId?: typeof PLAYER_1 }).playerId).toBe(PLAYER_1);
  });

  // ── Rule 4: playable only if you are Alatar, Pallando, or Saruman ───────────

  test('not playable when your avatar is a non-qualifying Fallen-wizard (Gandalf)', () => {
    const state = buildFallenWizardSitePhaseState({ site: ISENGARD, characters: [GANDALF_FW], hand: [FORTRESS_OF_ISEN] });
    expect(canPlay(state, PLAYER_1, handInstance(state, FORTRESS_OF_ISEN))).toBe(false);
  });

  test('playable when your avatar is Alatar', () => {
    const state = buildFallenWizardSitePhaseState({ site: ISENGARD, characters: [ALATAR_FW], hand: [FORTRESS_OF_ISEN] });
    expect(canPlay(state, PLAYER_1, handInstance(state, FORTRESS_OF_ISEN))).toBe(true);
  });

  // ── Rule 8: opponent cannot play MP-giving cards at Isengard ───────────────

  function blockConstraint(owner: typeof PLAYER_1) {
    return {
      id: 'fortress-isen-block' as ConstraintId,
      source: 'fortress-src' as CardInstanceId,
      sourceDefinitionId: FORTRESS_OF_ISEN,
      scope: { kind: 'until-cleared' as const },
      target: { kind: 'player' as const, playerId: owner },
      kind: { type: 'opponent-mp-play-blocked-at-site' as const, siteDefinitionId: ISENGARD },
    };
  }

  test('an opponent at Isengard cannot play a marshalling-point item while the Fortress is in play', () => {
    // PLAYER_1 (the active player here) stands in for the opponent of the
    // Fortress owner (PLAYER_2): the constraint targets PLAYER_2, so PLAYER_1 is
    // barred from MP plays at Isengard.
    const base = buildSitePhaseState({ site: ISENGARD, characters: [ARAGORN], hand: [HAUBERK] });
    const hauberk = handInstance(base, HAUBERK);

    // Baseline: the MP item is normally playable at Isengard.
    expect(canPlay(base, PLAYER_1, hauberk)).toBe(true);

    // With the opponent's Fortress constraint bound to Isengard, it is barred.
    const blocked: GameState = { ...base, activeConstraints: [blockConstraint(PLAYER_2)] };
    expect(canPlay(blocked, PLAYER_1, hauberk)).toBe(false);
  });

  test('the Fortress owner is NOT blocked from playing MP cards at their own site', () => {
    // Same site, but now the constraint targets the active player (the owner) —
    // they may still play their MP item there.
    const base = buildSitePhaseState({ site: ISENGARD, characters: [ARAGORN], hand: [HAUBERK] });
    const hauberk = handInstance(base, HAUBERK);
    const owned: GameState = { ...base, activeConstraints: [blockConstraint(PLAYER_1)] };
    expect(canPlay(owned, PLAYER_1, hauberk)).toBe(true);
  });

  // ── Rule 9: discard when the bound site leaves play ────────────────────────

  test('persists while a company occupies Isengard', () => {
    const state = buildFallenWizardSitePhaseState({ site: ISENGARD, characters: [SARUMAN_FW], hand: [FORTRESS_OF_ISEN] });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, handInstance(state, FORTRESS_OF_ISEN), undefined, { targetSiteDefinitionId: ISENGARD },
    );
    const swept = discardOrphanedSiteAttachedEvents(after);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === FORTRESS_OF_ISEN)).toBe(true);
  });

  test('discarded (and its constraint cleared) once Isengard leaves play', () => {
    const state = buildFallenWizardSitePhaseState({ site: ISENGARD, characters: [SARUMAN_FW], hand: [FORTRESS_OF_ISEN] });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, handInstance(state, FORTRESS_OF_ISEN), undefined, { targetSiteDefinitionId: ISENGARD },
    );
    const sourceId = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === FORTRESS_OF_ISEN)!.instanceId;
    expect(after.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(1);

    // The last company leaves Isengard (arrives at a new destination), so the
    // haven returns to its location deck.
    const movedCompany = {
      ...after.players[RESOURCE_PLAYER].companies[0],
      currentSite: { ...after.players[RESOURCE_PLAYER].companies[0].currentSite!, definitionId: HIMRING },
    };
    const moved: GameState = {
      ...after,
      players: [{ ...after.players[RESOURCE_PLAYER], companies: [movedCompany] }, after.players[1]] as GameState['players'],
    };

    const swept = discardOrphanedSiteAttachedEvents(moved);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === FORTRESS_OF_ISEN)).toBe(false);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === FORTRESS_OF_ISEN)).toBe(true);
    expect(swept.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(0);
  });

  // ── Rule 2: 3 stage points ─────────────────────────────────────────────────

  test('contributes 3 stage points to a Fallen-wizard who has it in play', () => {
    const state = orgState(Alignment.FallenWizard, [inPlay(FORTRESS_OF_ISEN, 'p1-1000')]);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(3);
  });

  test('stage points are not accrued by a non-Fallen-wizard player', () => {
    const state = orgState(Alignment.Wizard, [inPlay(FORTRESS_OF_ISEN, 'p1-1000')]);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(0);
  });

  test('cannot be discarded as a stage resource because it would drop the total below 3', () => {
    const state = orgState(Alignment.FallenWizard, [inPlay(FORTRESS_OF_ISEN, 'p1-1000')]);
    expect(viableActions(state, PLAYER_1, 'discard-stage-resource')).toHaveLength(0);
  });

  test('with another stage card present, the other card (not the Fortress) is the discardable one', () => {
    const stageDef = {
      cardType: 'minion-resource-event', alignment: 'stage', id: STAGE_2,
      name: 'Test Stage Two', unique: false, eventType: 'permanent',
      marshallingPoints: 0, marshallingCategory: 'misc',
      effects: [{ type: 'stage-points', value: 2 }], text: 'Gives 2 stage points.',
    };
    (pool as Record<string, unknown>)[STAGE_2 as string] = stageDef;
    try {
      const state = orgState(Alignment.FallenWizard, [inPlay(FORTRESS_OF_ISEN, 'p1-1000'), inPlay(STAGE_2, 'p1-1001')]);
      expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(5);

      const targets = viableActions(state, PLAYER_1, 'discard-stage-resource')
        .map(a => (a.action as { cardInstanceId: string }).cardInstanceId);
      expect(targets).toContain('p1-1001');
      expect(targets).not.toContain('p1-1000');

      const after = dispatch(state, { type: 'discard-stage-resource', player: PLAYER_1, cardInstanceId: 'p1-1001' as CardInstanceId });
      expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(3);
      expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === 'p1-1000')).toBe(true);
    } finally {
      delete (pool as Record<string, unknown>)[STAGE_2 as string];
    }
  });
});
