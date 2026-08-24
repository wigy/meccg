/**
 * @module dm-88.test
 *
 * Card test: Seized by Terror (dm-88)
 * Type: hazard-event (short)
 *
 * "Playable on a non-Wizard character, non-Ringwraith character moving in a
 *  Shadow-land [{s}] or Dark-domain [{d}]. Target character's player makes a
 *  roll and adds character's mind. If the result is less than 12, that
 *  character splits off into a different company. This new company
 *  immediately returns to his original company's site of origin."
 *
 * Card shape:
 *   - effects[0]: play-condition (requires site-path with shadow or dark)
 *   - effects[1]: play-target (character, non-wizard, non-ringwraith)
 *   - effects[2]: seized-by-terror-check (threshold 12)
 *
 * Engine support:
 *   - play-condition site-path: enforces Shadow-land or Dark-domain in path
 *   - play-target character filter: excludes wizard and ringwraith race
 *   - seized-by-terror-check threshold:12 — roll + mind < 12 splits the
 *     character into a new company at the site of origin
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, makeShadowMHState, makeMHState,
  P1_COMPANY,
  handCardId, charIdAt, findCharInstanceId, dispatch,
  eliminateCharacter,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase, RegionType, Alignment } from '../../index.js';
import type { GameState, CardDefinitionId, PlayHazardAction, SeizedByTerrorRollAction } from '../../index.js';

const SEIZED_BY_TERROR = 'dm-88' as CardDefinitionId;
const ALATAR_FW = 'wh-1' as CardDefinitionId; // Fallen-wizard avatar (race fallen-wizard, mind null)

describe('Seized by Terror (dm-88)', () => {
  beforeEach(() => resetMint());

  test('NOT playable when company path has no shadow or dark region', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [SEIZED_BY_TERROR], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // No shadow/dark in site path — card is not playable
    const mhState: GameState = { ...state, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('playable on non-wizard characters when company traverses a Shadow-land', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [SEIZED_BY_TERROR], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState: GameState = { ...state, phaseState: makeShadowMHState() };
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    // One action per eligible character (Aragorn + Legolas = 2)
    expect(actions).toHaveLength(2);
    expect(actions.every(a => (a.action as PlayHazardAction).targetCharacterId !== undefined)).toBe(true);
  });

  test('playable on non-wizard characters when company traverses a Dark-domain', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [SEIZED_BY_TERROR], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState: GameState = {
      ...state,
      phaseState: makeMHState({ resolvedSitePath: [RegionType.Dark] }),
    };
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('NOT playable on a wizard character (Gandalf)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [SEIZED_BY_TERROR], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState: GameState = { ...state, phaseState: makeShadowMHState() };
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    // Only Aragorn is eligible — Gandalf is filtered out
    expect(actions).toHaveLength(1);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect((actions[0].action as PlayHazardAction).targetCharacterId).toBe(aragornId);
  });

  test('NOT playable on a Fallen-wizard avatar (g.wiz.F1: it counts as "Wizard")', () => {
    // A Fallen-wizard avatar's race is "fallen-wizard", but by CoE glossary
    // g.wiz.F1 it matches "Wizard" in card text — so "non-Wizard character"
    // (dm-88) may not target it. Aragorn (a non-Wizard hero in the same
    // company) remains eligible; the FW avatar must be excluded.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: RIVENDELL, characters: [ALATAR_FW, ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [SEIZED_BY_TERROR], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState: GameState = { ...state, phaseState: makeShadowMHState() };
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    // Only Aragorn is eligible — the Fallen-wizard avatar is filtered out.
    expect(actions).toHaveLength(1);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect((actions[0].action as PlayHazardAction).targetCharacterId).toBe(aragornId);
  });

  test('enqueues a seized-by-terror-roll pending resolution after chain resolves', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [SEIZED_BY_TERROR], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const mhState: GameState = { ...state, phaseState: makeShadowMHState() };
    const cardId = handCardId(mhState, HAZARD_PLAYER);

    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: aragornId,
    });

    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('seized-by-terror-roll');
  });

  test('character stays when roll + mind >= 12', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [SEIZED_BY_TERROR], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Aragorn mind=9; threshold=12; need roll >= 3 to pass.
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const mhState: GameState = { ...state, phaseState: makeShadowMHState() };
    const cardId = handCardId(mhState, HAZARD_PLAYER);

    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: aragornId,
    });

    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Force a roll of 3: 3 + 9 = 12 >= 12 → passes, character stays
    s = { ...s, cheatRollTotal: 3 };

    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'seized-by-terror-roll');
    expect(rollActions).toHaveLength(1);

    const rollAction = rollActions[0].action as SeizedByTerrorRollAction;
    expect(rollAction.targetCharacterId).toBe(aragornId);

    s = dispatch(s, rollAction);

    // Aragorn should still be in the original company
    const company = s.players[RESOURCE_PLAYER].companies.find(c => c.id === P1_COMPANY);
    expect(company).toBeDefined();
    expect(company!.characters).toContain(aragornId);
    // Still 1 company
    expect(s.players[RESOURCE_PLAYER].companies).toHaveLength(1);
  });

  test('character splits into new company at site of origin on roll failure', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [SEIZED_BY_TERROR], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Aragorn mind=9; threshold=12; need roll < 3 to fail.
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const mhState: GameState = { ...state, phaseState: makeShadowMHState() };
    const cardId = handCardId(mhState, HAZARD_PLAYER);

    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: aragornId,
    });

    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Force a roll of 2: 2 + 9 = 11 < 12 → fails, character splits off
    s = { ...s, cheatRollTotal: 2 };

    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'seized-by-terror-roll');
    expect(rollActions).toHaveLength(1);

    s = dispatch(s, rollActions[0].action);

    // Original company should no longer have Aragorn
    const original = s.players[RESOURCE_PLAYER].companies.find(c => c.id === P1_COMPANY);
    expect(original).toBeDefined();
    expect(original!.characters).not.toContain(aragornId);
    // Legolas stays in original company
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    expect(original!.characters).toContain(legolasId);

    // A new company should exist containing Aragorn
    expect(s.players[RESOURCE_PLAYER].companies).toHaveLength(2);
    const newCompany = s.players[RESOURCE_PLAYER].companies.find(c => c.id !== P1_COMPANY);
    expect(newCompany).toBeDefined();
    expect(newCompany!.characters).toContain(aragornId);

    // New company has no destination (it stays at the site of origin)
    expect(newCompany!.destinationSite).toBeNull();

    // Aragorn is still in play (not discarded)
    expect(s.players[RESOURCE_PLAYER].characters[aragornId]).toBeDefined();
  });

  test('single-character company returns to origin (no split) on roll failure', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [SEIZED_BY_TERROR], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Aragorn alone — on fail: company returns to origin (destinationSite cleared)
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const destinationInstId = state.players[RESOURCE_PLAYER].companies[0].destinationSite!.instanceId;
    const mhState: GameState = { ...state, phaseState: makeShadowMHState() };
    const cardId = handCardId(mhState, HAZARD_PLAYER);

    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: aragornId,
    });

    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Force roll = 2: 2 + 9 = 11 < 12 → fails
    s = { ...s, cheatRollTotal: 2 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'seized-by-terror-roll');
    expect(rollActions).toHaveLength(1);

    s = dispatch(s, rollActions[0].action);

    // Company stays at origin — still 1 company with Aragorn
    expect(s.players[RESOURCE_PLAYER].companies).toHaveLength(1);
    const company = s.players[RESOURCE_PLAYER].companies[0];
    expect(company.characters).toContain(aragornId);
    // destinationSite cleared — company stays at origin
    expect(company.destinationSite).toBeNull();
    // Regression (card-disappears invariant): the destination site card was
    // physically drawn out of the site deck by plan-movement, so canceling
    // the movement must return it there — it used to be nulled out and
    // destroyed, silently shrinking the location deck each time this fired
    // on a lone moving character (seen as permanently lost site instances
    // in random self-play: Mount Gundabad, Bandit Lair, Ruined Signal
    // Tower, Iron Hill Dwarf-hold).
    expect(s.players[RESOURCE_PLAYER].siteDeck.some(c => c.instanceId === destinationInstId)).toBe(true);
  });

  // ── Target leaves play while the roll is pending ──────────────────────────

  test('target eliminated while the roll is pending: no effect, game not deadlocked', () => {
    // Regression: the seized-by-terror-roll emitter returned NO actions when
    // the target character had left play before the roll, leaving the
    // resolving chain stuck with no legal actions for either player — the
    // same deadlock class as the faction-influence-roll fix (#1725).
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [SEIZED_BY_TERROR], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const mhState: GameState = { ...state, phaseState: makeShadowMHState() };
    const cardId = handCardId(mhState, HAZARD_PLAYER);

    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: aragornId,
    });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(s.pendingResolutions.find(r => r.kind.type === 'seized-by-terror-roll')).toBeDefined();

    // Aragorn leaves play while the roll is pending.
    const gone = eliminateCharacter(s, RESOURCE_PLAYER, aragornId, s.players[RESOURCE_PLAYER].characters[aragornId]);

    const rollAction = computeLegalActions(gone, PLAYER_1).find(
      a => a.viable && a.action.type === 'seized-by-terror-roll',
    );
    expect(rollAction).toBeDefined();

    // Resolving fizzles: chain completes, the company is untouched.
    const after = dispatch(gone, rollAction!.action);
    expect(after.pendingResolutions).toHaveLength(0);
    expect(after.chain).toBeNull();
    expect(after.players[RESOURCE_PLAYER].companies).toHaveLength(1);
    const anyViable = [
      ...computeLegalActions(after, PLAYER_1),
      ...computeLegalActions(after, PLAYER_2),
    ].some(a => a.viable);
    expect(anyViable).toBe(true);
  });
});
