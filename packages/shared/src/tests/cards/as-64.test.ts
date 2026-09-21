/**
 * @module as-64.test
 *
 * Card test: Nûrniags (as-64)
 * Type: hero-resource-faction
 * Race: man
 * Effects: 3
 *
 * "Unique. Manifestation of minion Nûrniags. Playable at Nûrniag Camp if the
 *  influence check is greater than 13 (Muster has no effect on this
 *  attempt). Standard Modifications: Wizards (-5), Men (+1)."
 *
 * Rules tested:
 * 1. influenceNumber = 14 (check > 13 means minimum total of 14)
 * 2. Wizards receive a -5 check modifier when influencing this faction
 * 3. Men receive a +1 check modifier when influencing this faction
 * 4. Other races receive no check modifier
 * 5. Muster's one-shot influence boost has no effect on this attempt
 *    (block-influence-boost)
 * 6. Manifestation uniqueness: cannot play if the minion version (le-273) is
 *    already in play
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, GANDALF, THEODEN,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER, HAZARD_PLAYER,
  addCardInPlay, firstFactionInfluenceAttempt,
} from '../test-helpers.js';
import { addConstraint } from '../../engine/pending.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, InfluenceAttemptAction } from '../../index.js';

const NURNIAG_CAMP = 'as-140' as CardDefinitionId;
const NURNIAGS_HERO = 'as-64' as CardDefinitionId;
const NURNIAGS_MINION = 'le-273' as CardDefinitionId;
const MUSTER = 'tw-288' as CardDefinitionId;

describe('Nûrniags (as-64)', () => {
  beforeEach(() => resetMint());

  test('Wizard character gets -5 check modifier when influencing', () => {
    // Gandalf (wizard, base DI 10) attempts to influence Nûrniags at Nûrniag Camp.
    // Influence number = 14.
    //   modifier = DI 10 + checkMod(-5) = 5
    //   need = 14 - 5 = 9
    const state = buildSitePhaseState({
      characters: [GANDALF],
      site: NURNIAG_CAMP,
      hand: [NURNIAGS_HERO],
    });

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const gandalfAttempt = influenceActions.find(
      a => a.influencingCharacterId === gandalfId,
    );
    expect(gandalfAttempt).toBeDefined();
    expect(gandalfAttempt!.need).toBe(9);
  });

  test('Man character gets +1 check modifier when influencing', () => {
    // Théoden (man, base DI 3) attempts to influence Nûrniags at Nûrniag Camp.
    // Influence number = 14.
    //   modifier = DI 3 + checkMod(1) = 4
    //   need = 14 - 4 = 10
    const state = buildSitePhaseState({
      characters: [THEODEN],
      site: NURNIAG_CAMP,
      hand: [NURNIAGS_HERO],
    });

    const theodenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const theodenAttempt = influenceActions.find(
      a => a.influencingCharacterId === theodenId,
    );
    expect(theodenAttempt).toBeDefined();
    expect(theodenAttempt!.need).toBe(10);
  });

  test('non-Wizard/Man character gets no check modifier', () => {
    // Aragorn (dunadan, base DI 3) attempts to influence Nûrniags at Nûrniag Camp.
    // Influence number = 14.
    //   modifier = DI 3 (no bonus)
    //   need = 14 - 3 = 11
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: NURNIAG_CAMP,
      hand: [NURNIAGS_HERO],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const aragornAttempt = influenceActions.find(
      a => a.influencingCharacterId === aragornId,
    );
    expect(aragornAttempt).toBeDefined();
    expect(aragornAttempt!.need).toBe(11);
  });

  test('Muster\'s influence boost has no effect on this attempt', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: NURNIAG_CAMP,
      hand: [NURNIAGS_HERO],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const factionInst = base.players[RESOURCE_PLAYER].hand[0].instanceId;

    // Baseline (no Muster): need = 14 - DI(3) = 11.
    expect(firstFactionInfluenceAttempt(base, factionInst)!.need).toBe(11);

    // A Muster boost (+5) applied to the influencer would normally lower the
    // need to 14 - (3 + 5) = 6, but Nûrniags's own text suppresses it.
    const withMuster = addConstraint(base, {
      source: 'muster-1' as CardInstanceId,
      sourceDefinitionId: MUSTER,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: aragornId },
      kind: { type: 'check-modifier', check: 'influence', value: 5 },
    });
    expect(firstFactionInfluenceAttempt(withMuster, factionInst)!.need).toBe(11);
  });

  test('manifestation uniqueness: hero version cannot be played if minion version is in play', () => {
    // The engine's name-based faction uniqueness check prevents playing as-64 when
    // le-273 (same name "Nûrniags") is already in any player's cardsInPlay.
    const base = buildSitePhaseState({
      characters: [GANDALF],
      site: NURNIAG_CAMP,
      hand: [NURNIAGS_HERO],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, NURNIAGS_MINION);

    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions.filter(
      a => a.viable && a.action.type === 'influence-attempt',
    );
    expect(influenceActions).toHaveLength(0);

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable',
    );
    expect(notPlayable).toBeDefined();
  });
});
