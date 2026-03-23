/**
 * @module 03-organization-phase.test
 *
 * Tests for CoE Rules Section 2.II: Organization Phase.
 *
 * Rule references from docs/coe-rules.txt lines 184-271.
 *
 * Tests construct explicit game states in the Organization phase and
 * verify the engine computes correct legal actions or handles actions
 * correctly. No reliance on randomised deck draws.
 */

import { describe, test, expect } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  runActions,
  Phase,
  ARAGORN, BILBO, LEGOLAS, GIMLI, FARAMIR,
  EOWYN, BEREGOND,
  DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import type {
  EvaluatedAction, CardInstanceId, GameState, PlayerId, CardDefinitionId, CompanyId,
  PlayCharacterAction, MoveToInfluenceAction, TransferItemAction, PlanMovementAction,
} from '../../index.js';
import { CardStatus, ZERO_EFFECTIVE_STATS, ZERO_MARSHALLING_POINTS, Alignment } from '../../index.js';

// ─── State builder ───────────────────────────────────────────────────────────

let nextInstanceCounter = 1;

/** Mint a fresh instance ID. */
function mint(): CardInstanceId {
  return `inst-${nextInstanceCounter++}` as CardInstanceId;
}

/** Reset the instance counter between tests. */
function resetMint(): void {
  nextInstanceCounter = 1;
}

/**
 * Build a minimal valid GameState in Organization phase with full control
 * over which characters, items, and sites are where.
 */
function buildOrgState(opts: {
  activePlayer: PlayerId;
  players: [PlayerSetup, PlayerSetup];
}): GameState {
  resetMint();

  const instanceMap: Record<string, { instanceId: CardInstanceId; definitionId: CardDefinitionId }> = {};

  function mintFor(defId: CardDefinitionId): CardInstanceId {
    const id = mint();
    instanceMap[id as string] = { instanceId: id, definitionId: defId };
    return id;
  }

  const playerStates = opts.players.map((setup) => {
    // Mint instances for hand cards
    const hand = setup.hand.map(defId => mintFor(defId));

    // Mint instances for site deck
    const siteDeck = setup.siteDeck.map(defId => mintFor(defId));

    // Build characters and companies
    const characters: Record<string, import('../../index.js').CharacterInPlay> = {};
    const companies: import('../../index.js').Company[] = [];

    for (const companySetup of setup.companies) {
      const siteInstId = mintFor(companySetup.site);
      const charInstIds: CardInstanceId[] = [];

      for (const charSetup of companySetup.characters) {
        const charInstId = mintFor(charSetup.defId);
        charInstIds.push(charInstId);

        // Mint items
        const items = (charSetup.items ?? []).map(itemDefId => {
          const itemInstId = mintFor(itemDefId);
          return {
            instanceId: itemInstId,
            definitionId: itemDefId,
            status: CardStatus.Untapped,
          };
        });

        characters[charInstId as string] = {
          instanceId: charInstId,
          definitionId: charSetup.defId,
          status: charSetup.status ?? CardStatus.Untapped,
          items,
          allies: [],
          corruptionCards: [],
          followers: [],
          controlledBy: 'general' as const,
          effectiveStats: ZERO_EFFECTIVE_STATS,
        };
      }

      // Wire up followers after all characters in company are created
      for (let i = 0; i < companySetup.characters.length; i++) {
        const charSetup = companySetup.characters[i];
        if (charSetup.followerOf !== undefined) {
          const followerInstId = charInstIds[i];
          const controllerInstId = charInstIds[charSetup.followerOf];
          characters[followerInstId as string] = {
            ...characters[followerInstId as string],
            controlledBy: controllerInstId,
          };
          const ctrl = characters[controllerInstId as string];
          characters[controllerInstId as string] = {
            ...ctrl,
            followers: [...ctrl.followers, followerInstId],
          };
        }
      }

      companies.push({
        id: `company-${setup.id as string}-${companies.length}` as CompanyId,
        characters: charInstIds,
        currentSite: siteInstId,
        siteCardOwned: true,
        destinationSite: null,
        movementPath: [],
        moved: false,
      });
    }

    // Mint play deck and discard
    const playDeck = (setup.playDeck ?? []).map(defId => mintFor(defId));
    const discardPile = (setup.discardPile ?? []).map(defId => mintFor(defId));

    return {
      id: setup.id,
      name: setup.id === PLAYER_1 ? 'Alice' : 'Bob',
      alignment: Alignment.Wizard,
      wizard: null,
      hand,
      playDeck,
      discardPile,
      siteDeck,
      siteDiscardPile: [] as CardInstanceId[],
      sideboard: [] as CardInstanceId[],
      companies,
      characters,
      cardsInPlay: [] as import('../../index.js').CardInPlay[],
      marshallingPoints: ZERO_MARSHALLING_POINTS,
      generalInfluenceUsed: 0, // will be recomputed by engine
      deckExhaustionCount: 0,
      freeCouncilCalled: false,
      lastDiceRoll: null,
    };
  });

  const state: GameState = {
    gameId: 'test-game',
    players: playerStates as unknown as readonly [import('../../index.js').PlayerState, import('../../index.js').PlayerState],
    activePlayer: opts.activePlayer,
    phaseState: { phase: Phase.Organization, characterPlayedThisTurn: false, pendingCorruptionCheck: null },
    eventsInPlay: [],
    cardPool: pool,
    instanceMap,
    turnNumber: 1,
    pendingEffects: [],
    rng: { seed: 42, counter: 0 },
    stateSeq: 0,
    touchedCards: [],
  };

  // Run recomputeDerived by doing a no-op reduce.
  // The engine recomputes GI and effective stats after every action.
  // We trigger it by sending a harmless action that won't change state.
  // Actually, we can just manually recompute by exercising the legal actions
  // calculator, which reads the state as-is. The reducer recomputes on every
  // action, so the first action we run will recompute automatically.
  // For assertions on GI before any action, compute it manually here.
  for (const ps of playerStates) {
    let giUsed = 0;
    for (const [, char] of Object.entries(ps.characters)) {
      if (char.controlledBy === 'general') {
        const def = pool[char.definitionId as string];
        if (def && 'mind' in def && (def as { mind: number | null }).mind !== null) {
          giUsed += (def as { mind: number }).mind;
        }
      }
    }
    (ps as { generalInfluenceUsed: number }).generalInfluenceUsed = giUsed;

    // Compute effective stats from card pool
    for (const [key, char] of Object.entries(ps.characters)) {
      const def = pool[char.definitionId as string];
      if (def && 'prowess' in def) {
        const cd = def as { prowess: number; body: number; directInfluence: number };
        (ps.characters[key] as { effectiveStats: import('../../index.js').EffectiveStats }).effectiveStats = {
          prowess: cd.prowess,
          body: cd.body,
          directInfluence: cd.directInfluence,
          corruptionPoints: 0,
        };
      }
    }
  }

  return state;
}

interface CharacterSetup {
  defId: CardDefinitionId;
  items?: CardDefinitionId[];
  status?: CardStatus;
  /** Index into the same company's characters array for the character this one follows. */
  followerOf?: number;
}

interface CompanySetup {
  site: CardDefinitionId;
  characters: CharacterSetup[];
}

interface PlayerSetup {
  id: PlayerId;
  hand: CardDefinitionId[];
  siteDeck: CardDefinitionId[];
  companies: CompanySetup[];
  playDeck?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function viableOfType(actions: EvaluatedAction[], type: string): EvaluatedAction[] {
  return actions.filter(a => a.viable && a.action.type === type);
}

function nonViableOfType(actions: EvaluatedAction[], type: string): EvaluatedAction[] {
  return actions.filter(a => !a.viable && a.action.type === type);
}

// ─── 2.II.1-2: Playing Characters ────────────────────────────────────────────

describe('2.II Playing/discarding characters', () => {
  test('[2.II.1] resource player may declare organizing to play/discard one character and/or set company composition', () => {
    // Aragorn at Rivendell, Eowyn in hand (playable at Rivendell haven)
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [EOWYN],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const viable = actions.filter(a => a.viable);
    const types = new Set(viable.map(a => a.action.type));

    expect(types.has('pass')).toBe(true);
    expect(types.has('play-character')).toBe(true);
    expect(types.has('plan-movement')).toBe(true);
  });

  test('[2.II.2] resource player may play or discard one character per turn while organizing', () => {
    // Two characters in hand, only one can be played per turn
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [EOWYN, BEREGOND],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    // Both should be playable initially
    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = viableOfType(actions, 'play-character');
    expect(playActions.length).toBeGreaterThanOrEqual(2); // Eowyn + Beregond (at haven at least)

    // Play Eowyn at Rivendell (haven)
    const eowyn = playActions.find(ea => {
      const inst = state.instanceMap[(ea.action as PlayCharacterAction).characterInstanceId as string];
      return inst?.definitionId === EOWYN;
    })!;
    const state2 = runActions(state, [eowyn.action]);

    // Now no more play-character should be viable
    const actionsAfter = computeLegalActions(state2, PLAYER_1);
    const playAfter = viableOfType(actionsAfter, 'play-character');
    expect(playAfter).toHaveLength(0);

    // Non-viable play should have "already played" reason
    const blocked = nonViableOfType(actionsAfter, 'play-character');
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].reason).toContain('already played a character this turn');
  });

  test.todo('[2.II.2.1] avatar characters can only play at home site or specific havens');
  test.todo('[2.II.2.1.1] first avatar played is revealed; cannot play different avatar afterward');

  test('[2.II.2.2] non-avatar characters play at home site or havens', () => {
    // Faramir (homesite: Henneth Annûn) in hand.
    // Available sites: Rivendell (haven, company there), Moria (non-haven, in site deck).
    // Faramir should only be playable at Rivendell (haven), not Moria.
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [FARAMIR],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = viableOfType(actions, 'play-character');

    // Should be playable at Rivendell (haven) only
    expect(playActions.length).toBeGreaterThan(0);
    for (const ea of playActions) {
      const atSite = (ea.action as PlayCharacterAction).atSite;
      const siteInst = state.instanceMap[atSite as string];
      const siteDef = pool[siteInst.definitionId as string] as { siteType?: string; name?: string };
      // Must be a haven or homesite
      expect(siteDef.siteType === 'haven' || siteDef.name === 'Henneth Annûn').toBe(true);
    }
  });

  test.todo('[2.II.2.2] if avatar in play, can only play character at avatar site or under direct influence');

  test('[2.II.2.2.1] play under general influence into new/existing company', () => {
    // Eowyn (mind 2) in hand, Aragorn (mind 9) at Rivendell. GI = 20.
    // After Aragorn uses 9, remaining = 11. Eowyn mind 2 fits under GI.
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [EOWYN],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const giPlay = viableOfType(actions, 'play-character').find(ea =>
      (ea.action as PlayCharacterAction).controlledBy === 'general',
    );
    expect(giPlay).toBeDefined();

    const charInstId = (giPlay!.action as PlayCharacterAction).characterInstanceId;
    const state2 = runActions(state, [giPlay!.action]);

    // Character should be in play under GI
    const char = state2.players[0].characters[charInstId as string];
    expect(char).toBeDefined();
    expect(char.controlledBy).toBe('general');

    // Character removed from hand
    expect(state2.players[0].hand).not.toContain(charInstId);
  });

  test('[2.II.2.2.1] play under direct influence as follower of general-influence character', () => {
    // Eowyn (mind 2) in hand, Aragorn (DI 3) at Rivendell.
    // Eowyn's mind 2 <= Aragorn's DI 3, so she can be played as his follower.
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [EOWYN],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const diPlay = viableOfType(actions, 'play-character').find(ea =>
      (ea.action as PlayCharacterAction).controlledBy !== 'general',
    );
    expect(diPlay).toBeDefined();

    const charInstId = (diPlay!.action as PlayCharacterAction).characterInstanceId;
    const controllerId = (diPlay!.action as PlayCharacterAction).controlledBy;

    const state2 = runActions(state, [diPlay!.action]);

    // Eowyn should be a follower of Aragorn
    const char = state2.players[0].characters[charInstId as string];
    expect(char.controlledBy).toBe(controllerId);

    const controller = state2.players[0].characters[controllerId as string];
    expect(controller.followers).toContain(charInstId);
  });

  test('[2.II.2.2.2] non-follower mind subtracts from general influence; follower mind from direct influence', () => {
    // Aragorn (mind 9) under GI uses 9 GI. Bilbo (mind 5) in hand.
    // Playing Bilbo under GI: GI used goes from 9 to 14.
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [BILBO],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    expect(state.players[0].generalInfluenceUsed).toBe(9); // Aragorn mind 9

    const actions = computeLegalActions(state, PLAYER_1);
    const giPlay = viableOfType(actions, 'play-character').find(ea =>
      (ea.action as PlayCharacterAction).controlledBy === 'general',
    )!;

    const state2 = runActions(state, [giPlay.action]);

    // GI used should now be 9 (Aragorn) + 5 (Bilbo) = 14
    expect(state2.players[0].generalInfluenceUsed).toBe(14);
  });

  test('[2.II.2.2.2] character cannot be played if mind exceeds remaining general influence', () => {
    // Aragorn (mind 9) + Legolas (mind 6) + Gimli (mind 6) = 21 GI used.
    // That exceeds 20. So set up with Aragorn + Gimli = 15 used.
    // Elrond (mind 10) in hand — remaining GI is 5, but mind 10 > 5.
    // Elrond has no DI-capable controller either → blocked.
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [LEGOLAS], // mind 6
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [
            { defId: ARAGORN }, // mind 9, DI 3
            { defId: GIMLI },   // mind 6, DI 2
          ] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: FARAMIR }] }],
        },
      ],
    });

    // GI used = 9 + 6 = 15, remaining = 5
    expect(state.players[0].generalInfluenceUsed).toBe(15);

    const actions = computeLegalActions(state, PLAYER_1);

    // Legolas (mind 6) can't fit under GI (remaining 5).
    // DI: Aragorn DI 3 < mind 6, Gimli DI 2 < mind 6. Both insufficient.
    const playActions = viableOfType(actions, 'play-character');
    expect(playActions).toHaveLength(0);

    // Should have a non-viable action with reason
    const blocked = nonViableOfType(actions, 'play-character');
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].reason).toContain('general influence');
  });

  test.todo('[2.II.2.2.3] follower removed from DI outside org phase must relocate during next org or discard');

  test('[2.II.2.3] playing character at site without existing company requires site from location deck', () => {
    // Beregond (homesite: Minas Tirith) in hand. Company at Rivendell.
    // Minas Tirith in site deck → should form new company there.
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [BEREGOND],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = viableOfType(actions, 'play-character');

    // Beregond playable at Minas Tirith (homesite, from site deck) and Rivendell (haven)
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    // Find the Minas Tirith play
    const mtPlay = playActions.find(ea => {
      const atSite = (ea.action as PlayCharacterAction).atSite;
      const inst = state.instanceMap[atSite as string];
      return inst?.definitionId === MINAS_TIRITH;
    });
    expect(mtPlay).toBeDefined();

    const companiesBefore = state.players[0].companies.length;
    const siteDeckBefore = state.players[0].siteDeck.length;

    const state2 = runActions(state, [mtPlay!.action]);

    // New company created
    expect(state2.players[0].companies.length).toBe(companiesBefore + 1);

    // Site removed from site deck
    expect(state2.players[0].siteDeck.length).toBe(siteDeckBefore - 1);
  });

  test('[2.II.2.3] unique character already in play cannot be played again', () => {
    // Aragorn already in play for P1. Aragorn also in P1's hand (shouldn't be possible
    // in real game, but tests the uniqueness check).
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [ARAGORN],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = viableOfType(actions, 'play-character');
    expect(playActions).toHaveLength(0);

    const blocked = nonViableOfType(actions, 'play-character');
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].reason).toContain('unique character already in play');
  });

  test.todo('[2.II.2.4] can only discard non-avatar character at haven or home site');
});

// ─── 2.II.3: Company Composition ─────────────────────────────────────────────

describe('2.II Company composition', () => {
  test.todo('[2.II.3.1] haven companies unlimited size; non-haven max 7 characters');
  test.todo('[2.II.3.1.1] hobbits and orc scouts count as half character toward company size');
  test.todo('[2.II.3.1.2] dunedain/dwarves/elves/hobbits cannot be with orcs/trolls unless at haven');
  test.todo('[2.II.3.1.3] company can only contain one leader unless at haven');

  test('[2.II.3.2] move non-avatar character to direct influence control in same company', () => {
    // Aragorn (DI 3) and Eowyn (mind 2) both under GI at Rivendell.
    // Eowyn can move under Aragorn's DI.
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [],
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: ARAGORN }, // index 0, DI 3
              { defId: EOWYN },   // index 1, mind 2
            ],
          }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const moveActions = viableOfType(actions, 'move-to-influence');

    // Should offer moving Eowyn under Aragorn's DI
    const moveToDI = moveActions.filter(ea =>
      (ea.action as MoveToInfluenceAction).controlledBy !== 'general',
    );
    expect(moveToDI.length).toBeGreaterThan(0);

    // Find Eowyn → under Aragorn
    const eowyn = moveToDI[0];
    const charInstId = (eowyn.action as MoveToInfluenceAction).characterInstanceId;
    const controllerId = (eowyn.action as MoveToInfluenceAction).controlledBy;

    const state2 = runActions(state, [eowyn.action]);

    const char = state2.players[0].characters[charInstId as string];
    expect(char.controlledBy).toBe(controllerId);

    const controller = state2.players[0].characters[controllerId as string];
    expect(controller.followers).toContain(charInstId);
  });

  test('[2.II.3.2] character with mind exceeding DI cannot become follower', () => {
    // Aragorn (DI 3) and Bilbo (mind 5) both under GI.
    // Bilbo mind 5 > Aragorn DI 3 → cannot move Bilbo under Aragorn.
    // Bilbo DI 1 < Aragorn mind 9 → cannot move Aragorn under Bilbo.
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [],
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: ARAGORN }, // DI 3
              { defId: BILBO },   // mind 5, DI 1
            ],
          }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const moveActions = viableOfType(actions, 'move-to-influence');

    // No move-to-DI should be viable
    const moveToDI = moveActions.filter(ea =>
      (ea.action as MoveToInfluenceAction).controlledBy !== 'general',
    );
    expect(moveToDI).toHaveLength(0);
  });

  test('[2.II.3.3] move character to general influence if total mind does not exceed max', () => {
    // Aragorn (DI 3) with Eowyn (mind 2) as follower. GI used = 9 (Aragorn only).
    // Remaining GI = 11. Eowyn mind 2 <= 11 → can move to GI.
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [],
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: ARAGORN },             // index 0
              { defId: EOWYN, followerOf: 0 }, // index 1, follower of Aragorn
            ],
          }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const moveToGI = viableOfType(actions, 'move-to-influence').filter(ea =>
      (ea.action as MoveToInfluenceAction).controlledBy === 'general',
    );

    expect(moveToGI.length).toBeGreaterThan(0);

    const charInstId = (moveToGI[0].action as MoveToInfluenceAction).characterInstanceId;
    const state2 = runActions(state, [moveToGI[0].action]);

    const char = state2.players[0].characters[charInstId as string];
    expect(char.controlledBy).toBe('general');
  });

  test.todo('[2.II.3.4] move character under general influence between companies at same site');
  test.todo('[2.II.3.5] join companies at same site');
  test.todo('[2.II.3.5.1] when companies join, effects affecting either apply to both');
  test.todo('[2.II.3.5.2] joining at haven: return all but one haven site, transfer cards');
  test.todo('[2.II.3.6] split company at same site; resulting companies cannot rejoin same phase');
  test.todo('[2.II.3.6] all but one split company must declare movement');
  test.todo('[2.II.3.6.1] resource player designates original/new company on split');
  test.todo('[2.II.3.6.2] splitting at haven allows placing additional untapped haven copy');
});

// ─── 2.II.4-5: Storing and Transferring Items ────────────────────────────────

describe('2.II Storing and transferring items', () => {
  test.todo('[2.II.4] store item at haven requires corruption check');
  test.todo('[2.II.4.1] successful corruption check: item goes to marshalling point pile');
  test.todo('[2.II.4.2] stored cards lose bearer bonuses');

  test('[2.II.5] transfer item between characters at same site', () => {
    // Aragorn has a Dagger, Bilbo has nothing. Both at Rivendell.
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [],
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] },
              { defId: BILBO },
            ],
          }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const transfers = viableOfType(actions, 'transfer-item');
    expect(transfers).toHaveLength(1); // Dagger from Aragorn to Bilbo

    const transfer = transfers[0].action as TransferItemAction;

    // Verify item is on Aragorn
    const fromChar = state.players[0].characters[transfer.fromCharacterId as string];
    expect(fromChar.items).toHaveLength(1);
    expect(fromChar.items[0].instanceId).toBe(transfer.itemInstanceId);

    const state2 = runActions(state, [transfer]);

    // Item moved to Bilbo
    const toChar = state2.players[0].characters[transfer.toCharacterId as string];
    expect(toChar.items).toHaveLength(1);
    expect(toChar.items[0].instanceId).toBe(transfer.itemInstanceId);

    // Aragorn no longer has it
    const fromCharAfter = state2.players[0].characters[transfer.fromCharacterId as string];
    expect(fromCharAfter.items).toHaveLength(0);
  });

  test('[2.II.5] cannot transfer items between characters at different sites', () => {
    // Aragorn with Dagger at Rivendell, Bilbo at Minas Tirith (different company)
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [],
          companies: [
            { site: RIVENDELL, characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }] },
            { site: MINAS_TIRITH, characters: [{ defId: BILBO }] },
          ],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const transfers = viableOfType(actions, 'transfer-item');
    expect(transfers).toHaveLength(0);
  });
});

// ─── 2.II.6: Sideboard Access ────────────────────────────────────────────────

describe('2.II Sideboard access', () => {
  test.todo('[2.II.6] tap avatar to access sideboard: bring 5 resources/chars to discard or 1 to deck');
});

// ─── 2.II.7: Declaring Movement ──────────────────────────────────────────────

describe('2.II Declaring movement', () => {
  test('[2.II.7] declare movement by placing face-down site card from location deck', () => {
    // Company at Rivendell, Moria in site deck (reachable via starter movement)
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const moveActions = viableOfType(actions, 'plan-movement');
    expect(moveActions.length).toBeGreaterThan(0);

    const moveAction = moveActions[0].action as PlanMovementAction;

    // Destination should be in site deck
    expect(state.players[0].siteDeck).toContain(moveAction.destinationSite);

    const state2 = runActions(state, [moveAction]);

    // Company has destination set
    const company = state2.players[0].companies.find(c => c.id === moveAction.companyId)!;
    expect(company.destinationSite).toBe(moveAction.destinationSite);

    // Site removed from site deck
    expect(state2.players[0].siteDeck).not.toContain(moveAction.destinationSite);
  });

  test('[2.II.7] cancel movement returns site to site deck', () => {
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    // Plan movement
    const actions = computeLegalActions(state, PLAYER_1);
    const moveAction = viableOfType(actions, 'plan-movement')[0];
    const destSite = (moveAction.action as PlanMovementAction).destinationSite;
    const state2 = runActions(state, [moveAction.action]);

    // Cancel
    const cancelActions = viableOfType(computeLegalActions(state2, PLAYER_1), 'cancel-movement');
    expect(cancelActions).toHaveLength(1);

    const state3 = runActions(state2, [cancelActions[0].action]);

    // Site back in deck, no destination
    expect(state3.players[0].siteDeck).toContain(destSite);
    expect(state3.players[0].companies[0].destinationSite).toBeNull();
  });

  test.todo('[2.II.7.1] two companies cannot move from same origin to same destination');
  test.todo('[2.II.7.i] starter movement: current site listed as nearest haven on new site or vice versa');
  test.todo('[2.II.7.ii] region movement: new site within 4 consecutive regions, no repeats');
  test.todo('[2.II.7.iii] under-deeps movement: adjacent sites listed on cards');
  test.todo('[2.II.7.iv] special movement: effects allowing circumvention of normal rules');
});

// ─── 2.II.8: Influence Check at End ──────────────────────────────────────────

describe('2.II End of organization', () => {
  test('passing in organization advances to long-event phase', () => {
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const state2 = runActions(state, [{ type: 'pass', player: PLAYER_1 }]);
    expect(state2.phaseState.phase).toBe(Phase.LongEvent);
  });

  test('non-active player has no legal actions during organization', () => {
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_2);
    const viable = actions.filter(a => a.viable);
    expect(viable).toHaveLength(0);
  });

  test.todo('[2.II.8] if non-follower mind exceeds general influence, discard characters until at/below max');
  test.todo('[2.II.8] newly-played characters returned to hand first');
});
