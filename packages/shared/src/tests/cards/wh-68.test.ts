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
 * The site-specific sibling of Guarded Haven (wh-74), bound to the Fallen-wizard
 * Wizardhaven version of Isengard (wh-56). Uses master's shared `site-protected`
 * mechanism, exactly like Fortress of the Towers (wh-69) / wh-74:
 *  - `play-target` site `{ name: "Isengard" }` — only offered while the active
 *    company is at Isengard; the play binds the card to that site
 *    (`attachedToSite`).
 *  - `play-condition` player-state `{ player.avatar: { $in: [Alatar, Pallando,
 *    Saruman] } }` — "Playable if you are Alatar, Pallando, or Saruman."
 *  - `self-enters-play → add-constraint site-protected` (scope until-cleared,
 *    targeted at the controlling player): the opponent may not play a
 *    marshalling-point card at the protected site (shared
 *    `siteIsProtectedAgainstPlayer` + `givesMarshallingPoints` in
 *    `legal-actions/site.ts`).
 *  - `stage-points: 3`.
 *  - `discardOrphanedSiteAttachedEvents` discards the card and clears its
 *    constraint once no company occupies the bound site.
 *
 * | # | Rule                                                      | Status |
 * |---|-----------------------------------------------------------|--------|
 * | 1 | Unique                                                    | OK     |
 * | 2 | carries 3 stage points                                    | OK     |
 * | 3 | may not be a starting stage card                          | vacuous: the engine has no starting-stage-deck, so a stage card can never be placed at setup — the rule is never violable |
 * | 4 | playable only if you are Alatar/Pallando/Saruman          | OK     |
 * | 5 | playable on Isengard (bound to the site)                  | OK     |
 * | 6 | Isengard is protected                                     | OK (site-protected) |
 * | 7 | other Fallen-wizards may not Wizardhaven Isengard         | no-op (single-Fallen-wizard, two-player engine) |
 * | 8 | opponent cannot play MP-giving cards at Isengard          | OK     |
 * | 9 | discard when the site is discarded / returned to its deck | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, CardStatus, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, GameState, PlayerId, ConstraintId } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import {
  buildTestState, resetMint, viableActions, pool, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  RIVENDELL, MINAS_TIRITH, ARAGORN,
  buildFallenWizardOrgPhaseState, buildFallenWizardSitePhaseState, buildSitePhaseState, playPermanentEventAndResolve,
} from '../test-helpers.js';

const FORTRESS_OF_ISEN = 'wh-68' as CardDefinitionId;
const ISENGARD_WH = 'wh-56' as CardDefinitionId;        // FW Wizardhaven "Isengard"
const WHITE_TOWERS_WH = 'wh-58' as CardDefinitionId;    // FW Wizardhaven "The White Towers" (wrong site)
const HIMRING = 'tw-401' as CardDefinitionId;           // hero Ruins & Lairs (plays minor+major)

// Fallen-wizard avatars.
const SARUMAN_FW = 'wh-9' as CardDefinitionId;          // qualifies
const ALATAR_FW = 'wh-1' as CardDefinitionId;           // qualifies
const GANDALF_FW = 'wh-4' as CardDefinitionId;          // does NOT qualify

// Hero items for the opponent MP-block tests (Himring plays minor + major).
const HAUBERK = 'tw-254' as CardDefinitionId;           // hero major item, MP 2
const DAGGER = 'tw-206' as CardDefinitionId;            // hero minor item, 0 MP

// A second stage card so a discard can be offered without dropping below 3.
const STAGE_2 = 'test-stage-res-2' as CardDefinitionId;

function inPlay(defId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId: defId, status: CardStatus.Untapped };
}

function handInstance(state: GameState, defId: CardDefinitionId): CardInstanceId {
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

/** A `site-protected` active constraint owned by `owner`, bound to `siteDefId`. */
function siteProtectedConstraint(owner: PlayerId, siteDefId: CardDefinitionId) {
  return {
    id: 'fortress-isen-block' as ConstraintId,
    source: 'fortress-isen-src' as CardInstanceId,
    sourceDefinitionId: FORTRESS_OF_ISEN,
    scope: { kind: 'until-cleared' as const },
    target: { kind: 'player' as const, playerId: owner },
    kind: { type: 'site-protected' as const, siteDefinitionId: siteDefId },
  };
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

  // ── Rule 5.F1: a Stage resource is played during the organization phase ─────

  // Regression (bug report mquxfmpa-ht4isa, seq 67): Saruman's company is at
  // Isengard during the organization phase with The Fortress of Isen in hand,
  // but the engine did not offer it — site-targeting Stage resources were
  // mistakenly gated to the site phase. Rule 5.F1 makes them organization-phase
  // only, so the play must be offered here (and not during the site phase).
  test('[rule 5.F1] playable during the organization phase, not the site phase', () => {
    const org = buildFallenWizardOrgPhaseState({ site: ISENGARD_WH, characters: [SARUMAN_FW], hand: [FORTRESS_OF_ISEN] });
    expect(canPlay(org, PLAYER_1, handInstance(org, FORTRESS_OF_ISEN))).toBe(true);

    const sitePhase = buildFallenWizardSitePhaseState({ site: ISENGARD_WH, characters: [SARUMAN_FW], hand: [FORTRESS_OF_ISEN] });
    expect(canPlay(sitePhase, PLAYER_1, handInstance(sitePhase, FORTRESS_OF_ISEN))).toBe(false);
  });

  // ── Rule 5: playable on Isengard, bound to that site ───────────────────────

  test('playable while a qualifying Fallen-wizard is at Isengard — the play binds it to the site', () => {
    const state = buildFallenWizardOrgPhaseState({ site: ISENGARD_WH, characters: [SARUMAN_FW], hand: [FORTRESS_OF_ISEN] });
    const id = handInstance(state, FORTRESS_OF_ISEN);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId).toBe(ISENGARD_WH);
  });

  test('not playable at any site other than Isengard', () => {
    const state = buildFallenWizardOrgPhaseState({ site: WHITE_TOWERS_WH, characters: [SARUMAN_FW], hand: [FORTRESS_OF_ISEN] });
    expect(canPlay(state, PLAYER_1, handInstance(state, FORTRESS_OF_ISEN))).toBe(false);
  });

  test('playing it binds the card to Isengard and adds the site-protected constraint', () => {
    const state = buildFallenWizardOrgPhaseState({ site: ISENGARD_WH, characters: [SARUMAN_FW], hand: [FORTRESS_OF_ISEN] });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, handInstance(state, FORTRESS_OF_ISEN), undefined, { targetSiteDefinitionId: ISENGARD_WH },
    );

    const card = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === FORTRESS_OF_ISEN);
    expect(card).toBeDefined();
    expect(card!.attachedToSite).toBe(ISENGARD_WH);

    const constraint = after.activeConstraints.find(
      c => c.kind.type === 'site-protected' && c.kind.siteDefinitionId === ISENGARD_WH,
    );
    expect(constraint).toBeDefined();
    expect(constraint!.scope.kind).toBe('until-cleared');
    expect(constraint!.target.kind).toBe('player');
    expect((constraint!.target as { playerId?: PlayerId }).playerId).toBe(PLAYER_1);
  });

  // ── Rule 4: playable only if you are Alatar, Pallando, or Saruman ───────────

  test('not playable when your avatar is a non-qualifying Fallen-wizard (Gandalf)', () => {
    const state = buildFallenWizardOrgPhaseState({ site: ISENGARD_WH, characters: [GANDALF_FW], hand: [FORTRESS_OF_ISEN] });
    expect(canPlay(state, PLAYER_1, handInstance(state, FORTRESS_OF_ISEN))).toBe(false);
  });

  test('playable when your avatar is Alatar', () => {
    const state = buildFallenWizardOrgPhaseState({ site: ISENGARD_WH, characters: [ALATAR_FW], hand: [FORTRESS_OF_ISEN] });
    expect(canPlay(state, PLAYER_1, handInstance(state, FORTRESS_OF_ISEN))).toBe(true);
  });

  // Regression (bug report mqxur28y-to5dzj, seq 48): a Saruman Fallen-wizard
  // whose avatar has *not yet been played* (it is still in the play deck) has a
  // company at Isengard with The Fortress of Isen in hand. The engine refused
  // the play because it inferred wizard identity solely from the avatar in
  // play. Per CoE 1.8.F1 / 2.2.F2 a Fallen-wizard counts "as" their declared
  // avatar from game start until the avatar is *eliminated* — the avatar need
  // not be in play — so the card must be offered.
  test('[CoE 2.2.F2] playable while your declared Saruman avatar is still in the deck (not yet in play)', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: ISENGARD_WH, characters: [ARAGORN], hand: [FORTRESS_OF_ISEN], playDeck: [SARUMAN_FW],
    });
    expect(canPlay(state, PLAYER_1, handInstance(state, FORTRESS_OF_ISEN))).toBe(true);
  });

  // The flip side of CoE 2.2.F2: once the declared avatar has been *eliminated*
  // (it sits in the removed-from-play pile), the player no longer counts as
  // that Fallen-wizard and the card is no longer playable.
  test('[CoE 2.2.F2] not playable once your Saruman avatar has been eliminated', () => {
    const built = buildFallenWizardOrgPhaseState({
      site: ISENGARD_WH, characters: [ARAGORN], hand: [FORTRESS_OF_ISEN], playDeck: [SARUMAN_FW],
    });
    const fw = built.players[RESOURCE_PLAYER];
    const eliminated = fw.playDeck.find(c => c.definitionId === SARUMAN_FW)!;
    const state: GameState = {
      ...built,
      players: [
        { ...fw, playDeck: fw.playDeck.filter(c => c !== eliminated), outOfPlayPile: [...fw.outOfPlayPile, eliminated] },
        built.players[1],
      ] as GameState['players'],
    };
    expect(canPlay(state, PLAYER_1, handInstance(state, FORTRESS_OF_ISEN))).toBe(false);
  });

  // ── Rule 8: opponent cannot play MP-giving cards at the protected site ─────

  test('an opponent may not play a marshalling-point item at the protected site', () => {
    // PLAYER_1 (the active player) is the opponent of the Fortress owner
    // (PLAYER_2): the constraint targets PLAYER_2, so PLAYER_1 is barred.
    const base = buildSitePhaseState({ site: HIMRING, characters: [ARAGORN], hand: [HAUBERK] });
    const hauberk = handInstance(base, HAUBERK);
    expect(canPlay(base, PLAYER_1, hauberk)).toBe(true);

    const blocked: GameState = { ...base, activeConstraints: [siteProtectedConstraint(PLAYER_2, HIMRING)] };
    expect(canPlay(blocked, PLAYER_1, hauberk)).toBe(false);
  });

  test('a card that gives no marshalling points is still playable under protection', () => {
    const base = buildSitePhaseState({ site: HIMRING, characters: [ARAGORN], hand: [DAGGER] });
    const dagger = handInstance(base, DAGGER);
    const blocked: GameState = { ...base, activeConstraints: [siteProtectedConstraint(PLAYER_2, HIMRING)] };
    expect(canPlay(blocked, PLAYER_1, dagger)).toBe(true);
  });

  test('the Fortress owner is not blocked from playing MP cards at their own protected site', () => {
    const base = buildSitePhaseState({ site: HIMRING, characters: [ARAGORN], hand: [HAUBERK] });
    const hauberk = handInstance(base, HAUBERK);
    const owned: GameState = { ...base, activeConstraints: [siteProtectedConstraint(PLAYER_1, HIMRING)] };
    expect(canPlay(owned, PLAYER_1, hauberk)).toBe(true);
  });

  // ── Rule 9: discard when the bound site leaves play ────────────────────────

  test('persists while a company occupies Isengard', () => {
    const state = buildFallenWizardOrgPhaseState({ site: ISENGARD_WH, characters: [SARUMAN_FW], hand: [FORTRESS_OF_ISEN] });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, handInstance(state, FORTRESS_OF_ISEN), undefined, { targetSiteDefinitionId: ISENGARD_WH },
    );
    const swept = discardOrphanedSiteAttachedEvents(after);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === FORTRESS_OF_ISEN)).toBe(true);
  });

  test('discarded (and its constraint cleared) once Isengard leaves play', () => {
    const state = buildFallenWizardOrgPhaseState({ site: ISENGARD_WH, characters: [SARUMAN_FW], hand: [FORTRESS_OF_ISEN] });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, handInstance(state, FORTRESS_OF_ISEN), undefined, { targetSiteDefinitionId: ISENGARD_WH },
    );
    const sourceId = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === FORTRESS_OF_ISEN)!.instanceId;
    expect(after.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(1);

    // The last company leaves Isengard (arrives at a new destination), so the
    // haven returns to its location deck.
    const movedCompany = {
      ...after.players[RESOURCE_PLAYER].companies[0],
      currentSite: { ...after.players[RESOURCE_PLAYER].companies[0].currentSite!, definitionId: WHITE_TOWERS_WH },
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
    } finally {
      delete (pool as Record<string, unknown>)[STAGE_2 as string];
    }
  });
});
