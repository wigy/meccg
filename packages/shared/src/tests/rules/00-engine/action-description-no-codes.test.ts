/**
 * @module action-description-no-codes.test
 *
 * Regression for bug report "p1 in legal actions" (game mr9jvlnw-2ldyce,
 * seq 368): during the opponent's movement/hazard phase the hazard player
 * is offered player-prefixed actions (e.g. `discard-card-for-hazard-limit`).
 * `describeAction` rendered `${action.player}` as the raw internal player
 * code ("p1"/"p2") and the target company as its raw id ("company-p2-0").
 *
 * Legal-action button text is user-facing and must never surface internal
 * codes: player ids resolve through the supplied name map (or fall back to a
 * neutral word), and company ids resolve through the company-name map.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, P1_COMPANY,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  viableActions, addCardInPlay,
  HAZARD_PLAYER, RESOURCE_PLAYER,
  pool,
} from '../../test-helpers.js';
import { Phase, Alignment, describeAction, buildCompanyNames } from '../../../index.js';
import { resolveInstanceId } from '../../../types/state.js';
import type { CardDefinitionId, CardInstanceId, GameAction } from '../../../index.js';

// Daelomin at Home — a hazard permanent the hazard player may discard from
// play during the opponent's M/H phase to raise the hazard limit by two.
const DAELOMIN_AT_HOME = 'td-11' as CardDefinitionId;

describe('legal-action descriptions never leak raw ids (bug: "p1 in legal actions")', () => {
  beforeEach(() => resetMint());

  test('a hazard-player M/H action resolves the player and company ids to names', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    state = addCardInPlay(state, HAZARD_PLAYER, DAELOMIN_AT_HOME);
    state = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }) };

    const actions = viableActions(state, PLAYER_2, 'discard-card-for-hazard-limit');
    expect(actions.length).toBeGreaterThan(0);

    const instLookup = (id: string) => resolveInstanceId(state, id as never);
    const companyNames = buildCompanyNames(
      state.players[RESOURCE_PLAYER].companies,
      state.players[RESOURCE_PLAYER].characters,
      pool,
    );
    const playerNames = { [PLAYER_2 as string]: 'Sauron' };

    // With a name map, the player code resolves to the display name and no
    // raw player ("p1"/"p2") or company ("company-…") code appears.
    const desc = describeAction(actions[0].action, pool, instLookup, companyNames, playerNames);
    expect(desc).toContain('Sauron');
    expect(desc).not.toMatch(/\bp[12]\b/);
    expect(desc).not.toContain('company-');

    // Even without a name map, the fallback is a neutral word — never a code.
    const bare = describeAction(actions[0].action, pool, instLookup, companyNames);
    expect(bare).not.toMatch(/\bp[12]\b/);
    expect(bare).not.toContain('company-');
  });
});

describe('movement/attack action descriptions resolve the company id (no raw "company-…" code)', () => {
  // These describeAction branches interpolated the raw CompanyId
  // ("company-p1-0" — which also embeds the internal player code "p1")
  // instead of routing it through the company-name map, the same contract the
  // test above enforces for discard-card-for-hazard-limit. Reaching each of
  // these actions through the engine needs an elaborate, card-specific setup;
  // describeAction is a pure function, so the shared invariant is covered here
  // by constructing each action directly with a real internal company id.
  const inst = 'x1' as CardInstanceId;
  const companyNames = { [P1_COMPANY as string]: "Aragorn's company" };
  const playerNames = { [PLAYER_1 as string]: 'Frodo' };

  const actions: readonly GameAction[] = [
    { type: 'run-home', player: PLAYER_1, companyId: P1_COMPANY, allyInstanceId: inst },
    { type: 'attack-alt-permanent-event', player: PLAYER_1, cardInstanceId: inst, targetCompanyId: P1_COMPANY },
    { type: 'gangways-extra-move', player: PLAYER_1, companyId: P1_COMPANY, destinationSite: inst },
    { type: 'extra-mh-move', player: PLAYER_1, companyId: P1_COMPANY, destinationSite: inst },
    { type: 'ally-tap-extra-mh-phase', player: PLAYER_1, companyId: P1_COMPANY, allyInstanceId: inst },
    { type: 'character-tap-extra-mh-phase', player: PLAYER_1, companyId: P1_COMPANY, characterInstanceId: inst },
    { type: 'discard-for-evil-hour-movement', player: PLAYER_1, cardInstanceId: inst, companyId: P1_COMPANY },
    { type: 'left-behind-rejoin', player: PLAYER_1, companyId: P1_COMPANY },
    { type: 'pay-movement-tax', player: PLAYER_1, companyId: P1_COMPANY, characterId: inst },
  ].map(a => a as unknown as GameAction);

  test.each(actions.map(a => [a.type, a] as const))(
    '%s renders the company name and leaks no raw code',
    (_type, action) => {
      const desc = describeAction(action, pool, {}, companyNames, playerNames);
      expect(desc).toContain("Aragorn's company");
      expect(desc).not.toContain('company-');
      expect(desc).not.toMatch(/\bp[12]\b/);
    },
  );
});
