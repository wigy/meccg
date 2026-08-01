/**
 * @module le-173.test
 *
 * Card test: Burning Rick, Cot, and Tree (le-173)
 * Type: minion-resource-event (permanent)
 * Effects:
 *   1. play-target (site: border-hold)         — OK: enforced in site.ts
 *   2. play-flag (tapped-site-only)             — OK: enforced in site.ts
 *   3. play-target (character)                  — OK: bearer selected post-attack
 *   4. duplication-limit (site, max 1)          — OK: enforced in site.ts
 *   5. trigger-attack-on-play (multi-attack):
 *      - Attack 1: Men, 4 strikes @ 7 prowess   — OK: chain-reducer.ts
 *      - Attack 2: Men, 1 strike @ 9 prowess    — OK: reducer-combat.ts remaining-attacks
 *      afterAttack: "move-to-mp-pile"           — OK: pending-reducers.ts
 *      discardFactionsAtSite: true              — OK: pending-reducers.ts
 *
 * Text:
 *   "Playable at an already tapped Border-hold [{B}] during the site phase.
 *    The company faces two attacks (Men — 4 strikes with 7 prowess, 1 strike
 *    with 9 prowess). If no characters are untapped after the attack, discard
 *    this card. Otherwise, you may tap one character in the company and put
 *    this card in your marshalling point pile. Discard any factions you have
 *    in play that are playable at that site. Cannot be duplicated at a given
 *    site."
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
  findCharInstanceId, runCardTriggeredAttackCombat,
  dispatch,
  attachItemToChar,
  Phase,
  Alignment,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayPermanentEventAction, SelectCardBearerAction } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const BURNING_RICK = 'le-173' as CardDefinitionId;

// LE minion characters
const GORBAG = 'le-11' as CardDefinitionId;          // orc, mind 6
const ASTERNAK = 'le-1' as CardDefinitionId;         // man, mind 5
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;     // orc, mind 5
const CALENDAL = 'le-4' as CardDefinitionId;         // man, mind 6
const SHAGRAT = 'le-39' as CardDefinitionId;         // orc, mind 6
const ERADAN = 'le-10' as CardDefinitionId;          // man, mind 4

// LE minion sites
const EASTERLING_CAMP = 'le-371' as CardDefinitionId; // border-hold
const MORIA_MINION = 'le-392' as CardDefinitionId;    // shadow-hold (wrong type)
const DOL_GULDUR = 'le-367' as CardDefinitionId;      // darkhaven (Ringwraith haven)

// Faction playable at Easterling Camp (border-hold)
const EASTERLINGS = 'le-264' as CardDefinitionId;

/** Six-character company: attack 1 (4 strikes) consumes 4, leaving 2 untapped. */
const SIX_CHARS = [GORBAG, ASTERNAK, ORC_CAPTAIN, CALENDAL, SHAGRAT, ERADAN];

function buildMinionSitePhaseState(opts: {
  characters?: CardDefinitionId[];
  site: CardDefinitionId;
  hand?: CardDefinitionId[];
  siteStatus?: CardStatus;
}) {
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
 * With a 6-character company: attack 1 (4 strikes) leaves 2 untapped; attack 2
 * (1 strike) leaves 1 untapped — bearer selection is then offered.
 */
function runBothAttacks(
  state: GameState,
  cardInstanceId: import('../../index.js').CardInstanceId,
): import('../../index.js').GameState {
  const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, cardInstanceId);
  // Attack 1: GORBAG voluntarily faces 1 strike; attacker assigns remaining
  const afterAttack1 = runCardTriggeredAttackCombat(afterPlay, [{ characterDefId: GORBAG, roll: 1 }]);
  // Attack 2: run with any available character (attacker assigns automatically)
  return runCardTriggeredAttackCombat(afterAttack1, []);
}

import type { GameState } from '../../index.js';

describe('Burning Rick, Cot, and Tree (le-173)', () => {
  beforeEach(() => resetMint());

  // ── Effect 2: play-flag (tapped-site-only) ──

  test('NOT playable at an untapped border-hold', () => {
    const state = buildMinionSitePhaseState({
      site: EASTERLING_CAMP,
      hand: [BURNING_RICK],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effect 1: play-target (site: border-hold) ──

  test('NOT playable at a tapped shadow-hold (Moria minion)', () => {
    const state = buildMinionSitePhaseState({
      site: MORIA_MINION,
      siteStatus: CardStatus.Tapped,
      hand: [BURNING_RICK],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effects 1 + 2 combined ──

  test('IS playable at tapped border-hold (Easterling Camp), no pre-selected bearer', () => {
    const state = buildMinionSitePhaseState({
      site: EASTERLING_CAMP,
      siteStatus: CardStatus.Tapped,
      hand: [BURNING_RICK],
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
      site: EASTERLING_CAMP,
      siteStatus: CardStatus.Tapped,
      hand: [BURNING_RICK],
    });
    const stateWithCopy = attachItemToChar(state, RESOURCE_PLAYER, GORBAG, BURNING_RICK);
    const actions = viableActions(stateWithCopy, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effect 5a: first triggered attack is Men, 4 strikes @ 7 prowess ──

  test('company faces first Men attack (4 strikes, prowess 7) when card is played', () => {
    const state = buildMinionSitePhaseState({
      site: EASTERLING_CAMP,
      siteStatus: CardStatus.Tapped,
      hand: [BURNING_RICK],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;

    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);

    expect(afterPlay.combat).not.toBeNull();
    expect(afterPlay.combat!.strikesTotal).toBe(4);
    expect(afterPlay.combat!.strikeProwess).toBe(7);
    expect(afterPlay.combat!.creatureRace).toBe('man');
  });

  // ── Effect 5b: second triggered attack is Men, 1 strike @ 9 prowess ──

  test('second Men attack (1 strike, prowess 9) starts after first attack resolves', () => {
    const state = buildMinionSitePhaseState({
      site: EASTERLING_CAMP,
      siteStatus: CardStatus.Tapped,
      hand: [BURNING_RICK],
      characters: [GORBAG],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;

    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    expect(afterPlay.combat!.strikesTotal).toBe(4);

    // Resolve attack 1 — helper returns when next attack starts in 'assign-strikes'
    const afterAttack1 = runCardTriggeredAttackCombat(afterPlay, [{ characterDefId: GORBAG, roll: 1 }]);

    // Second attack should now be active
    expect(afterAttack1.combat).not.toBeNull();
    expect(afterAttack1.combat!.strikesTotal).toBe(1);
    expect(afterAttack1.combat!.strikeProwess).toBe(9);
    expect(afterAttack1.combat!.creatureRace).toBe('man');
  });

  // ── Effect 5c: card discarded when no characters untapped after both attacks ──

  test('card is discarded when no characters are untapped after both attacks', () => {
    // Single character (GORBAG) faces both attacks; taps after the first strike.
    // After both attacks, no untapped characters remain → card discarded.
    const state = buildMinionSitePhaseState({
      site: EASTERLING_CAMP,
      siteStatus: CardStatus.Tapped,
      hand: [BURNING_RICK],
      characters: [GORBAG],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;

    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    const afterAttack1 = runCardTriggeredAttackCombat(afterPlay, [{ characterDefId: GORBAG, roll: 1 }]);
    expect(afterAttack1.combat).not.toBeNull(); // Attack 2 started

    const afterAttack2 = runCardTriggeredAttackCombat(afterAttack1, [{ characterDefId: GORBAG, roll: 1 }]);
    expect(afterAttack2.combat).toBeNull();

    // No untapped characters → card discarded
    expect(afterAttack2.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === BURNING_RICK)).toBe(true);
    expect(afterAttack2.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === BURNING_RICK)).toBe(false);
  });

  // ── Effect 5d: bearer selection offered when untapped characters survive both attacks ──

  test('select-card-bearer is offered when at least one character is untapped after both attacks', () => {
    // 6-character company: attack 1 (4 strikes) consumes 4 characters (GORBAG + 3
    // attacker-assigned); 2 remain untapped. Attack 2 (1 strike) consumes 1 more.
    // At least 1 character stays untapped → select-card-bearer resolution queued.
    const state = buildMinionSitePhaseState({
      site: EASTERLING_CAMP,
      siteStatus: CardStatus.Tapped,
      hand: [BURNING_RICK],
      characters: SIX_CHARS,
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;

    const afterBothAttacks = runBothAttacks(state, action.cardInstanceId);
    expect(afterBothAttacks.combat).toBeNull();

    const bearerActions = viableActions(afterBothAttacks, PLAYER_1, 'select-card-bearer');
    expect(bearerActions.length).toBeGreaterThan(0);
  });

  // ── Effect 5d: tap character, card stays in cardsInPlay with 2 MPs ──

  test('player may tap one character; card stays in cardsInPlay (not attached), earns 2 MPs', () => {
    const state = buildMinionSitePhaseState({
      site: EASTERLING_CAMP,
      siteStatus: CardStatus.Tapped,
      hand: [BURNING_RICK],
      characters: SIX_CHARS,
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
    expect(chosenChar.items.some(i => i.definitionId === BURNING_RICK)).toBe(false);
    expect(afterBearerSelect.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === BURNING_RICK)).toBe(true);

    // No bearer-cannot-untap constraint added
    const hasUntapConstraint = afterBearerSelect.activeConstraints.some(
      c => c.kind.type === 'bearer-cannot-untap'
        && c.target.kind === 'character'
        && c.target.characterId === chosenCharId,
    );
    expect(hasUntapConstraint).toBe(false);

    // 2 marshalling points earned from card in cardsInPlay
    const stateRecomputed = recomputeDerived(afterBearerSelect);
    expect(stateRecomputed.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(2);
  });

  // ── Effect 5e: factions playable at that site are discarded ──

  test('Easterlings faction is discarded from play after bearer selection at Easterling Camp', () => {
    // Easterlings (le-264) are playable at Easterling Camp. They must be
    // discarded from cardsInPlay after Burning Rick's bearer selection.
    const state = buildMinionSitePhaseState({
      site: EASTERLING_CAMP,
      siteStatus: CardStatus.Tapped,
      hand: [BURNING_RICK],
      characters: SIX_CHARS,
    });

    // Pre-place Easterlings faction in cardsInPlay
    const easterlingInst = { instanceId: mint(), definitionId: EASTERLINGS, status: CardStatus.Untapped };
    const stateWithFaction = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          cardsInPlay: [...state.players[RESOURCE_PLAYER].cardsInPlay, easterlingInst],
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

    // Easterlings must be discarded from cardsInPlay to discard pile
    expect(afterBearerSelect.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === EASTERLINGS)).toBe(false);
    expect(afterBearerSelect.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === EASTERLINGS)).toBe(true);

    // Burning Rick itself remains in cardsInPlay
    expect(afterBearerSelect.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === BURNING_RICK)).toBe(true);
  });

  // ── MPs: 2 while card is in cardsInPlay ──

  test('2 marshalling points while Burning Rick is in cardsInPlay', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: EASTERLING_CAMP, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
          cardsInPlay: [{ instanceId: mint(), definitionId: BURNING_RICK, status: CardStatus.Untapped }],
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
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(2);
  });

  // ── Regression: card must not be swept when the bearer's company later
  //    travels away from the site it was played at ──

  test('stays in cardsInPlay and keeps earning MPs after the company moves to a different site', () => {
    // Reproduces a bug report (game msakbfw9-ytbc1s): Burning Rick, kept via
    // move-to-mp-pile, was silently discarded by the generic site-occupancy
    // sweep (discardOrphanedSiteAttachedEvents) once the bearer's company left
    // the border-hold it was played at — even though the card's own text puts
    // it in the marshalling-point pile independent of the company's location.
    const state = buildMinionSitePhaseState({
      // Company now sits at Dol Guldur — NOT Easterling Camp, where Burning
      // Rick was originally played and bound (attachedToSite).
      site: DOL_GULDUR,
      characters: [GORBAG],
    });
    const stateWithCard = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          cardsInPlay: [
            ...state.players[RESOURCE_PLAYER].cardsInPlay,
            { instanceId: mint(), definitionId: BURNING_RICK, status: CardStatus.Untapped, attachedToSite: EASTERLING_CAMP },
          ],
        },
        state.players[1],
      ] as typeof state.players,
    };

    // Any dispatched action runs the shared post-action sweep pipeline
    // (discardOrphanedSiteAttachedEvents among others).
    const afterAction = dispatch(stateWithCard, { type: 'pass', player: PLAYER_1 });

    expect(afterAction.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === BURNING_RICK)).toBe(true);
    expect(afterAction.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === BURNING_RICK)).toBe(false);
    expect(afterAction.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(2);
  });

  // ── findCharInstanceId helper ──

  test('bearerActionsInclude untapped characters after both attacks', () => {
    // Regression: confirm that select-card-bearer actions only offer UNTAPPED chars.
    const state = buildMinionSitePhaseState({
      site: EASTERLING_CAMP,
      siteStatus: CardStatus.Tapped,
      hand: [BURNING_RICK],
      characters: SIX_CHARS,
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;

    const afterBothAttacks = runBothAttacks(state, action.cardInstanceId);
    const bearerActions = viableActions(afterBothAttacks, PLAYER_1, 'select-card-bearer');

    // All offered bearer characters must be untapped
    for (const ea of bearerActions) {
      const bearerAction = ea.action as SelectCardBearerAction;
      const ch = afterBothAttacks.players[RESOURCE_PLAYER].characters[bearerAction.characterId];
      expect(ch?.status).toBe(CardStatus.Untapped);
    }
  });

  // ── Verify select-card-bearer find char round-trip ──

  test('can find untapped character instance after both attacks', () => {
    const state = buildMinionSitePhaseState({
      site: EASTERLING_CAMP,
      siteStatus: CardStatus.Tapped,
      hand: [BURNING_RICK],
      characters: SIX_CHARS,
    });

    // After play, ERADAN is last in the company and likely to stay untapped
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    expect(gorbagId).toBeDefined();

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;

    const afterBothAttacks = runBothAttacks(state, action.cardInstanceId);

    // At least one character is untapped
    const anyUntapped = Object.values(
      afterBothAttacks.players[RESOURCE_PLAYER].characters,
    ).some(ch => ch.status === CardStatus.Untapped);
    expect(anyUntapped).toBe(true);

    // GORBAG was assigned and should be tapped
    const gorbagChar = afterBothAttacks.players[RESOURCE_PLAYER].characters[gorbagId];
    expect(gorbagChar?.status).toBe(CardStatus.Tapped);
  });
});
