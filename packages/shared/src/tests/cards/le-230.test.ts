/**
 * @module le-230.test
 *
 * Card test: Smoke on the Wind (le-230)
 * Type: minion-resource-event (permanent), 3 misc marshalling points
 * Effects:
 *   1. play-target (site: free-hold)            — OK: enforced in site.ts
 *   2. play-flag (tapped-site-only)             — OK: enforced in site.ts
 *   3. play-target (character)                  — OK: bearer selected post-attack
 *   4. duplication-limit (site, max 1)          — OK: enforced in site.ts
 *   5. trigger-attack-on-play (multi-attack):
 *      - Attack 1: Men, 5 strikes @ 8 prowess   — OK: chain-reducer.ts
 *      - Attack 2: Men, 1 strike @ 10 prowess   — OK: reducer-combat.ts remaining-attacks
 *      afterAttack: "move-to-mp-pile"           — OK: pending-reducers.ts
 *      discardFactionsAtSite: true              — OK: pending-reducers.ts
 *
 * Text:
 *   "Playable at an already tapped Free-hold [{F}] during the site phase. The
 *    company faces two attacks (Men — 5 strikes with 8 prowess, 1 strike with
 *    10 prowess). If no characters are untapped following the attack, discard
 *    this card. Otherwise, you may tap one character in the company and put
 *    this card in your marshalling point pile. Discard any factions you have in
 *    play that are playable at this site. Cannot be duplicated at a given site."
 *
 * Sibling of Burning Rick, Cot, and Tree (le-173) — same primitive, keyed to
 * a Free-hold instead of a Border-hold, with a heavier attack pair (5/8 + 1/10)
 * and 3 marshalling points instead of 2.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  CardStatus,
  buildTestState, makePlayDeck, resetMint,
  viableActions,
  playPermanentEventAndResolve,
  mint,
  runCardTriggeredAttackCombat,
  dispatch,
  attachItemToChar,
  Phase,
  Alignment,
} from '../test-helpers.js';
import type {
  CardDefinitionId,
  GameState,
  CardInstanceId,
  PlayPermanentEventAction,
  SelectCardBearerAction,
} from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const SMOKE_ON_THE_WIND = 'le-230' as CardDefinitionId;

// LE minion characters
const GORBAG = 'le-11' as CardDefinitionId;          // orc, mind 6
const ASTERNAK = 'le-1' as CardDefinitionId;         // man, mind 5
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;     // orc, mind 5
const CALENDAL = 'le-4' as CardDefinitionId;         // elf, mind 6
const SHAGRAT = 'le-39' as CardDefinitionId;         // orc, mind 6
const ERADAN = 'le-10' as CardDefinitionId;          // dunadan, mind 4
const LAYOS = 'le-19' as CardDefinitionId;           // man, mind 5
const CIRYAHER = 'le-6' as CardDefinitionId;         // dunadan, mind 5

// LE minion sites
const EDORAS = 'le-372' as CardDefinitionId;         // free-hold (Rohan)
const MORIA_MINION = 'le-392' as CardDefinitionId;   // shadow-hold (wrong type)
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // darkhaven (Ringwraith haven)

// Faction playable at Edoras (matched by site name in discardFactionsAtSite)
const RIDERS_OF_ROHAN = 'tw-317' as CardDefinitionId;

/**
 * Eight-character company. Attack 1 (5 strikes) taps 5 characters, leaving 3;
 * attack 2 (1 strike) taps 1 more, leaving 2 untapped — the keep is offered.
 */
const EIGHT_CHARS = [
  GORBAG, ASTERNAK, ORC_CAPTAIN, CALENDAL,
  SHAGRAT, ERADAN, LAYOS, CIRYAHER,
];

function buildMinionSitePhaseState(opts: {
  characters?: CardDefinitionId[];
  site: CardDefinitionId;
  hand?: CardDefinitionId[];
  siteStatus?: CardStatus;
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: opts.site, characters: opts.characters ?? [GORBAG] }],
        hand: opts.hand ?? [],
        siteDeck: [DOL_GULDUR],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }],
        hand: [],
        siteDeck: [DOL_GULDUR],
      },
    ],
    phase: Phase.Site,
  });

  const company = state.players[0].companies[0];
  if (opts.siteStatus) {
    (company.currentSite as { status: CardStatus }).status = opts.siteStatus;
  }

  const sitePhaseState = {
    phase: Phase.Site as Phase.Site,
    step: 'play-resources' as const,
    activeCompanyIndex: 0,
    handledCompanyIds: [] as import('../../index.js').CompanyId[],
    siteEntered: true,
    resourcePlayed: false,
    minorItemAvailable: false,
    hoardBountyAvailable: false,
    thoroughSearchAvailable: false,
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false as const,
    pendingResourceAction: null,
    opponentInteractionThisTurn: null,
    pendingOpponentInfluence: null,
  };

  return { ...state, phaseState: sitePhaseState };
}

/**
 * Run both triggered attacks through to completion and return the final state.
 * GORBAG voluntarily faces the first strike of attack 1; the attacker assigns
 * the remaining strikes automatically.
 */
function runBothAttacks(state: GameState, cardInstanceId: CardInstanceId): GameState {
  const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, cardInstanceId);
  // Attack 1 (5 strikes): GORBAG voluntarily faces 1 strike; attacker assigns 4 more
  const afterAttack1 = runCardTriggeredAttackCombat(afterPlay, [{ characterDefId: GORBAG, roll: 1 }]);
  // Attack 2 (1 strike): attacker assigns automatically
  return runCardTriggeredAttackCombat(afterAttack1, []);
}

describe('Smoke on the Wind (le-230)', () => {
  beforeEach(() => resetMint());

  // ── Effect 2: play-flag (tapped-site-only) ──

  test('NOT playable at an untapped free-hold', () => {
    const state = buildMinionSitePhaseState({
      site: EDORAS,
      hand: [SMOKE_ON_THE_WIND],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effect 1: play-target (site: free-hold) ──

  test('NOT playable at a tapped shadow-hold (Moria minion)', () => {
    const state = buildMinionSitePhaseState({
      site: MORIA_MINION,
      siteStatus: CardStatus.Tapped,
      hand: [SMOKE_ON_THE_WIND],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effects 1 + 2 combined ──

  test('IS playable at tapped free-hold (Edoras), no pre-selected bearer', () => {
    const state = buildMinionSitePhaseState({
      site: EDORAS,
      siteStatus: CardStatus.Tapped,
      hand: [SMOKE_ON_THE_WIND],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const act = actions[0].action as PlayPermanentEventAction;
    // Bearer chosen post-attack, so no targetCharacterId at play time
    expect(act.targetCharacterId).toBeUndefined();
  });

  // ── Effect 4: duplication-limit (scope "site", max 1) ──

  test('NOT playable when a copy is already attached at the same site', () => {
    const state = buildMinionSitePhaseState({
      site: EDORAS,
      siteStatus: CardStatus.Tapped,
      hand: [SMOKE_ON_THE_WIND],
    });
    const stateWithCopy = attachItemToChar(state, RESOURCE_PLAYER, GORBAG, SMOKE_ON_THE_WIND);
    const actions = viableActions(stateWithCopy, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effect 5a: first triggered attack is Men, 5 strikes @ 8 prowess ──

  test('company faces first Men attack (5 strikes, prowess 8) when card is played', () => {
    const state = buildMinionSitePhaseState({
      site: EDORAS,
      siteStatus: CardStatus.Tapped,
      hand: [SMOKE_ON_THE_WIND],
      characters: EIGHT_CHARS,
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;

    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);

    expect(afterPlay.combat).not.toBeNull();
    expect(afterPlay.combat!.strikesTotal).toBe(5);
    expect(afterPlay.combat!.strikeProwess).toBe(8);
    expect(afterPlay.combat!.creatureRace).toBe('man');
  });

  // ── Effect 5b: second triggered attack is Men, 1 strike @ 10 prowess ──

  test('second Men attack (1 strike, prowess 10) starts after first attack resolves', () => {
    const state = buildMinionSitePhaseState({
      site: EDORAS,
      siteStatus: CardStatus.Tapped,
      hand: [SMOKE_ON_THE_WIND],
      characters: EIGHT_CHARS,
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;

    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    expect(afterPlay.combat!.strikesTotal).toBe(5);

    // Resolve attack 1 — helper returns when the next attack starts
    const afterAttack1 = runCardTriggeredAttackCombat(afterPlay, [{ characterDefId: GORBAG, roll: 1 }]);

    // Second attack should now be active
    expect(afterAttack1.combat).not.toBeNull();
    expect(afterAttack1.combat!.strikesTotal).toBe(1);
    expect(afterAttack1.combat!.strikeProwess).toBe(10);
    expect(afterAttack1.combat!.creatureRace).toBe('man');
  });

  // ── Effect 5c: card discarded when no characters untapped after both attacks ──

  test('card is discarded when no characters are untapped after both attacks', () => {
    // Single character (GORBAG) faces both attacks and is tapped by them (the
    // attacker's default rolls miss GORBAG's prowess 6, so he survives but taps).
    // After both attacks, no untapped characters remain → card discarded.
    const state = buildMinionSitePhaseState({
      site: EDORAS,
      siteStatus: CardStatus.Tapped,
      hand: [SMOKE_ON_THE_WIND],
      characters: [GORBAG],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;

    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    const afterAttack1 = runCardTriggeredAttackCombat(afterPlay, []);
    expect(afterAttack1.combat).not.toBeNull(); // Attack 2 started

    const afterAttack2 = runCardTriggeredAttackCombat(afterAttack1, []);
    expect(afterAttack2.combat).toBeNull();

    // No untapped characters → card discarded
    expect(afterAttack2.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === SMOKE_ON_THE_WIND)).toBe(true);
    expect(afterAttack2.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SMOKE_ON_THE_WIND)).toBe(false);
  });

  // ── Effect 5d: bearer selection offered when untapped characters survive ──

  test('select-card-bearer is offered when at least one character is untapped after both attacks', () => {
    const state = buildMinionSitePhaseState({
      site: EDORAS,
      siteStatus: CardStatus.Tapped,
      hand: [SMOKE_ON_THE_WIND],
      characters: EIGHT_CHARS,
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;

    const afterBothAttacks = runBothAttacks(state, action.cardInstanceId);
    expect(afterBothAttacks.combat).toBeNull();

    const bearerActions = viableActions(afterBothAttacks, PLAYER_1, 'select-card-bearer');
    expect(bearerActions.length).toBeGreaterThan(0);

    // All offered bearer characters must be untapped
    for (const ea of bearerActions) {
      const bearerAction = ea.action as SelectCardBearerAction;
      const ch = afterBothAttacks.players[RESOURCE_PLAYER].characters[bearerAction.characterId];
      expect(ch?.status).toBe(CardStatus.Untapped);
    }
  });

  // ── Effect 5d: tap character, card stays in cardsInPlay with 3 MPs ──

  test('player may tap one character; card stays in cardsInPlay (not attached), earns 3 MPs', () => {
    const state = buildMinionSitePhaseState({
      site: EDORAS,
      siteStatus: CardStatus.Tapped,
      hand: [SMOKE_ON_THE_WIND],
      characters: EIGHT_CHARS,
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;

    const afterBothAttacks = runBothAttacks(state, action.cardInstanceId);
    const bearerActions = viableActions(afterBothAttacks, PLAYER_1, 'select-card-bearer');
    expect(bearerActions.length).toBeGreaterThan(0);

    // Select the first available character to tap
    const firstBearerAction = bearerActions[0].action as SelectCardBearerAction;
    const chosenCharId = firstBearerAction.characterId;
    const afterBearerSelect = dispatch(afterBothAttacks, firstBearerAction);

    // Chosen character must be tapped
    const chosenChar = afterBearerSelect.players[RESOURCE_PLAYER].characters[chosenCharId];
    expect(chosenChar.status).toBe(CardStatus.Tapped);

    // Card must stay in cardsInPlay (NOT attached to any character's items)
    expect(chosenChar.items.some(i => i.definitionId === SMOKE_ON_THE_WIND)).toBe(false);
    expect(afterBearerSelect.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SMOKE_ON_THE_WIND)).toBe(true);

    // No bearer-cannot-untap constraint added (kept bare, not attached)
    const hasUntapConstraint = afterBearerSelect.activeConstraints.some(
      c => c.kind.type === 'bearer-cannot-untap'
        && c.target.kind === 'character'
        && c.target.characterId === chosenCharId,
    );
    expect(hasUntapConstraint).toBe(false);

    // 3 marshalling points earned from card in cardsInPlay
    const stateRecomputed = recomputeDerived(afterBearerSelect);
    expect(stateRecomputed.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(3);
  });

  // ── Effect 5e: factions playable at that site are discarded ──

  test('a faction playable at Edoras is discarded from play after bearer selection', () => {
    // Riders of Rohan (tw-317) are playable at Edoras. When Smoke on the Wind is
    // kept at Edoras, every faction the player has in play that is playable at
    // this site is discarded.
    const state = buildMinionSitePhaseState({
      site: EDORAS,
      siteStatus: CardStatus.Tapped,
      hand: [SMOKE_ON_THE_WIND],
      characters: EIGHT_CHARS,
    });

    // Pre-place the faction in cardsInPlay
    const factionInst = { instanceId: mint(), definitionId: RIDERS_OF_ROHAN, status: CardStatus.Untapped };
    const stateWithFaction = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          cardsInPlay: [...state.players[RESOURCE_PLAYER].cardsInPlay, factionInst],
        },
        state.players[1],
      ] as typeof state.players,
    };

    const actions = viableActions(stateWithFaction, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;

    const afterBothAttacks = runBothAttacks(stateWithFaction, action.cardInstanceId);
    const bearerActions = viableActions(afterBothAttacks, PLAYER_1, 'select-card-bearer');
    expect(bearerActions.length).toBeGreaterThan(0);

    const afterBearerSelect = dispatch(afterBothAttacks, bearerActions[0].action);

    // Faction must be discarded from cardsInPlay to discard pile
    expect(afterBearerSelect.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === RIDERS_OF_ROHAN)).toBe(false);
    expect(afterBearerSelect.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === RIDERS_OF_ROHAN)).toBe(true);

    // Smoke on the Wind itself remains in cardsInPlay
    expect(afterBearerSelect.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SMOKE_ON_THE_WIND)).toBe(true);
  });

  // ── MPs: 3 while card is in cardsInPlay ──

  test('3 marshalling points while Smoke on the Wind is in cardsInPlay', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: EDORAS, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
          cardsInPlay: [{ instanceId: mint(), definitionId: SMOKE_ON_THE_WIND, status: CardStatus.Untapped }],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
      phase: Phase.Site,
    });
    const state = recomputeDerived(base);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(3);
  });
});
