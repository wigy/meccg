/**
 * @module tw-315.test
 *
 * Card test: Rescue Prisoners (tw-315)
 * Type: hero-resource-event (permanent)
 * Effects: play-target (site: dark-hold/shadow-hold), play-flag (tapped-site-only),
 *          play-target (character), trigger-attack-on-play (Spider 2×7),
 *          storable-at (haven/border-hold/free-hold, 2 MP),
 *          duplication-limit (site, max 1)
 *
 * "Playable at an already tapped Dark-hold or Shadow-hold during the site phase.
 *  The company faces a Spider attack (2 strikes with 7 prowess). If no characters
 *  are untapped after the attack, discard Rescue Prisoners. Otherwise, you may tap
 *  1 character in the company and put Rescue Prisoners under his control. No
 *  marshalling points are received and that character may not untap until Rescue
 *  Prisoners is stored at a Haven, Border-hold, or Free-hold during his organization
 *  phase. Cannot be duplicated at a given site."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  CardStatus,
  ARAGORN, LEGOLAS, GIMLI,
  MORIA, MOUNT_DOOM, BANDIT_LAIR, RIVENDELL, LORIEN,
  buildSitePhaseState, resetMint,
  viableActions,
  attachItemToChar,
  playPermanentEventAndResolve,
  buildTestState, makePlayDeck,
  mint, addToPile, makeSitePhase,
  findCharInstanceId, runCardTriggeredAttackCombat,
  dispatch, resolveChain,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayPermanentEventAction, SelectCardBearerAction } from '../../index.js';
import { Phase } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const MANY_TURNS_AND_DOUBLINGS = 'td-132' as CardDefinitionId;

const RESCUE_PRISONERS = 'tw-315' as CardDefinitionId;

describe('Rescue Prisoners (tw-315)', () => {
  beforeEach(() => resetMint());

  // ── Phase restriction: site-phase-only ──

  test('NOT playable during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [RESCUE_PRISONERS],
          siteDeck: [RIVENDELL],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effect 1: play-target (site filter: dark-hold or shadow-hold) ──

  test('NOT playable at ruins-and-lairs site (Bandit Lair)', () => {
    const state = buildSitePhaseState({
      site: BANDIT_LAIR,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effect 2: play-flag (tapped-site-only) ──

  test('NOT playable at untapped shadow-hold (Moria)', () => {
    // siteStatus defaults to Untapped in buildSitePhaseState
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [RESCUE_PRISONERS],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effects 1 + 2 combined: playable when site is tapped shadow-hold ──

  test('IS playable at tapped shadow-hold (Moria), emits one action without pre-selected bearer', () => {
    // Bearer is chosen post-attack, so no targetCharacterId is embedded at play time.
    const state = buildSitePhaseState({
      site: MORIA,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const act = actions[0].action as PlayPermanentEventAction;
    expect(act.targetCharacterId).toBeUndefined();
  });

  test('IS playable at tapped dark-hold (Carn Dum is le-359 — use Mount Doom as shadow-hold)', () => {
    // Mount Doom is tw-414, siteType shadow-hold — confirms shadow-hold works
    const state = buildSitePhaseState({
      site: MOUNT_DOOM,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ── Reducer: card goes to cardsInPlay on resolution, then to character after bearer selection ──

  test('reducer places Rescue Prisoners in cardsInPlay after chain resolution (before bearer selected)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const action = actions[0].action as PlayPermanentEventAction;

    // After chain resolution the card is in cardsInPlay and combat is active
    const after = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === RESCUE_PRISONERS)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === RESCUE_PRISONERS)).toBe(false);
    expect(after.combat).not.toBeNull();
  });

  // ── Effect 3: duplication-limit (scope "site", max 1) ──

  test('NOT playable when a copy is already in play at the same site', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
    });
    // Attach a copy of Rescue Prisoners to Aragorn at Moria
    const stateWithCopy = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, RESCUE_PRISONERS);
    const actions = viableActions(stateWithCopy, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('IS playable at a different site even when a copy exists at another site', () => {
    // Player 1 company at Moria (has Rescue Prisoners on Aragorn)
    // Player 1 wants to play at Mount Doom (different site, no copy there)
    const baseState = buildTestState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [{ defId: ARAGORN, items: [RESCUE_PRISONERS] }] },
            { site: MOUNT_DOOM, characters: [LEGOLAS] },
          ],
          hand: [RESCUE_PRISONERS],
          siteDeck: [RIVENDELL],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
      phase: Phase.Site,
    });

    // Set Mount Doom company's site to tapped
    const mountDoomCompany = baseState.players[0].companies[1];
    const stateWithTap = {
      ...baseState,
      players: [
        {
          ...baseState.players[0],
          companies: [
            baseState.players[0].companies[0],
            {
              ...mountDoomCompany,
              currentSite: mountDoomCompany.currentSite
                ? { ...mountDoomCompany.currentSite, status: CardStatus.Tapped }
                : null,
            },
          ],
        },
        baseState.players[1],
      ] as typeof baseState.players,
    };

    const stateAtMountDoom = { ...stateWithTap, phaseState: makeSitePhase({ activeCompanyIndex: 1 }) };

    const actions = viableActions(stateAtMountDoom, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ── Storable-at: can be stored at haven during organization ──

  test('Rescue Prisoners can be stored at a Haven during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [RESCUE_PRISONERS] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions.length).toBe(1);
  });

  // ── MPs: 0 while in play, 2 when stored ──

  test('no marshalling points while Rescue Prisoners is attached to a character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [RESCUE_PRISONERS] }] }],
          hand: [],
          siteDeck: [RIVENDELL],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const mp = state.players[RESOURCE_PLAYER].marshallingPoints;
    // No misc MPs from Rescue Prisoners (marshallingPoints: 0 while in play)
    expect(mp.misc).toBe(0);
  });

  test('2 marshalling points awarded when Rescue Prisoners is stored', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    // Place Rescue Prisoners in the out-of-play pile (stored state)
    const stored = addToPile(
      base, RESOURCE_PLAYER, 'outOfPlayPile',
      { instanceId: mint(), definitionId: RESCUE_PRISONERS },
    );
    const state = recomputeDerived(stored);
    const mp = state.players[RESOURCE_PLAYER].marshallingPoints;
    expect(mp.misc).toBe(2);
  });

  // ── Auto-attack: Spider combat triggered on play ──

  test('company faces Spider attack (2 strikes, prowess 7) when Rescue Prisoners is played', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const action = actions[0].action as PlayPermanentEventAction;

    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);

    expect(afterPlay.combat).not.toBeNull();
    expect(afterPlay.combat!.strikesTotal).toBe(2);
    expect(afterPlay.combat!.strikeProwess).toBe(7);
    expect(afterPlay.combat!.creatureRace).toBe('spider');
  });

  test('Rescue Prisoners is discarded if no characters are untapped after the Spider attack', () => {
    // Single-character company: Aragorn is the only character.
    // After he taps to fight the Spider, no characters remain untapped → card discarded.
    const state = buildSitePhaseState({
      site: MORIA,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const action = actions[0].action as PlayPermanentEventAction;

    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    expect(afterPlay.combat).not.toBeNull();

    // Aragorn taps to fight; afterwards all characters are tapped → discard
    const afterCombat = runCardTriggeredAttackCombat(afterPlay, [{ characterDefId: ARAGORN, roll: 1 }]);

    // Card must be discarded from cardsInPlay (was never in Aragorn's items)
    expect(afterCombat.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === RESCUE_PRISONERS)).toBe(true);
    expect(afterCombat.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === RESCUE_PRISONERS)).toBe(false);
  });

  test('bearer character cannot untap until Rescue Prisoners is stored', () => {
    // Three-character company: Aragorn + Gimli + Legolas.
    // Both Spider strikes go to Aragorn and Gimli; Legolas stays untapped.
    // Post-attack: select-card-bearer resolution offered; player taps Legolas to bear the card.
    // A bearer-cannot-untap constraint blocks Legolas from untapping.
    const state = buildSitePhaseState({
      site: MORIA,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
      characters: [ARAGORN, GIMLI, LEGOLAS],
    });

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    // Play: one action, no pre-selected bearer
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const action = actions[0].action as PlayPermanentEventAction;
    expect(action.targetCharacterId).toBeUndefined();

    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    expect(afterPlay.combat).not.toBeNull();

    // Aragorn takes strike 1, Gimli takes strike 2; Legolas stays untapped
    const afterCombat = runCardTriggeredAttackCombat(afterPlay, [
      { characterDefId: ARAGORN, roll: 1 },
      { characterDefId: GIMLI, roll: 1 },
    ]);

    // Post-combat: select-card-bearer pending resolution offered for Legolas (only untapped)
    expect(afterCombat.combat).toBeNull();
    const bearerActions = viableActions(afterCombat, PLAYER_1, 'select-card-bearer');
    expect(bearerActions.length).toBeGreaterThan(0);
    const legolasAction = bearerActions.find(
      ea => (ea.action as SelectCardBearerAction).characterId === legolasId,
    );
    expect(legolasAction).toBeDefined();

    // Select Legolas as bearer
    const afterBearerSelect = dispatch(afterCombat, legolasAction!.action);

    // Legolas must be tapped with an active bearer-cannot-untap constraint
    const legolasChar = afterBearerSelect.players[RESOURCE_PLAYER].characters[legolasId as string];
    expect(legolasChar.status).toBe(CardStatus.Tapped);
    expect(legolasChar.items.some(i => i.definitionId === RESCUE_PRISONERS)).toBe(true);
    const constraint = afterBearerSelect.activeConstraints.find(
      c => c.kind.type === 'bearer-cannot-untap'
        && c.target.kind === 'character'
        && c.target.characterId === legolasId,
    );
    expect(constraint).toBeDefined();

    // During the untap phase, Legolas must remain tapped (constraint blocks untap)
    const inUntap = {
      ...afterBearerSelect,
      phaseState: {
        phase: Phase.Untap,
        untapped: false,
        hazardSideboardDestination: null,
        hazardSideboardFetched: 0,
        hazardSideboardAccessed: false,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      } as typeof afterBearerSelect.phaseState,
    };
    const afterUntap = dispatch(inUntap, { type: 'untap', player: PLAYER_1 });
    expect(afterUntap.players[RESOURCE_PLAYER].characters[legolasId as string].status).toBe(CardStatus.Tapped);
  });

  test('bearer-cannot-untap constraint added when triggered Spider attack is cancelled', () => {
    // Regression: when Many Turns and Doublings cancels the Spider attack from
    // Rescue Prisoners, the bearer-cannot-untap constraint must still be added.
    // Aragorn (ranger) + Gimli in company; Aragorn cancels the Spider attack.
    // After cancellation: untapped characters remain → select-card-bearer is offered.
    const state = buildSitePhaseState({
      site: MORIA,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS, MANY_TURNS_AND_DOUBLINGS],
      characters: [ARAGORN, GIMLI],
    });

    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);

    // Play Rescue Prisoners (no pre-selected bearer)
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions.find(ea => (ea.action as PlayPermanentEventAction).cardInstanceId
      && (state.players[RESOURCE_PLAYER].hand.find(c => c.instanceId === (ea.action as PlayPermanentEventAction).cardInstanceId)?.definitionId === RESCUE_PRISONERS))?.action as PlayPermanentEventAction;
    expect(action).toBeDefined();

    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    expect(afterPlay.combat).not.toBeNull();

    // Cancel the Spider attack with Many Turns and Doublings (Aragorn is the ranger)
    const cancelActions = viableActions(afterPlay, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBeGreaterThan(0);
    const afterCancel = dispatch(afterPlay, cancelActions[0].action);
    const afterChain = resolveChain(afterCancel);
    expect(afterChain.combat).toBeNull();

    // select-card-bearer resolution must be pending for Rescue Prisoners
    const bearerActions = viableActions(afterChain, PLAYER_1, 'select-card-bearer');
    expect(bearerActions.length).toBeGreaterThan(0);

    // Select Gimli as bearer
    const gimliAction = bearerActions.find(
      ea => (ea.action as SelectCardBearerAction).characterId === gimliId,
    );
    expect(gimliAction).toBeDefined();
    const afterBearerSelect = dispatch(afterChain, gimliAction!.action);

    // Gimli must be tapped and have bearer-cannot-untap constraint
    const gimliChar = afterBearerSelect.players[RESOURCE_PLAYER].characters[gimliId as string];
    expect(gimliChar.status).toBe(CardStatus.Tapped);
    expect(gimliChar.items.some(i => i.definitionId === RESCUE_PRISONERS)).toBe(true);
    const constraint = afterBearerSelect.activeConstraints.find(
      c => c.kind.type === 'bearer-cannot-untap'
        && c.target.kind === 'character'
        && c.target.characterId === gimliId,
    );
    expect(constraint).toBeDefined();

    // During the untap phase, Gimli must remain tapped
    const inUntap = {
      ...afterBearerSelect,
      phaseState: {
        phase: Phase.Untap,
        untapped: false,
        hazardSideboardDestination: null,
        hazardSideboardFetched: 0,
        hazardSideboardAccessed: false,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      } as typeof afterBearerSelect.phaseState,
    };
    const afterUntap = dispatch(inUntap, { type: 'untap', player: PLAYER_1 });
    expect(afterUntap.players[RESOURCE_PLAYER].characters[gimliId as string].status).toBe(CardStatus.Tapped);
  });
});
