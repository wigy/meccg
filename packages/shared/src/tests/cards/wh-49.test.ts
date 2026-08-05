/**
 * @module wh-49.test
 *
 * Card test: Sojourn in Shadows (wh-49)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 * Keywords: Magic, Shadow-magic
 *
 * Card text:
 *   "Magic. Shadow-magic. Playable before strikes are assigned on a character
 *    facing an attack in a shadow-magic using character's company. Target
 *    character cannot be assigned a strike from the attack. Unless he is a
 *    Ringwraith, the shadow-magic using character makes a corruption check
 *    modified by -4."
 *
 * Rules:
 * 1. protect-from-strike-assignment offered for every character in a company
 *    that contains a shadow-magic user (race Ringwraith, or "shadow-magic"
 *    skill) — not gated to the shadow-magic user's own skill/race.
 * 2. NOT offered when the defending company has no shadow-magic user.
 * 3. NOT available to the attacking player.
 * 4. Playing the card discards it and marks the chosen target protected.
 * 5. Protected character cannot be assigned any strike; other company
 *    members remain assignable normally.
 * 6. Playing the card enqueues a corruption check (-4) on the company's
 *    non-Ringwraith shadow-magic user.
 * 7. No corruption check when the qualifying shadow-magic user is a
 *    Ringwraith.
 * 8. The target may be the shadow-magic user himself.
 *
 * Effects table:
 * | # | Effect                                                        | Status |
 * |---|----------------------------------------------------------------|--------|
 * | 1 | protect-from-strike-assignment: filter company.hasShadowMagicUser | OK |
 * | 2 | Not offered without a shadow-magic user in company              | OK     |
 * | 3 | corruptionCheck modifier -4 on shadow-magic-user                | OK     |
 * | 4 | No corruption check when the shadow-magic user is a Ringwraith  | OK     |
 *
 * Playable: YES
 *
 * Fixtures:
 *   SOJOURN (wh-49)           — the card under test
 *   CIRYAHER (le-6)           — dunadan sage/scout with shadow-magic skill
 *   LAGDUF (le-18)            — orc warrior, no shadow-magic (plain target)
 *   ADUNAPHEL (le-50)         — ringwraith avatar (shadow-magic user by race)
 *   ASTERNAK (le-1)           — man diplomat/warrior, no shadow-magic
 *   DOL_GULDUR (le-367), MINAS_MORGUL (le-390) — minion havens
 *   MORIA_MINION (le-392)     — shadow-hold (non-haven company site)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardInstanceId } from '../../index.js';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ORC_PATROL,
  viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch, expectInDiscardPile,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import { RegionType, SiteType } from '../../index.js';
import type { ProtectFromStrikeAssignmentAction } from '../../index.js';

const SOJOURN = 'wh-49' as CardDefinitionId;

const CIRYAHER = 'le-6' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;
const ADUNAPHEL = 'le-50' as CardDefinitionId;
const ASTERNAK = 'le-1' as CardDefinitionId;

const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId;

const MH_PATH = {
  activeCompanyIndex: 0,
  resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
  resolvedSitePathNames: ['Hithaeglir', 'Eryn Vorn'],
  destinationSiteType: SiteType.ShadowHold,
  destinationSiteName: 'Moria',
} as const;

function findInstanceId(state: ReturnType<typeof buildTestState>, playerIdx: 0 | 1, defId: CardDefinitionId): CardInstanceId {
  const player = state.players[playerIdx];
  const key = Object.keys(player.characters).find(
    k => player.characters[k as CardInstanceId]?.definitionId === defId,
  );
  expect(key).toBeDefined();
  return key as CardInstanceId;
}

function setUpCombat(company: CardDefinitionId[]) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: company }], hand: [SOJOURN], siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
    ],
  });
  const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };
  const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
  const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
  return playCreatureHazardAndResolve(
    stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
    { method: 'region-type', value: 'wilderness' },
  );
}

describe('Sojourn in Shadows (wh-49)', () => {
  beforeEach(() => resetMint());

  test('protect-from-assignment offered for every character when company has a shadow-magic user', () => {
    const combatState = setUpCombat([CIRYAHER, LAGDUF]);
    expect(combatState.combat).toBeDefined();
    expect(combatState.combat!.phase).toBe('assign-strikes');

    const protectActions = viableActions(combatState, PLAYER_1, 'protect-from-assignment');
    // One action per company member — both the shadow-magic user and the plain orc.
    expect(protectActions).toHaveLength(2);
    const ciryaher = findInstanceId(combatState, RESOURCE_PLAYER, CIRYAHER);
    const lagduf = findInstanceId(combatState, RESOURCE_PLAYER, LAGDUF);
    const targets = protectActions.map(a => (a.action as ProtectFromStrikeAssignmentAction).targetCharacterId);
    expect(targets).toContain(ciryaher);
    expect(targets).toContain(lagduf);
  });

  test('NOT offered when the defending company has no shadow-magic user', () => {
    const combatState = setUpCombat([LAGDUF]);
    expect(viableActions(combatState, PLAYER_1, 'protect-from-assignment')).toHaveLength(0);
  });

  test('NOT available to the attacking player', () => {
    const combatState = setUpCombat([CIRYAHER, LAGDUF]);
    expect(viableActions(combatState, PLAYER_2, 'protect-from-assignment')).toHaveLength(0);
  });

  test('playing Sojourn discards the card and protects the chosen (non-caster) target', () => {
    const combatState = setUpCombat([CIRYAHER, LAGDUF]);
    const sojournId = handCardId(combatState, RESOURCE_PLAYER);
    const lagduf = findInstanceId(combatState, RESOURCE_PLAYER, LAGDUF);

    const protectActions = viableActions(combatState, PLAYER_1, 'protect-from-assignment');
    const lagdufAction = protectActions.find(a => (a.action as ProtectFromStrikeAssignmentAction).targetCharacterId === lagduf)!;
    expect(lagdufAction).toBeDefined();

    const after = dispatch(combatState, lagdufAction.action);

    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, sojournId);
    expect(after.combat!.protectedFromStrikeAssignment ?? []).toContain(lagduf);
  });

  test('protected character cannot be assigned a strike; the shadow-magic user remains assignable', () => {
    const combatState = setUpCombat([CIRYAHER, LAGDUF]);
    const lagduf = findInstanceId(combatState, RESOURCE_PLAYER, LAGDUF);
    const ciryaher = findInstanceId(combatState, RESOURCE_PLAYER, CIRYAHER);

    const protectActions = viableActions(combatState, PLAYER_1, 'protect-from-assignment');
    const lagdufAction = protectActions.find(a => (a.action as ProtectFromStrikeAssignmentAction).targetCharacterId === lagduf)!;
    const afterProtect = dispatch(combatState, lagdufAction.action);

    // Sojourn's corruption check on Ciryaher (the caster) must resolve before
    // combat continues to strike assignment.
    const [checkAction] = viableActions(afterProtect, PLAYER_1, 'corruption-check');
    expect(checkAction).toBeDefined();
    const after = dispatch(afterProtect, checkAction.action);

    const assignActions = viableActions(after, PLAYER_1, 'assign-strike');
    const strikeTargetIds = assignActions.map(ea => (ea.action as { characterId?: unknown }).characterId);
    expect(strikeTargetIds).not.toContain(lagduf);
    expect(strikeTargetIds).toContain(ciryaher);
  });

  test('enqueues a corruption check (-4) on the non-Ringwraith shadow-magic user (Ciryaher)', () => {
    const combatState = setUpCombat([CIRYAHER, LAGDUF]);
    const lagduf = findInstanceId(combatState, RESOURCE_PLAYER, LAGDUF);
    const ciryaher = findInstanceId(combatState, RESOURCE_PLAYER, CIRYAHER);

    const protectActions = viableActions(combatState, PLAYER_1, 'protect-from-assignment');
    const lagdufAction = protectActions.find(a => (a.action as ProtectFromStrikeAssignmentAction).targetCharacterId === lagduf)!;
    const after = dispatch(combatState, lagdufAction.action);

    const corruptionChecks = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(corruptionChecks).toHaveLength(1);
    const cc = corruptionChecks[0].kind as { characterId: unknown; modifier: number };
    expect(cc.characterId).toBe(ciryaher);
    expect(cc.modifier).toBe(-4);
  });

  test('no corruption check when the shadow-magic user is a Ringwraith (Adûnaphel)', () => {
    const combatState = setUpCombat([ADUNAPHEL, ASTERNAK]);
    const asternak = findInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK);

    const protectActions = viableActions(combatState, PLAYER_1, 'protect-from-assignment');
    const asternakAction = protectActions.find(a => (a.action as ProtectFromStrikeAssignmentAction).targetCharacterId === asternak)!;
    expect(asternakAction).toBeDefined();
    const after = dispatch(combatState, asternakAction.action);

    const corruptionChecks = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(corruptionChecks).toHaveLength(0);
    // The protection itself still applies regardless of who casts it.
    expect(after.combat!.protectedFromStrikeAssignment ?? []).toContain(asternak);
  });

  test('the target may be the shadow-magic user himself', () => {
    const combatState = setUpCombat([CIRYAHER]);
    const ciryaher = findInstanceId(combatState, RESOURCE_PLAYER, CIRYAHER);

    const protectActions = viableActions(combatState, PLAYER_1, 'protect-from-assignment');
    expect(protectActions).toHaveLength(1);
    const action = protectActions[0].action as ProtectFromStrikeAssignmentAction;
    expect(action.targetCharacterId).toBe(ciryaher);

    const after = dispatch(combatState, action);
    expect(after.combat!.protectedFromStrikeAssignment ?? []).toContain(ciryaher);
    const corruptionChecks = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(corruptionChecks).toHaveLength(1);
    expect((corruptionChecks[0].kind as { characterId: unknown }).characterId).toBe(ciryaher);
  });
});
