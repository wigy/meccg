/**
 * @module tw-493.test
 *
 * Card test: Neeker-breekers (tw-493)
 * Type: hazard-creature (Animals)
 * Prowess: 7 | Strikes: 1/each (non-avatar characters only) | Kill MPs: 1 | Body: —
 * KeyedTo: border, wilderness, shadow, or dark region; or ruins-and-lairs site
 *
 * Text:
 *   "Animals. Each non-Wizard/non-Ringwraith character in the company faces
 *    one strike. His prowess against such a strike is equal to his mind
 *    attribute. Any character that would normally be wounded is only tapped
 *    instead—no body checks are made."
 *
 * Effects:
 * | # | Effect Type                                  | Status | Notes                                        |
 * |---|----------------------------------------------|--------|----------------------------------------------|
 * | 1 | combat-one-strike-per-character excludeAvatars | OK    | strikes = non-avatar company members          |
 * | 2 | combat-defender-prowess-from-mind            | OK     | defender uses mind attribute as prowess       |
 * | 3 | combat-detainment                            | OK     | wounded → tapped, no body checks             |
 *
 * keyedTo:
 * | # | Entry                                       | Notes                                         |
 * |---|---------------------------------------------|-----------------------------------------------|
 * | 1 | border / wilderness / shadow / dark / {R}  | base keying from playable "{b}{w}{s}{d}{R}"   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { reduce } from '../../engine/reducer.js';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS, GANDALF, HALDIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeWildernessMHState, makeShadowMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, findCharInstanceId, viableActions,
  executeAction,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  expectCharStatus,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType, CardStatus,
} from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const NEEKER_BREEKERS = 'tw-493' as CardDefinitionId;

const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };
const BORDER_KEYING = { method: 'region-type' as const, value: RegionType.Border };
const SHADOW_KEYING = { method: 'region-type' as const, value: RegionType.Shadow };
const DARK_KEYING = { method: 'region-type' as const, value: RegionType.Dark };
const RUINS_KEYING = { method: 'site-type' as const, value: SiteType.RuinsAndLairs };

describe('Neeker-breekers (tw-493)', () => {
  beforeEach(() => resetMint());

  // ─── CombatState flags set on initiation ─────────────────────────────────

  test('combat sets defenderProwessFromMind, excludeAvatarStrikes, and detainment flags', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.defenderProwessFromMind).toBe(true);
    expect(afterChain.combat!.excludeAvatarStrikes).toBe(true);
    expect(afterChain.combat!.detainment).toBe(true);
    expect(afterChain.combat!.strikeProwess).toBe(7);
  });

  // ─── "Each non-Wizard/non-Ringwraith character faces one strike" ──────────

  test('1-char non-wizard company: strikesTotal = 1', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING);

    expect(afterChain.combat!.strikesTotal).toBe(1);
  });

  test('2-char non-wizard company: strikesTotal = 2', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING);

    expect(afterChain.combat!.strikesTotal).toBe(2);
  });

  test('wizard + 1 non-wizard: wizard excluded, strikesTotal = 1', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING);

    // Only Aragorn counts; Gandalf (wizard, mind=null) is excluded
    expect(afterChain.combat!.strikesTotal).toBe(1);
  });

  test('wizard not eligible for strike assignment', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING);

    const gandalfId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GANDALF);
    const assignActions = viableActions(afterChain, PLAYER_1, 'assign-strike');

    // Gandalf cannot be assigned a strike
    expect(assignActions.every(a => {
      const act = a.action as { characterId?: string };
      return act.characterId !== (gandalfId as string);
    })).toBe(true);

    // Aragorn can be assigned a strike
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    expect(assignActions.some(a => {
      const act = a.action as { characterId?: string };
      return act.characterId === (aragornId as string);
    })).toBe(true);
  });

  // ─── "Prowess = mind attribute" ──────────────────────────────────────────

  test('defender uses mind as prowess: Bilbo (prowess=1, mind=5) succeeds vs creature 7 with roll=3', () => {
    // With normal prowess=1: 3+1=4 < 7 → wounded
    // With mind=5: 3+5=8 > 7 → success
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [BILBO, ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING);

    // strikesTotal=2 (Bilbo + Aragorn), both non-wizard
    expect(combatState.combat!.strikesTotal).toBe(2);

    const bilboId = findCharInstanceId(combatState, RESOURCE_PLAYER, BILBO);
    const aragornId = findCharInstanceId(combatState, RESOURCE_PLAYER, ARAGORN);

    // Assign Bilbo's strike first, then Aragorn's
    const s1 = reduce(combatState, { type: 'assign-strike', player: PLAYER_1, characterId: bilboId });
    expect(s1.error).toBeUndefined();
    const s2 = reduce(s1.state, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(s2.error).toBeUndefined();
    // All strikes assigned → choose-strike-order
    expect(s2.state.combat!.phase).toBe('choose-strike-order');

    // Choose to resolve Bilbo's strike (index 0) first
    const s3 = reduce(s2.state, { type: 'choose-strike-order', player: PLAYER_1, strikeIndex: 0, characterId: bilboId, tapped: false });
    expect(s3.error).toBeUndefined();
    expect(s3.state.combat!.phase).toBe('resolve-strike');

    // Resolve Bilbo's strike with roll=3 (3 + mind(5) = 8 > 7 → success)
    const resolveActions = viableActions({ ...s3.state, cheatRollTotal: 3 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    const s4 = reduce({ ...s3.state, cheatRollTotal: 3 }, resolveActions[0].action);
    expect(s4.error).toBeUndefined();

    // After Bilbo's resolution, Aragorn's strike still pending → combat not finalized
    expect(s4.state.combat).not.toBeNull();

    // Bilbo's strike result should be 'success' (not 'wounded')
    const bilboAssignment = s4.state.combat!.strikeAssignments.find(a => a.characterId === bilboId);
    expect(bilboAssignment).toBeDefined();
    expect(bilboAssignment!.result).toBe('success');
  });

  test('resolve-strike legal action displays mind as prowess, not printed prowess: Aragorn (prowess=6, mind=9)', () => {
    // Bug report: displayed "need" used the character's printed prowess
    // instead of mind, mismatching the reducer's actual roll math (which
    // already used mind correctly). The legal-action preview must match.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING);

    const aragornId = findCharInstanceId(combatState, RESOURCE_PLAYER, ARAGORN);
    const s1 = reduce(combatState, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(s1.error).toBeUndefined();

    const resolveActions = viableActions(s1.state, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    // Creature prowess 7, mind 9 → need = 7 - 9 + 1, floored at 2.
    const tapAction = resolveActions.find(a => (a.action as { tapToFight?: boolean }).tapToFight === true);
    expect(tapAction).toBeDefined();
    const act = tapAction!.action as { need?: number; explanation?: string };
    expect(act.explanation).toContain('prowess 9 vs 7');
    expect(act.need).toBe(2);
  });

  // ─── Detainment: "wounded → tapped, no body checks" ─────────────────────

  test('detainment: Haldir (mind=3) loses to creature prowess 7 with roll=2 → tapped not wounded', () => {
    // With mind=3: 2+3=5 < 7 → "wounded" → detainment → status Tapped (not Inverted)
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [HALDIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING);

    expect(combatState.combat!.strikesTotal).toBe(1);
    expect(combatState.combat!.detainment).toBe(true);

    const haldirId = findCharInstanceId(combatState, RESOURCE_PLAYER, HALDIR);

    // Assign strike to Haldir
    const s1 = reduce(combatState, { type: 'assign-strike', player: PLAYER_1, characterId: haldirId });
    expect(s1.error).toBeUndefined();

    // Resolve with roll=2 (2+3=5 < 7 → loses)
    const resolveActions = viableActions({ ...s1.state, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    const s2 = reduce({ ...s1.state, cheatRollTotal: 2 }, resolveActions[0].action);
    expect(s2.error).toBeUndefined();

    // Combat finalizes (1 strike, null body) → check Haldir's status
    expect(s2.state.combat).toBeNull();
    expectCharStatus(s2.state, RESOURCE_PLAYER, HALDIR, CardStatus.Tapped);
  });

  test('detainment: no body check phase after "wounded" result', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [HALDIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING);

    const haldirId = findCharInstanceId(combatState, RESOURCE_PLAYER, HALDIR);
    const s1 = reduce(combatState, { type: 'assign-strike', player: PLAYER_1, characterId: haldirId });

    // Resolve at roll=2 (Haldir "would be wounded" but detainment suppresses body check)
    const s2 = executeAction({ ...s1.state, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');

    // Combat should finalize without a body-check phase (null body creature + detainment)
    expect(s2.combat).toBeNull();
  });

  // ─── Keying ──────────────────────────────────────────────────────────────

  test('keyable to wilderness region', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === WILDERNESS_KEYING.method && a.keyedBy?.value === WILDERNESS_KEYING.value;
    })).toBe(true);
  });

  test('keyable to border region', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    const mhBorder = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Eriador'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const ready = { ...state, phaseState: mhBorder };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === BORDER_KEYING.method && a.keyedBy?.value === BORDER_KEYING.value;
    })).toBe(true);
  });

  test('keyable to shadow region', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeShadowMHState() };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === SHADOW_KEYING.method && a.keyedBy?.value === SHADOW_KEYING.value;
    })).toBe(true);
  });

  test('keyable to dark region', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    const mhDark = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    });
    const ready = { ...state, phaseState: mhDark };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === DARK_KEYING.method && a.keyedBy?.value === DARK_KEYING.value;
    })).toBe(true);
  });

  test('keyable to ruins-and-lairs site type', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    // Free-domain path, ruins-and-lairs site — keyed by site type {R}
    const mhFreeRL = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Eriador'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Weathertop',
    });
    const ready = { ...state, phaseState: mhFreeRL };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === RUINS_KEYING.method && a.keyedBy?.value === RUINS_KEYING.value;
    })).toBe(true);
  });

  test('not keyable to free region without ruins-and-lairs site type', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NEEKER_BREEKERS], siteDeck: [RIVENDELL] },
      ],
    });
    const mhFreeDomain = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Eriador'],
      destinationSiteType: SiteType.Haven,
      destinationSiteName: 'Rivendell',
    });
    const ready = { ...state, phaseState: mhFreeDomain };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    const neekerPlays = plays.filter(p => {
      const a = p.action as { cardInstanceId?: string };
      const card = ready.players[1].hand.find(c => c.instanceId === (a.cardInstanceId as unknown));
      return card?.definitionId === NEEKER_BREEKERS;
    });
    expect(neekerPlays.every(p => !p.viable)).toBe(true);
  });
});
