/**
 * @module dm-25.test
 *
 * Card test: Taladhan (dm-25)
 * Type: minion-character (agent, man; scout/ranger/sage/shadow-magic;
 * prowess 4, body 9, mind 6, DI 1; homesite Sarn Goriwing / Dol Guldur)
 *
 * "Unique. Agent. Can use shadow-magic. Agent only: chooses defending
 * characters; for each successful strike, the company must discard one item
 * (of defender's choice), but the defending character is not harmed."
 *
 * Card shape:
 *   - effects[0]: agent-attack-modifier (attackerAssigns:true,
 *     strikeEffect:"discard-item")
 *
 * Engine support:
 *   - agent-attack-modifier: read by handleDeclareAgentAttack (reducer-site.ts)
 *     when Taladhan's standard site-phase agent attack (rule 2.V.iii) is
 *     declared. attackerAssigns overrides rule 3.ii.4 (which otherwise grants
 *     attacker assignment only to a face-down agent at home) and sets
 *     forceSingleTarget; strikeEffect is threaded onto CombatState.
 *   - strikeEffect:'discard-item': the generic path in combat-strike.ts
 *     (shared with An Article Missing dm-43). A successful strike does not
 *     wound; combat enters the 'discard-item-from-company' phase where the
 *     defender picks one company item to discard. Detainment attacks (vs a
 *     Ringwraith/Balrog defender) tap as usual and never trigger the discard.
 *
 * Prowess math (Taladhan base 4, revealed, not at his home site): 4.
 * Agent strike roll 12 → agentRollTotal 16. Aragorn (prowess 6) roll 2 →
 * defenderTotal 8 < 16 → agent wins → discard-item phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  ARAGORN, DAGGER_OF_WESTERNESSE,
  MORIA, LORIEN,
  buildTestState, resetMint, makeSitePhase,
  dispatch, viableActions,
  attachItemToChar, charIdAt,
  Alignment, CardStatus,
} from '../test-helpers.js';
import { Phase, ZERO_EFFECTIVE_STATS } from '../../index.js';
import type {
  AgentInPlay, CharacterInPlay, SiteInPlay, GameState,
  CardDefinitionId, CardInstanceId, CompanyId,
} from '../../index.js';

const TALADHAN = 'dm-25' as CardDefinitionId;
const ANARIN = 'dm-1' as CardDefinitionId;        // homesite Moria — no agent-attack-modifier (control)
const GORBAG = 'le-11' as CardDefinitionId;        // orc minion, prowess 6
const BLACK_MACE = 'le-299' as CardDefinitionId;   // minion item
const GOBLIN_GATE = 'le-378' as CardDefinitionId;  // minion shadow-hold

const AGENT_CHAR_ID = 'test-dm25-agent' as CardInstanceId;
const AGENT_SITE_ID = 'test-dm25-site' as CardInstanceId;
const AGENT_ID = 'agent-taladhan-0' as CompanyId;

describe('Taladhan (dm-25)', () => {
  beforeEach(() => resetMint());

  /**
   * Site phase at the declare-agent-attack step: the defending company is at
   * `companySite`, Taladhan (or `agentDefId`) is at the same site (via his
   * siteStack — never his home site, so no at-home modifiers apply).
   */
  function buildDeclareState(opts: {
    agentDefId?: CardDefinitionId;
    agentRevealed?: boolean;
    companySite?: CardDefinitionId;
    defenderAlignment?: Alignment;
    defenderChar?: CardDefinitionId;
  } = {}) {
    const companySite = opts.companySite ?? MORIA;
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          ...(opts.defenderAlignment ? { alignment: opts.defenderAlignment } : {}),
          companies: [{ site: companySite, characters: [opts.defenderChar ?? ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const agentChar: CharacterInPlay = {
      instanceId: AGENT_CHAR_ID,
      definitionId: opts.agentDefId ?? TALADHAN,
      status: CardStatus.Untapped,
      items: [], allies: [], hazards: [], followers: [],
      controlledBy: 'general',
      effectiveStats: ZERO_EFFECTIVE_STATS,
    };
    const agentSite: SiteInPlay = {
      instanceId: AGENT_SITE_ID,
      definitionId: companySite,
      status: CardStatus.Untapped,
    };
    const agent: AgentInPlay = {
      id: AGENT_ID,
      character: agentChar,
      revealed: opts.agentRevealed ?? true,
      siteStack: [agentSite],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };
    return {
      ...base,
      players: [
        base.players[0],
        { ...base.players[1], agents: [agent] },
      ] as unknown as typeof base.players,
      phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }),
    };
  }

  /** Declare Taladhan's attack and return the resulting state. */
  function declareAttack(state: GameState): GameState {
    const declares = viableActions(state, PLAYER_2, 'declare-agent-attack');
    expect(declares.length).toBeGreaterThan(0);
    return dispatch(state, declares[0].action);
  }

  /**
   * Drive the declared attack through an agent win:
   * attacker assigns the strike to the defender's first character, agent
   * rolls 12 (agentRollTotal = strikeProwess + 12), defender resolves by
   * tapping with a roll of 2 (loses the strike).
   */
  function playThroughAgentWin(state: GameState): GameState {
    let s = declareAttack(state);

    const defenderId = charIdAt(s, RESOURCE_PLAYER);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: defenderId });

    s = dispatch({ ...s, cheatRollTotal: 12 }, { type: 'agent-strike-roll', player: PLAYER_2 });

    const resolves = viableActions({ ...s, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');
    const tapResolve = resolves.find(a => a.action.type === 'resolve-strike');
    expect(tapResolve).toBeDefined();
    return dispatch({ ...s, cheatRollTotal: 2 }, tapResolve!.action);
  }

  describe('chooses defending characters (attacker assigns strikes)', () => {
    test('revealed away from home, Taladhan still gets attacker assignment', () => {
      // Base rule 3.ii.4 grants attacker assignment only to a face-down agent
      // at home; Taladhan's effect grants it in every state.
      const after = declareAttack(buildDeclareState({ agentRevealed: true }));

      expect(after.combat).not.toBeNull();
      expect(after.combat!.assignmentPhase).toBe('attacker');
      expect(after.combat!.forceSingleTarget).toBe(true);
      expect(after.combat!.strikeEffect).toBe('discard-item');
      expect(after.combat!.strikesTotal).toBe(1);
      // Revealed, not at home: no prowess modifiers — base 4.
      expect(after.combat!.strikeProwess).toBe(4);
    });

    test('face-down away from home, Taladhan still gets attacker assignment', () => {
      const after = declareAttack(buildDeclareState({ agentRevealed: false, companySite: LORIEN }));

      expect(after.combat!.assignmentPhase).toBe('attacker');
      expect(after.combat!.strikeEffect).toBe('discard-item');
      // Face-down, not at home: +2 → 6.
      expect(after.combat!.strikeProwess).toBe(6);
    });

    test('control: an agent without the effect gets defender assignment when revealed', () => {
      const after = declareAttack(buildDeclareState({ agentDefId: ANARIN, agentRevealed: true, companySite: LORIEN }));

      expect(after.combat!.assignmentPhase).toBe('defender');
      expect(after.combat!.strikeEffect).toBeUndefined();
    });

    test('the attacking player assigns the strike to a character of his choice', () => {
      const s = declareAttack(buildDeclareState());

      const assigns = viableActions(s, PLAYER_2, 'assign-strike');
      expect(assigns.length).toBeGreaterThan(0);
      const defenderAssigns = viableActions(s, PLAYER_1, 'assign-strike');
      expect(defenderAssigns).toHaveLength(0);
    });
  });

  describe('successful strike: company discards one item, character not harmed', () => {
    test('agent win with items in company enters discard-item-from-company phase', () => {
      const state = attachItemToChar(buildDeclareState(), RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);

      const after = playThroughAgentWin(state);

      expect(after.combat).not.toBeNull();
      expect(after.combat!.phase).toBe('discard-item-from-company');
      expect(after.combat!.discardItemOptions).toHaveLength(1);
    });

    test('the defending character is not wounded by the successful strike', () => {
      const state = attachItemToChar(buildDeclareState(), RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);

      const after = playThroughAgentWin(state);

      const aragornId = charIdAt(after, RESOURCE_PLAYER);
      expect(after.players[RESOURCE_PLAYER].characters[aragornId].status).not.toBe(CardStatus.Inverted);
    });

    test('the defender (not the attacker) chooses which item to discard', () => {
      const state = attachItemToChar(buildDeclareState(), RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);

      const after = playThroughAgentWin(state);

      expect(viableActions(after, PLAYER_1, 'discard-item-from-company')).toHaveLength(1);
      expect(viableActions(after, PLAYER_2, 'discard-item-from-company')).toHaveLength(0);
    });

    test('discarding the chosen item moves it to the discard pile', () => {
      const state = attachItemToChar(buildDeclareState(), RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);

      let after = playThroughAgentWin(state);
      const discards = viableActions(after, PLAYER_1, 'discard-item-from-company');
      after = dispatch(after, discards[0].action);

      expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);
      const aragornId = charIdAt(after, RESOURCE_PLAYER);
      expect(after.players[RESOURCE_PLAYER].characters[aragornId].items).toHaveLength(0);
    });

    test('agent win with no items in company skips the discard phase entirely', () => {
      const after = playThroughAgentWin(buildDeclareState());

      expect(after.combat).toBeNull();
      const aragornId = charIdAt(after, RESOURCE_PLAYER);
      expect(after.players[RESOURCE_PLAYER].characters[aragornId].status).not.toBe(CardStatus.Inverted);
    });

    test('when the defender beats the strike, no item is discarded', () => {
      const state = attachItemToChar(buildDeclareState(), RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
      let s = declareAttack(state);

      const aragornId = charIdAt(s, RESOURCE_PLAYER);
      s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: aragornId });

      // Agent rolls low (2 → 4 + 2 = 6); defender rolls high (12 → 6 + 12 = 18).
      s = dispatch({ ...s, cheatRollTotal: 2 }, { type: 'agent-strike-roll', player: PLAYER_2 });
      const resolves = viableActions({ ...s, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
      s = dispatch({ ...s, cheatRollTotal: 12 }, resolves.find(a => a.action.type === 'resolve-strike')!.action);

      expect(s.combat?.phase).not.toBe('discard-item-from-company');
      expect(s.players[RESOURCE_PLAYER].characters[aragornId].items).toHaveLength(1);
    });
  });

  describe('detainment vs a Ringwraith defender (rule 3.II.2.R3)', () => {
    test('successful strike taps the minion and does not force an item discard', () => {
      const base = buildDeclareState({
        companySite: GOBLIN_GATE,
        defenderAlignment: Alignment.Ringwraith,
        defenderChar: GORBAG,
      });
      const state = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BLACK_MACE);

      let s = declareAttack(state);
      expect(s.combat!.detainment).toBe(true);
      expect(s.combat!.assignmentPhase).toBe('attacker');

      const gorbagId = charIdAt(s, RESOURCE_PLAYER);
      s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: gorbagId });
      s = dispatch({ ...s, cheatRollTotal: 12 }, { type: 'agent-strike-roll', player: PLAYER_2 });
      const resolves = viableActions({ ...s, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');
      s = dispatch({ ...s, cheatRollTotal: 2 }, resolves.find(a => a.action.type === 'resolve-strike')!.action);

      // Detainment: Gorbag is tapped, not wounded; the discard never fires.
      expect(s.combat?.phase).not.toBe('discard-item-from-company');
      const gorbag = s.players[RESOURCE_PLAYER].characters[gorbagId];
      expect(gorbag.status).toBe(CardStatus.Tapped);
      expect(gorbag.items).toHaveLength(1);
    });
  });
});
