/**
 * @module dm-124.test
 *
 * Card test: The Dwarves Are upon You! (dm-124)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 * Effects: 3
 *
 * Text:
 *   "Playable on a company containing Dwarves facing an attack.
 *    All Dwarves in the company receive +2 prowess and -1 body against
 *    the attack. Cannot be duplicated against a given attack."
 *
 * Engine Support:
 * | # | Rule                                                         | Status      |
 * |---|--------------------------------------------------------------|-------------|
 * | 1 | Playable during combat (pre-assignment window) when company  | IMPLEMENTED |
 * |   | contains at least one Dwarf                                  |             |
 * | 2 | +2 prowess to all Dwarves in company for the attack         | IMPLEMENTED |
 * | 3 | -1 body to all Dwarves in company for the attack            | IMPLEMENTED |
 * | 4 | Bonus clears after the attack ends (attack scope)           | IMPLEMENTED |
 * | 5 | Cannot be duplicated against a given attack                 | IMPLEMENTED |
 * | 6 | Not offered when defending company has no Dwarves           | IMPLEMENTED |
 * | 7 | Not offered as a generic short-event outside combat         | IMPLEMENTED |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GIMLI,
  ORC_PATROL,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState,
  playCreatureHazardAndResolve,
  resolveChain,
  viableActions, handCardId, companyIdAt, dispatch,
  findCharInstanceId, actionAs,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction, NotPlayableAction } from '../../index.js';
import { computeLegalActions, RegionType, SiteType } from '../../index.js';

const DWARVES_ARE_UPON_YOU = 'dm-124' as CardDefinitionId;

/** Build a state in M/H phase with the given characters in PLAYER_1's company. */
function buildMHState(chars: CardDefinitionId[]) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: chars }],
        hand: [DWARVES_ARE_UPON_YOU],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [ORC_PATROL],
        siteDeck: [RIVENDELL],
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

/** Play ORC_PATROL against PLAYER_1's company and resolve the chain. */
function triggerOrcCombat(state: ReturnType<typeof buildMHState>) {
  const orcId = handCardId(state, HAZARD_PLAYER);
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  return playCreatureHazardAndResolve(state, PLAYER_2, orcId, companyId, {
    method: 'region-type',
    value: 'wilderness',
  });
}

describe('The Dwarves Are upon You! (dm-124)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Card offered during combat when company has Dwarves ───────────

  test('play-short-event offered in pre-assignment window when company contains a Dwarf', () => {
    const state = buildMHState([GIMLI]);
    const combat = triggerOrcCombat(state);

    expect(combat.combat).toBeDefined();
    expect(combat.combat!.phase).toBe('assign-strikes');

    const actions = viableActions(combat, PLAYER_1, 'play-short-event');
    const dwarfBoost = actions.filter(
      a => 'cardInstanceId' in a.action && (a.action as { cardInstanceId: string }).cardInstanceId !== undefined,
    );
    expect(dwarfBoost.length).toBeGreaterThan(0);
  });

  // ── Rule 6: Card NOT offered when company has no Dwarves ─────────────────

  test('play-short-event NOT offered when company has no Dwarves', () => {
    // ARAGORN is a man, not a dwarf
    const state = buildMHState([ARAGORN]);
    const combat = triggerOrcCombat(state);

    expect(combat.combat).toBeDefined();
    const actions = viableActions(combat, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  // ── Rule 2 & 3: +2 prowess / -1 body applied to Dwarf ───────────────────

  test('+2 prowess and -1 body applied to Gimli after playing the card', () => {
    const state = buildMHState([GIMLI]);
    const combat = triggerOrcCombat(state);

    // Find the card in hand and play it
    const dwarfBoostActions = viableActions(combat, PLAYER_1, 'play-short-event');
    expect(dwarfBoostActions.length).toBeGreaterThan(0);
    const afterPlay = dispatch(combat, dwarfBoostActions[0].action);

    // Recomputed stats should reflect the boost
    const gimliId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, GIMLI);
    const gimli = afterPlay.players[RESOURCE_PLAYER].characters[gimliId];

    // Gimli base: prowess 5, body 8
    expect(gimli.effectiveStats.prowess).toBe(7);  // 5 + 2
    expect(gimli.effectiveStats.body).toBe(7);     // 8 - 1
  });

  // ── Rule 2 & 3: Non-Dwarf in same company is unaffected ──────────────────

  test('non-Dwarf (Aragorn) in company does not receive the bonus', () => {
    // Company: Gimli (dwarf) + Aragorn (man)
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [GIMLI, ARAGORN] }],
          hand: [DWARVES_ARE_UPON_YOU],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
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
    const stateAtMH = { ...base, phaseState: mhState };
    const orcId = handCardId(stateAtMH, HAZARD_PLAYER);
    const companyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combat = playCreatureHazardAndResolve(stateAtMH, PLAYER_2, orcId, companyId, {
      method: 'region-type',
      value: 'wilderness',
    });

    const dwarfBoostActions = viableActions(combat, PLAYER_1, 'play-short-event');
    expect(dwarfBoostActions.length).toBeGreaterThan(0);
    const afterPlay = dispatch(combat, dwarfBoostActions[0].action);

    // Aragorn base: prowess 6, body 9 — must remain unchanged
    const aragornId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, ARAGORN);
    const aragorn = afterPlay.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragorn.effectiveStats.prowess).toBe(6);
    expect(aragorn.effectiveStats.body).toBe(9);

    // Gimli must still be boosted
    const gimliId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, GIMLI);
    const gimli = afterPlay.players[RESOURCE_PLAYER].characters[gimliId];
    expect(gimli.effectiveStats.prowess).toBe(7);
    expect(gimli.effectiveStats.body).toBe(7);
  });

  // ── Rule 4: Boost is attack-scoped (clears when attack finalizes) ──────────

  test('stat modifier constraints are scoped to the attack (kind: attack)', () => {
    const state = buildMHState([GIMLI]);
    const combat = triggerOrcCombat(state);

    // Before playing the card, no attack-scoped constraints exist.
    const beforePlay = combat.activeConstraints.filter(c => c.scope.kind === 'attack');
    expect(beforePlay).toHaveLength(0);

    // Play the boost card.
    const dwarfBoostActions = viableActions(combat, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(combat, dwarfBoostActions[0].action);

    // Two attack-scoped constraints must now exist (one for prowess, one for body).
    const attackConstraints = afterPlay.activeConstraints.filter(
      c => c.scope.kind === 'attack',
    );
    expect(attackConstraints).toHaveLength(2);

    // Both should target Gimli (character-stat-modifier).
    const gimliId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, GIMLI);
    for (const c of attackConstraints) {
      expect(c.kind.type).toBe('character-stat-modifier');
      if (c.kind.type === 'character-stat-modifier') {
        expect(c.kind.characterId).toBe(gimliId);
      }
    }
  });

  // ── Regression: not offered as a chain response before combat starts ─────

  test('NOT offered during chain response window before combat begins', () => {
    // Put the creature on the chain without resolving — Dwarves Are upon You!
    // must not be offered here, only after the chain resolves and combat starts.
    const state = buildMHState([GIMLI]);
    const orcId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const afterHazardPlayed = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type', value: 'wilderness' },
    });
    expect(afterHazardPlayed.chain).not.toBeNull();

    // Card must NOT be offered as a chain response (combat hasn't started).
    const chainActions = viableActions(afterHazardPlayed, PLAYER_1, 'play-short-event');
    expect(chainActions).toHaveLength(0);

    // After the chain resolves, combat starts and the card MUST be offered.
    const combatState = resolveChain(afterHazardPlayed);
    expect(combatState.combat).not.toBeNull();
    const combatActions = viableActions(combatState, PLAYER_1, 'play-short-event');
    expect(combatActions.length).toBeGreaterThan(0);
  });

  // ── Rule 5: Cannot be duplicated against a given attack ──────────────────

  test('second copy blocked during the same attack', () => {
    // Give PLAYER_1 two copies of the card in hand.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [GIMLI] }],
          hand: [DWARVES_ARE_UPON_YOU, DWARVES_ARE_UPON_YOU],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
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
    const stateAtMH = { ...base, phaseState: mhState };
    const orcId = handCardId(stateAtMH, HAZARD_PLAYER);
    const companyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combat = playCreatureHazardAndResolve(stateAtMH, PLAYER_2, orcId, companyId, {
      method: 'region-type',
      value: 'wilderness',
    });

    // Play first copy — succeeds
    const firstActions = viableActions(combat, PLAYER_1, 'play-short-event');
    expect(firstActions.length).toBeGreaterThan(0);
    const afterFirst = dispatch(combat, firstActions[0].action);

    // Second copy must be blocked (duplication limit reached for this attack)
    const secondActions = viableActions(afterFirst, PLAYER_1, 'play-short-event');
    expect(secondActions).toHaveLength(0);
  });

  // ── Regression: not offered as a generic short-event outside combat ──────
  // Bug report: player was unable to play the card before an automatic
  // attack or during the strike sequence because both copies had already
  // been consumed with no effect during the organization phase (no attack
  // in progress, so the company-combat-boost effect is a no-op per
  // CoE 5.1.2). The card is combat-only and must never be offered outside
  // the pre-assignment window of an actual attack.

  test('not playable as a short event during organization (combat-only)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [GIMLI] }],
          hand: [DWARVES_ARE_UPON_YOU],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const cardInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const shortEvent = actions.find(
      a => a.viable && a.action.type === 'play-short-event' &&
        actionAs<PlayShortEventAction>(a.action).cardInstanceId === cardInstanceId,
    );
    expect(shortEvent).toBeUndefined();

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable' &&
        actionAs<NotPlayableAction>(a.action).cardInstanceId === cardInstanceId,
    );
    expect(notPlayable).toBeDefined();
  });
});
