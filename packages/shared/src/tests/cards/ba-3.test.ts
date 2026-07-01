/**
 * @module ba-3.test
 *
 * Card test: The Balrog (ba-3)
 * Type: minion-character (Balrog avatar, mind null)
 * Effects: 1 (on-event self-enters-play -> move filter-all discard, manifestId tw-12)
 *
 * "Unique. Manifestation of Balrog of Moria. Discard all other manifestations
 *  of Balrog of Moria when this card comes into play. +3 to the roll for his
 *  company to move between adjacent Under-deeps sites. The Balrog's prowess
 *  is only modified by -1 when not tapping to face a strike. He may not have
 *  any followers and may not use region or starter movement."
 *
 * The last two clauses ("prowess -1 instead of -3" and "no region/starter
 * movement") are structural avatar behaviours keyed off `isBalrogAvatarDef`/
 * `stayUntappedPenalty` (state-utils.ts) rather than a data-driven effect —
 * The Balrog (mind null) is the only card those helpers ever match.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, CardStatus, SiteType, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, MovementHazardPhaseState } from '../../index.js';
import { MovementType } from '../../types/common.js';
import type { ResolveStrikeAction, DeclarePathAction } from '../../types/actions-movement-hazard.js';
import {
  buildTestState, resetMint, makeMHState,
  reduce, dispatch, resolveChain,
  findCharInstanceId, findHandCardId, charIdAt, companyIdAt,
  viableFor, viablePlayCharacterActions,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase,
} from '../test-helpers.js';

const THE_BALROG = 'ba-3' as CardDefinitionId;
const BALROG_OF_MORIA = 'tw-12' as CardDefinitionId;
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific, non-unique, mind 2
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps, adjacent to Under-grottos (6)
const THE_UNDER_GROTTOS_BA = 'ba-101' as CardDefinitionId; // ruins-and-lairs, under-deeps
const BARAD_DUR_BA = 'ba-84' as CardDefinitionId; // dark-hold, surface (not under-deeps), no cancel-attacks site-rule
const CIRITH_GORGOR_BA = 'ba-86' as CardDefinitionId; // dark-hold, surface, region-adjacent to Barad-dûr
const BARROW_WIGHT = 'le-61' as CardDefinitionId; // 1 strike, 12 prowess, keyed dark-hold/shadow-hold, no effects

describe('The Balrog (ba-3)', () => {
  beforeEach(() => resetMint());

  describe('manifestation: discards Balrog of Moria on entering play', () => {
    test('discards the other manifestation (tw-12) when The Balrog enters play', () => {
      const balrogOfMoriaInPlay: CardInPlay = {
        instanceId: 'bom-1' as CardInstanceId,
        definitionId: BALROG_OF_MORIA,
        status: CardStatus.Untapped,
      };
      const state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Organization,
        recompute: true,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{ site: THE_UNDER_GATES_BA, characters: [] }],
            hand: [THE_BALROG],
            siteDeck: [],
            cardsInPlay: [balrogOfMoriaInPlay],
          },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });

      const atSite = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
      const result = reduce(state, {
        type: 'play-character',
        player: PLAYER_1,
        characterInstanceId: findHandCardId(state, RESOURCE_PLAYER, THE_BALROG),
        atSite,
        controlledBy: 'general',
      });

      expect(result.error).toBeUndefined();
      const p1 = result.state.players[RESOURCE_PLAYER];
      expect(p1.cardsInPlay.some(c => c.definitionId === BALROG_OF_MORIA)).toBe(false);
      expect(p1.discardPile.some(c => c.instanceId === balrogOfMoriaInPlay.instanceId)).toBe(true);
      expect(findCharInstanceId(result.state, RESOURCE_PLAYER, THE_BALROG)).toBeDefined();
    });

    test('negative control: playing an unrelated character does not discard Balrog of Moria', () => {
      const balrogOfMoriaInPlay: CardInPlay = {
        instanceId: 'bom-2' as CardInstanceId,
        definitionId: BALROG_OF_MORIA,
        status: CardStatus.Untapped,
      };
      const state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Organization,
        recompute: true,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{ site: THE_UNDER_GATES_BA, characters: [] }],
            hand: [CROOK_LEGGED_ORC],
            siteDeck: [],
            cardsInPlay: [balrogOfMoriaInPlay],
          },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });

      const atSite = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
      const result = reduce(state, {
        type: 'play-character',
        player: PLAYER_1,
        characterInstanceId: findHandCardId(state, RESOURCE_PLAYER, CROOK_LEGGED_ORC),
        atSite,
        controlledBy: 'general',
      });

      expect(result.error).toBeUndefined();
      const p1 = result.state.players[RESOURCE_PLAYER];
      expect(p1.cardsInPlay.some(c => c.definitionId === BALROG_OF_MORIA)).toBe(true);
    });
  });

  describe('+3 to the Under-deeps movement roll for his company', () => {
    test('required roll is reduced by 3 when The Balrog is in the moving company', () => {
      // The Under-gates (ba-100) lists The Under-grottos at 6; with the
      // Balrog's +3 bonus this becomes 3.
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{ site: THE_UNDER_GATES_BA, characters: [THE_BALROG], destinationSite: THE_UNDER_GROTTOS_BA }],
            hand: [],
            siteDeck: [],
          },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

      const result = reduce(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.UnderDeeps });
      expect(result.error).toBeUndefined();
      const mhState = result.state.phaseState as MovementHazardPhaseState;
      expect(mhState.step).toBe('under-deeps-roll');
      expect(mhState.underDeepsRollRequired).toBe(3);
    });

    test('negative control: without The Balrog the required roll is unmodified (6)', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{ site: THE_UNDER_GATES_BA, characters: [CROOK_LEGGED_ORC], destinationSite: THE_UNDER_GROTTOS_BA }],
            hand: [],
            siteDeck: [],
          },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

      const result = reduce(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.UnderDeeps });
      expect(result.error).toBeUndefined();
      const mhState = result.state.phaseState as MovementHazardPhaseState;
      expect(mhState.underDeepsRollRequired).toBe(6);
    });
  });

  describe("prowess only modified by -1 when not tapping to face a strike", () => {
    test('stay-untapped need is +1 (not +3) relative to tap-to-fight', () => {
      // The Balrog: prowess 8. Barrow-wight: prowess 12, 1 strike.
      // tap-to-fight need = max(2, 12-8+1) = 5
      // stay-untapped (Balrog -1) need = max(2, 12-(8-1)+1) = 6
      const state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        recompute: true,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{ site: BARAD_DUR_BA, characters: [THE_BALROG] }],
            hand: [],
            siteDeck: [],
          },
          {
            id: PLAYER_2,
            alignment: Alignment.Wizard,
            companies: [],
            hand: [BARROW_WIGHT],
            siteDeck: [],
          },
        ],
      });

      const mhState = makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.DarkHold,
        destinationSiteName: 'Barad-dûr',
      });
      const gameState = { ...state, phaseState: mhState };

      const creatureId = findHandCardId(gameState, HAZARD_PLAYER, BARROW_WIGHT);
      const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
      const afterPlay = dispatch(gameState, {
        type: 'play-hazard',
        player: PLAYER_2,
        cardInstanceId: creatureId,
        targetCompanyId: companyId,
        keyedBy: { method: 'site-type' as const, value: 'dark-hold' },
      });
      const afterChain = resolveChain(afterPlay);

      const balrogId = charIdAt(afterChain, RESOURCE_PLAYER);
      const afterAssign = dispatch(afterChain, {
        type: 'assign-strike',
        player: PLAYER_1,
        characterId: balrogId,
        tapped: false,
      });
      expect(afterAssign.combat!.phase).toBe('resolve-strike');

      const resolveActions = computeLegalActions(afterAssign, PLAYER_1)
        .filter(a => a.action.type === 'resolve-strike') as { action: ResolveStrikeAction }[];
      expect(resolveActions).toHaveLength(2);

      const tapAction = resolveActions.find(a => a.action.tapToFight);
      const untapAction = resolveActions.find(a => !a.action.tapToFight);
      expect(tapAction).toBeDefined();
      expect(untapAction).toBeDefined();
      expect(tapAction!.action.need).toBe(5);
      expect(untapAction!.action.need).toBe(6);
      expect(untapAction!.action.need).toBe(tapAction!.action.need + 1);
    });
  });

  describe('may not have any followers', () => {
    test('The Balrog is never offered as a direct-influence controller', () => {
      const state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Organization,
        recompute: true,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{ site: THE_UNDER_GATES_BA, characters: [THE_BALROG] }],
            hand: [CROOK_LEGGED_ORC],
            siteDeck: [],
          },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });

      const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
      const actions = viablePlayCharacterActions(state, PLAYER_1);
      // The Balrog has direct influence 6, well above the Orc's mind cost (2) —
      // without the "no followers" guard he would appear as a DI controller.
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some(a => a.controlledBy === balrogId)).toBe(false);
    });
  });

  describe('may not use region or starter movement', () => {
    test('a company containing The Balrog has no declare-path options between region-adjacent surface sites', () => {
      // Barad-dûr and Cirith Gorgor (both surface dark-holds) are region-adjacent
      // (Gorgoroth -> Udûn, distance 1) — region movement would normally apply.
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{ site: BARAD_DUR_BA, characters: [THE_BALROG], destinationSite: CIRITH_GORGOR_BA }],
            hand: [],
            siteDeck: [],
          },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

      const actions = viableFor(state, PLAYER_1).filter(a => a.action.type === 'declare-path');
      expect(actions).toHaveLength(0);
    });

    test('negative control: a Balrog-less company has region movement between the same sites', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{ site: BARAD_DUR_BA, characters: [CROOK_LEGGED_ORC], destinationSite: CIRITH_GORGOR_BA }],
            hand: [],
            siteDeck: [],
          },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

      const actions = viableFor(state, PLAYER_1)
        .filter(a => a.action.type === 'declare-path') as { action: DeclarePathAction }[];
      expect(actions.some(a => a.action.movementType === MovementType.Region)).toBe(true);
    });
  });
});
