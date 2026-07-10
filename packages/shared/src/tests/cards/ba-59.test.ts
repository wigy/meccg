/**
 * @module ba-59.test
 *
 * Card test: Foe Dismayed (ba-59)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Balrog specific.
 *
 * Text:
 *   "Balrog specific. +1 prowess against an attack for all characters in a
 *    leader's or The Balrog's company or +3 to an influence attempt by a
 *    leader or The Balrog."
 *
 * The card is dual-mode ("or"):
 *   - Combat mode: a `company-combat-boost` (prowess +1) gated by a
 *     `companyFilter` — the defending company must contain a Leader (keyword)
 *     or The Balrog; then EVERY character in the company is boosted.
 *   - Influence mode: `play-target` (character = a Leader or The Balrog) +
 *     `play-option influence-boost` (add-constraint check-modifier influence
 *     +3), mirroring Crooked Promptings (le-178). The +3 rides the chain and
 *     is consumed by the target's influence attempt.
 *
 * "Balrog specific" is a deck-construction keyword (`balrog-specific`), no
 * play-time gate — per the ba-45/ba-46 precedent.
 *
 * Rule coverage:
 * | # | Rule                                                                | Status      |
 * |---|---------------------------------------------------------------------|-------------|
 * | 1 | Combat: offered vs an attack when the company contains a Leader      | IMPLEMENTED |
 * | 2 | Combat: offered when the company contains The Balrog (name branch)   | IMPLEMENTED |
 * | 3 | Combat: NOT offered when the company has no Leader / Balrog          | IMPLEMENTED |
 * | 4 | Combat: +1 prowess applied to EVERY character in the company        | IMPLEMENTED |
 * | 5 | Combat: boost is attack-scoped (character-stat-modifier constraints) | IMPLEMENTED |
 * | 6 | Influence: +3 offered targeting a Leader during an influence attempt | IMPLEMENTED |
 * | 7 | Influence: NOT offered when no Leader / Balrog in the company        | IMPLEMENTED |
 * | 8 | Influence: applies a +3 influence check-modifier and discards card   | IMPLEMENTED |
 * | 9 | Influence: the +3 constraint reduces the influence-attempt need      | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   FOE_DISMAYED (ba-59)  - minion short event (this card)
 *   ORC_CAPTAIN (le-31)   - minion orc, keyword "leader", DI 0, prowess 5
 *   THE_BALROG (ba-3)     - minion balrog avatar, name "The Balrog", DI 6, prowess 8
 *   LUITPRAND (le-23)     - minion man, no leader keyword, DI 0, prowess 3
 *   VARIAG_CAMP (le-411)  - minion border-hold (Khand)
 *   VARIAGS (le-292)      - minion faction, influence# 9, playable at Variag Camp
 *   ORC_PATROL            - hazard creature (keyed to wilderness)
 *   MORIA                 - ruins & lairs site (combat site)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, buildInfluenceAttemptChainState,
  resetMint, makeMHState,
  playCreatureHazardAndResolve, resolveChain, dispatch,
  viableActions, handCardId, companyIdAt, findCharInstanceId, findHandCardId,
  ORC_PATROL, MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  PLAYER_1, PLAYER_2, Phase, RESOURCE_PLAYER, HAZARD_PLAYER,
  expectInDiscardPile,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, PlayShortEventAction } from '../../index.js';
import { Alignment, RegionType, SiteType } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint } from '../../engine/pending.js';

const FOE_DISMAYED = 'ba-59' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;   // leader
const THE_BALROG = 'ba-3' as CardDefinitionId;      // name "The Balrog"
const LUITPRAND = 'le-23' as CardDefinitionId;      // non-leader man
const VARIAG_CAMP = 'le-411' as CardDefinitionId;
const VARIAGS = 'le-292' as CardDefinitionId;

/** Build a minion M/H state with the given characters in PLAYER_1's company at Moria. */
function buildMinionMHState(chars: CardDefinitionId[]) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: MORIA, characters: chars }],
        hand: [FOE_DISMAYED], siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [ORC_PATROL], siteDeck: [RIVENDELL],
      },
    ],
  });
  const mhState = makeMHState({
    activeCompanyIndex: 0,
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Rhûn'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Moria',
  });
  return { ...base, phaseState: mhState };
}

/** Play ORC_PATROL against PLAYER_1's company and resolve the chain into combat. */
function triggerOrcCombat(state: ReturnType<typeof buildMinionMHState>) {
  const orcId = handCardId(state, HAZARD_PLAYER);
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  return playCreatureHazardAndResolve(state, PLAYER_2, orcId, companyId, {
    method: 'region-type',
    value: 'wilderness',
  });
}

describe('Foe Dismayed (ba-59)', () => {
  beforeEach(() => resetMint());

  // ─── Combat mode ───────────────────────────────────────────────────────────

  test('combat: offered in the pre-assignment window when the company contains a Leader', () => {
    const state = buildMinionMHState([ORC_CAPTAIN, LUITPRAND]);
    const combat = triggerOrcCombat(state);
    expect(combat.combat).toBeDefined();
    expect(combat.combat!.phase).toBe('assign-strikes');

    const actions = viableActions(combat, PLAYER_1, 'play-short-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('combat: offered when the company contains The Balrog (name branch, no leader keyword)', () => {
    const state = buildMinionMHState([THE_BALROG]);
    const combat = triggerOrcCombat(state);
    expect(combat.combat).toBeDefined();
    const actions = viableActions(combat, PLAYER_1, 'play-short-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('combat: NOT offered when the company has no Leader nor The Balrog', () => {
    const state = buildMinionMHState([LUITPRAND]);
    const combat = triggerOrcCombat(state);
    expect(combat.combat).toBeDefined();
    const actions = viableActions(combat, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  test('combat: +1 prowess applied to EVERY character in the company (Leader gates, non-leader boosted too)', () => {
    const state = buildMinionMHState([ORC_CAPTAIN, LUITPRAND]);
    const combat = triggerOrcCombat(state);

    const boostActions = viableActions(combat, PLAYER_1, 'play-short-event');
    expect(boostActions.length).toBeGreaterThan(0);
    const afterPlay = dispatch(combat, boostActions[0].action);

    const capId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, ORC_CAPTAIN);
    const luitId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, LUITPRAND);
    // Orc Captain base prowess 5 → 6; Luitprand base prowess 3 → 4.
    expect(afterPlay.players[RESOURCE_PLAYER].characters[capId].effectiveStats.prowess).toBe(6);
    expect(afterPlay.players[RESOURCE_PLAYER].characters[luitId].effectiveStats.prowess).toBe(4);
  });

  test('combat: The Balrog itself is boosted by the name branch', () => {
    const state = buildMinionMHState([THE_BALROG]);
    const combat = triggerOrcCombat(state);
    const boostActions = viableActions(combat, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(combat, boostActions[0].action);
    const balrogId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, THE_BALROG);
    // The Balrog base prowess 8 → 9.
    expect(afterPlay.players[RESOURCE_PLAYER].characters[balrogId].effectiveStats.prowess).toBe(9);
  });

  test('combat: the boost is applied as attack-scoped character-stat-modifier constraints', () => {
    const state = buildMinionMHState([ORC_CAPTAIN, LUITPRAND]);
    const combat = triggerOrcCombat(state);
    expect(combat.activeConstraints.filter(c => c.scope.kind === 'attack')).toHaveLength(0);

    const boostActions = viableActions(combat, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(combat, boostActions[0].action);

    const attackConstraints = afterPlay.activeConstraints.filter(c => c.scope.kind === 'attack');
    // One prowess modifier per character in the company (2 characters).
    expect(attackConstraints).toHaveLength(2);
    for (const c of attackConstraints) {
      expect(c.kind.type).toBe('character-stat-modifier');
      if (c.kind.type === 'character-stat-modifier') {
        expect(c.kind.stat).toBe('prowess');
        expect(c.kind.value).toBe(1);
      }
    }
  });

  // ─── Influence mode ─────────────────────────────────────────────────────────

  test('influence: +3 boost offered targeting a Leader during an active influence attempt', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ORC_CAPTAIN],
      site: VARIAG_CAMP,
      hand: [FOE_DISMAYED, VARIAGS],
      factionDefId: VARIAGS,
    });
    const capId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const offers = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'influence-boost' && a.targetCharacterId === capId);
    expect(offers).toHaveLength(1);
  });

  test('influence: NOT offered when the company has no Leader nor The Balrog', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [LUITPRAND],
      site: VARIAG_CAMP,
      hand: [FOE_DISMAYED, VARIAGS],
      factionDefId: VARIAGS,
    });
    const offers = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'influence-boost');
    expect(offers).toHaveLength(0);
  });

  test('influence: playing the boost adds a +3 influence check-modifier and discards the card', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ORC_CAPTAIN],
      site: VARIAG_CAMP,
      hand: [FOE_DISMAYED, VARIAGS],
      factionDefId: VARIAGS,
    });
    const capId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, FOE_DISMAYED);
    // The boost rides the chain; resolve it (both players pass) so the
    // constraint applies on resolution.
    const after = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: capId,
      optionId: 'influence-boost',
    }));
    const constraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(constraints).toHaveLength(1);
    if (constraints[0].kind.type === 'check-modifier') {
      expect(constraints[0].kind.value).toBe(3);
      expect(constraints[0].target.kind).toBe('character');
      if (constraints[0].target.kind === 'character') {
        expect(constraints[0].target.characterId).toBe(capId);
      }
    }
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  test('influence: the +3 constraint reduces the Leader\'s influence-attempt need', () => {
    // Orc Captain DI 0 vs Variags (inf# 9): baseline need = 9. With +3: need = 6.
    const base = buildSitePhaseState({
      characters: [ORC_CAPTAIN],
      site: VARIAG_CAMP,
      hand: [VARIAGS],
    });
    const capId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_CAPTAIN);

    const baseline = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt'
        && (ea.action as { influencingCharacterId: CardInstanceId }).influencingCharacterId === capId);
    expect(baseline.length).toBeGreaterThan(0);
    expect((baseline[0].action as { need: number }).need).toBe(9);

    const boosted = addConstraint(base, {
      source: 'fd-1' as CardInstanceId,
      sourceDefinitionId: FOE_DISMAYED,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: capId },
      kind: { type: 'check-modifier', check: 'influence', value: 3 },
    });
    const influenceActions = computeLegalActions(boosted, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt'
        && (ea.action as { influencingCharacterId: CardInstanceId }).influencingCharacterId === capId);
    expect(influenceActions.length).toBeGreaterThan(0);
    expect((influenceActions[0].action as { need: number }).need).toBe(6);
  });
});
