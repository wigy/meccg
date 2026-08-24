/**
 * @module tw-1.test
 *
 * Card test: Abductor (tw-1)
 * Type: hazard-creature
 * Race: Men. One strike at prowess 10.
 *
 * Card text:
 *   "Man. One Strike. Each non-Wizard/non-Ringwraith defending character
 *    wounded by the Abductor is discarded."
 *
 * Keying: {b}{B} — border-land region type OR border-hold site type.
 *
 * Engine support:
 * | # | Feature                                      | Status      | Notes                                          |
 * |---|----------------------------------------------|-------------|------------------------------------------------|
 * | 1 | One strike, prowess 10                       | IMPLEMENTED | structural data                                |
 * | 2 | Wounded non-Wiz/non-RW char is discarded     | IMPLEMENTED | on-event: character-wounded-by-self            |
 * | 3 | Keying: {b} border-land region               | IMPLEMENTED | regionTypes: [border]                          |
 * | 4 | Keying: {B} border-hold site type            | IMPLEMENTED | siteTypes: [border-hold]                       |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BREE,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve, executeAction, dispatch,
  findCharInstanceId, handCardId, companyIdAt, viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  expectInPile, expectCharNotInPlay,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const ABDUCTOR = 'tw-1' as CardDefinitionId;

const BORDER_HOLD_KEYING = { method: 'site-type' as const, value: 'border-hold' };
const BORDER_KEYING = { method: 'region-type' as const, value: 'border' };

function buildBorderHoldMHState() {
  return makeMHState({
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: SiteType.BorderHold,
    destinationSiteName: 'Bree',
  });
}

function setupAbductorCombat(characters: CardDefinitionId[] = [ARAGORN]) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: BREE, characters }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ABDUCTOR], siteDeck: [RIVENDELL] },
    ],
  });
  const ready = { ...state, phaseState: buildBorderHoldMHState() };
  const abductorId = handCardId(ready, HAZARD_PLAYER);
  const companyId = companyIdAt(ready, RESOURCE_PLAYER);
  return playCreatureHazardAndResolve(ready, PLAYER_2, abductorId, companyId, BORDER_HOLD_KEYING);
}

describe('Abductor (tw-1)', () => {
  beforeEach(() => resetMint());

  // ─── Keying ───────────────────────────────────────────────────────────────

  test('playable keyed to border-hold destination site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ABDUCTOR], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: buildBorderHoldMHState() };
    const abductorId = handCardId(ready, HAZARD_PLAYER);
    const actions = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === abductorId);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some(a => a.viable)).toBe(true);
  });

  test('playable keyed to border-land region in path and combat initiates', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ABDUCTOR], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Enedhwaith'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const abductorId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, abductorId, companyId, BORDER_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(10);
  });

  test('NOT playable on wilderness-only path to non-border-hold destination', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ABDUCTOR], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const abductorId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === abductorId && a.viable);
    expect(viable).toHaveLength(0);
  });

  // ─── Combat initiates ─────────────────────────────────────────────────────

  test('combat initiates with 1 strike and prowess 10', () => {
    const afterChain = setupAbductorCombat();
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(10);
  });

  // ─── Wound → discard ─────────────────────────────────────────────────────

  test('non-Wizard character wounded by Abductor is discarded', () => {
    // Aragorn: prowess 6, body 9. Strike roll 2: 2 < 10-6=4 → wounded.
    // Body check roll 8 < body 9 → survives as wounded.
    // Abductor character-wounded-by-self fires → Aragorn discarded.
    const afterChain = setupAbductorCombat([ARAGORN]);
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2); // Aragorn wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 8); // < body 9 → survives wounded

    expect(s.combat).toBeNull();
    expectCharNotInPlay(s, RESOURCE_PLAYER, aragornId);
    expectInPile(s, RESOURCE_PLAYER, 'discardPile', aragornId);
    expect(s.players[RESOURCE_PLAYER].outOfPlayPile.find(c => c.instanceId === aragornId)).toBeUndefined();
  });

  test('a wounded-discarded character\'s trophy is dispersed per CoE 3.IV.4, not lost', () => {
    // Regression: the wound-triggered discard deleted the character record
    // without dispersing `trophies`, so the trophy's card instance vanished
    // from every collection.
    const ORC_GUARD = 'tw-072' as CardDefinitionId; // creature worth kill MP
    const afterChain = setupAbductorCombat([ARAGORN]);
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const trophy = { instanceId: 'p1-trophy-inst' as import('../../index.js').CardInstanceId, definitionId: ORC_GUARD };
    const withTrophy = {
      ...afterChain,
      players: afterChain.players.map((p, i) => i !== RESOURCE_PLAYER ? p : {
        ...p,
        characters: {
          ...p.characters,
          [aragornId as string]: { ...p.characters[aragornId], trophies: [trophy] },
        },
      }) as unknown as typeof afterChain.players,
    };

    let s = dispatch(withTrophy, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2); // Aragorn wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 8); // survives wounded → discard fires

    expect(s.combat).toBeNull();
    expectInPile(s, RESOURCE_PLAYER, 'discardPile', aragornId);
    // The trophy (worth kill MP) lands in the marshalling-point pile.
    expect(s.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === trophy.instanceId)).toBe(true);
  });

  test('character that wins the strike is NOT discarded', () => {
    // Aragorn wins the strike (high roll), so no wound occurs and no discard.
    const afterChain = setupAbductorCombat([ARAGORN]);
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12); // Aragorn wins

    expect(s.combat).toBeNull();
    expect(s.players[RESOURCE_PLAYER].characters[aragornId]).toBeDefined();
    expect(s.players[RESOURCE_PLAYER].discardPile.find(c => c.instanceId === aragornId)).toBeUndefined();
  });

  // ─── Wizard exclusion ─────────────────────────────────────────────────────

  test('Wizard character wounded by Abductor is NOT discarded', () => {
    // Gandalf (race: wizard) is wounded but the Abductor's condition excludes Wizards.
    const afterChain = setupAbductorCombat([GANDALF]);
    const gandalfId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GANDALF);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: gandalfId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2); // Gandalf wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 5); // survives wounded

    expect(s.combat).toBeNull();
    // Gandalf must remain in play (not discarded by Abductor)
    expect(s.players[RESOURCE_PLAYER].characters[gandalfId]).toBeDefined();
    expect(s.players[RESOURCE_PLAYER].discardPile.find(c => c.instanceId === gandalfId)).toBeUndefined();
    expect(s.players[RESOURCE_PLAYER].outOfPlayPile.find(c => c.instanceId === gandalfId)).toBeUndefined();
  });
});
