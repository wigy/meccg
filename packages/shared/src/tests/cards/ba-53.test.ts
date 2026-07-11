/**
 * @module ba-53.test
 *
 * Card test: Cloaked by Darkness (ba-53)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Balrog specific.
 *
 * Text:
 *   "Balrog specific. Playable on a company if Great Shadow is in play. You may
 *    bring this card from your sideboard into your play deck and reshuffle
 *    during your organization phase. The hazard limit against the company is
 *    reduced by one to no minimum."
 *
 * Rules:
 *   1. Play gate — `play-window` (organization / end-of-org) + `play-condition`
 *      (`card-in-play`, "Great Shadow"). Great Shadow (ba-62) is a
 *      permanent-event held on The Balrog; the gate is attachment-aware.
 *   2. Company target — `play-target` `company` (any of the player's companies);
 *      one play action per company, carrying `targetCompanyId`.
 *   3. Main effect — `on-event self-enters-play` → `add-constraint`
 *      `hazard-limit-modifier` value `-1`, scope `company-mh-phase`, targeting
 *      the chosen company. The card is discarded on play.
 *   4. The −1 reduces the company's hazard limit when it is set at reveal, with
 *      no minimum: a base of 1 is reduced to 0 (never floored above 0).
 *   5. Sideboard self-relocation — a `move` (`select: self`, `from: sideboard`,
 *      `to: deck`, `shuffleAfter`) surfaced during the organization phase as a
 *      dedicated `card-sideboard-to-deck` action; taps nothing.
 *
 * "Balrog specific" is a deck-construction keyword (`balrog-specific`), no
 * play-time gate — per the ba-45/ba-46 precedent.
 *
 * Rule coverage:
 * | # | Rule                                                                 | Status      |
 * |---|----------------------------------------------------------------------|-------------|
 * | 1 | NOT playable while Great Shadow is not in play                        | IMPLEMENTED |
 * | 2 | Playable at end-of-org once Great Shadow is in play; targetCompanyId  | IMPLEMENTED |
 * | 3 | Playing it adds hazard-limit-modifier −1 on the company; card discard | IMPLEMENTED |
 * | 4 | The −1 reduces the hazard limit set at reveal                         | IMPLEMENTED |
 * | 5 | No minimum: a base-1 limit is reduced to 0                            | IMPLEMENTED |
 * | 6 | NOT playable during the site phase (play-window: organization)        | IMPLEMENTED |
 * | 7 | Sideboard copy offers card-sideboard-to-deck; dispatch → play deck     | IMPLEMENTED |
 * | 8 | No card-sideboard-to-deck offered when no such card is in sideboard   | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   BA_53 (ba-53)         - minion short event (this card)
 *   GREAT_SHADOW (ba-62)  - minion permanent-event held on The Balrog (the gate)
 *   THE_BALROG (ba-3)     - minion balrog avatar
 *   LUITPRAND (le-23)     - minion man (second company member)
 *   VARIAG_CAMP (le-411)  - minion border-hold (Khand)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, makeMHState, resetMint, dispatch,
  viableActions, findHandCardId, expectInDiscardPile,
  MINAS_TIRITH, PLAYER_1, PLAYER_2, Phase, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, MovementHazardPhaseState,
  PlayShortEventAction,
} from '../../index.js';
import { Alignment } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const BA_53 = 'ba-53' as CardDefinitionId;
const GREAT_SHADOW = 'ba-62' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;

/** The ba-53 play-short-event actions offered as viable to PLAYER_1. */
function cloakPlays(state: GameState): PlayShortEventAction[] {
  const inst = findHandCardId(state, RESOURCE_PLAYER, BA_53);
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => a.cardInstanceId === inst);
}

describe('Cloaked by Darkness (ba-53)', () => {
  beforeEach(() => resetMint());

  // ─── Play gate (Great Shadow) ───────────────────────────────────────────────

  test('NOT playable during the organization phase while Great Shadow is not in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [THE_BALROG] }],
          hand: [BA_53], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(cloakPlays(state)).toHaveLength(0);
    // The card is still surfaced, but as not-playable with a Great Shadow reason.
    const inst = findHandCardId(state, RESOURCE_PLAYER, BA_53);
    const notPlayable = computeLegalActions(state, PLAYER_1).filter(
      ea => !ea.viable && ea.action.type === 'not-playable' && ea.action.cardInstanceId === inst,
    );
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('playable at end-of-org once Great Shadow is in play (permanent-event on The Balrog)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [{ defId: THE_BALROG, items: [GREAT_SHADOW] }] }],
          hand: [BA_53], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const plays = cloakPlays(state);
    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(state.players[RESOURCE_PLAYER].companies[0].id);
  });

  test('NOT playable during the site phase even with Great Shadow in play (play-window: organization)', () => {
    const base = buildSitePhaseState({
      characters: [{ defId: THE_BALROG, items: [GREAT_SHADOW] }],
      site: VARIAG_CAMP,
      hand: [BA_53],
    });
    const state = {
      ...base,
      players: [{ ...base.players[0], alignment: Alignment.Ringwraith }, base.players[1]] as typeof base.players,
    };
    expect(cloakPlays(state)).toHaveLength(0);
  });

  // ─── Main effect: hazard-limit-modifier −1 on the company ────────────────────

  test('playing it adds a hazard-limit-modifier −1 on the target company (company-mh-phase) and discards the card', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [{ defId: THE_BALROG, items: [GREAT_SHADOW] }] }],
          hand: [BA_53], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, BA_53);
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;
    const after = dispatch(state, cloakPlays(state)[0]);

    const mods = after.activeConstraints.filter(c => c.kind.type === 'hazard-limit-modifier');
    expect(mods).toHaveLength(1);
    const mod = mods[0];
    if (mod.kind.type === 'hazard-limit-modifier') expect(mod.kind.value).toBe(-1);
    expect(mod.scope.kind).toBe('company-mh-phase');
    expect(mod.target.kind).toBe('company');
    if (mod.target.kind === 'company') expect(mod.target.companyId).toBe(companyId);

    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  // ─── End-to-end: the −1 reduces the hazard limit set at reveal ───────────────

  test('the −1 reduces the hazard limit locked in at reveal (2-char company: 2 → 1)', () => {
    const org = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [{ defId: THE_BALROG, items: [GREAT_SHADOW] }, LUITPRAND] }],
          hand: [BA_53], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const setHazardLimit = (s: GameState) =>
      dispatch(
        { ...s, phaseState: makeMHState({ step: 'set-hazard-limit', activeCompanyIndex: 0, hazardLimitAtReveal: 0 }) },
        { type: 'pass', player: PLAYER_1 },
      );

    // Control: without playing ba-53, a 2-character company locks in base 2.
    const control = setHazardLimit(org);
    expect((control.phaseState as MovementHazardPhaseState).hazardLimitAtReveal).toBe(2);

    // Play ba-53, then reveal: the folded −1 constraint drops the limit to 1.
    const afterPlay = dispatch(org, cloakPlays(org)[0]);
    const revealed = setHazardLimit(afterPlay);
    expect((revealed.phaseState as MovementHazardPhaseState).hazardLimitAtReveal).toBe(1);
  });

  test('no minimum: a base-1 hazard limit is reduced to 0', () => {
    // Solo company (base max(1,2)=2) with the hazard player having accessed the
    // sideboard during untap → halved to ceil(2/2)=1. ba-53 then reduces it to 0.
    const org = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [{ defId: THE_BALROG, items: [GREAT_SHADOW] }] }],
          hand: [BA_53], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const afterPlay = dispatch(org, cloakPlays(org)[0]);
    // Hazard player (P2) accessed the sideboard during untap → base limit halved.
    const mhReady: GameState = {
      ...afterPlay,
      players: [
        afterPlay.players[0],
        { ...afterPlay.players[1], sideboardAccessedDuringUntap: true },
      ] as typeof afterPlay.players,
      phaseState: makeMHState({ step: 'set-hazard-limit', activeCompanyIndex: 0, hazardLimitAtReveal: 0 }),
    };
    const revealed = dispatch(mhReady, { type: 'pass', player: PLAYER_1 });
    expect((revealed.phaseState as MovementHazardPhaseState).hazardLimitAtReveal).toBe(0);
  });

  // ─── Sideboard self-relocation ───────────────────────────────────────────────

  test('a sideboard copy offers a card-sideboard-to-deck action during the org phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [THE_BALROG] }],
          hand: [], sideboard: [BA_53], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sideboardInst = state.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    const offers = viableActions(state, PLAYER_1, 'card-sideboard-to-deck')
      .map(ea => ea.action as { cardInstanceId: CardInstanceId });
    expect(offers).toHaveLength(1);
    expect(offers[0].cardInstanceId).toBe(sideboardInst);
  });

  test('dispatching card-sideboard-to-deck moves the card from the sideboard into the play deck', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [THE_BALROG] }],
          hand: [], sideboard: [BA_53], playDeck: [MINAS_TIRITH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sideboardInst = state.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    const action = viableActions(state, PLAYER_1, 'card-sideboard-to-deck')[0].action;
    const after = dispatch(state, action);

    expect(after.players[RESOURCE_PLAYER].sideboard.map(c => c.instanceId)).not.toContain(sideboardInst);
    expect(after.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId)).toContain(sideboardInst);
    // No instance lost: it left the sideboard and joined the play deck.
    expect(after.players[RESOURCE_PLAYER].playDeck).toHaveLength(2);
  });

  test('no card-sideboard-to-deck action when no such card sits in the sideboard', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [THE_BALROG] }],
          hand: [], sideboard: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'card-sideboard-to-deck',
    )).toHaveLength(0);
  });
});
