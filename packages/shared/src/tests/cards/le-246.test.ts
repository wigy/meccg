/**
 * @module le-246.test
 *
 * Card test: To Satisfy the Questioner (le-246)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 * Effects:
 *   - play-target: site filter (siteType: free-hold)
 *   - play-target: character filter (target.status: untapped)
 *   - play-flag: tap-site-on-play
 *   - play-flag: tap-character-on-play
 *   - storable-at: siteTypes ["haven"], marshallingPoints 3
 *
 * "Playable during the site phase on an untapped character at a Free-hold [{F}].
 *  Tap the character and site. No marshalling points are received and the character
 *  may not untap until this card is stored at a Darkhaven [{DH}] during his
 *  organization phase."
 *
 * | # | Effect                              | Status | Notes                                  |
 * |---|-------------------------------------|--------|----------------------------------------|
 * | 1 | play-target: site (free-hold only)  | OK     | site.ts play-target filter             |
 * | 2 | play-target: character (untapped)   | OK     | site.ts play-target filter             |
 * | 3 | play-flag: tap-site-on-play         | OK     | chain-reducer.ts resolvePermanentEvent |
 * | 4 | play-flag: tap-character-on-play    | OK     | chain-reducer.ts resolvePermanentEvent |
 * | 5 | storable-at: haven, 3 MP            | OK     | organization-companies.ts + store      |
 * | 6 | bearer-cannot-untap constraint      | OK     | chain-reducer.ts direct-attach path    |
 *
 * Playable: YES
 * Certified: 2026-05-31
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  CardStatus,
  buildTestState, makePlayDeck,
  resetMint, mint, addToPile,
  viableActions,
  dispatch, resolveChain,
  Phase, Alignment,
  findCharInstanceId,
  makeSitePhase,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayPermanentEventAction } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const TO_SATISFY = 'le-246' as CardDefinitionId;

// Minion characters
const GORBAG = 'le-11' as CardDefinitionId;   // minion-character, orc
const ASTERNAK = 'le-1' as CardDefinitionId;  // minion-character, man

// Minion sites
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // haven (darkhaven)
const BAG_END = 'le-350' as CardDefinitionId;      // free-hold
const BANDIT_LAIR_MINION = 'le-373' as CardDefinitionId; // ruins-and-lairs (non-free-hold)

/** Build a site-phase state with a ringwraith company. */
function buildMinionSitePhaseState(opts: {
  site: CardDefinitionId;
  siteStatus?: CardStatus;
  characters?: CardDefinitionId[];
  hand?: CardDefinitionId[];
}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
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
        companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }],
        hand: [],
        siteDeck: [BAG_END],
      },
    ],
  });
  const company = state.players[0].companies[0];
  const siteStatus = opts.siteStatus ?? CardStatus.Untapped;
  const updatedCompany = {
    ...company,
    currentSite: company.currentSite
      ? { ...company.currentSite, status: siteStatus }
      : null,
  };
  const updatedState = {
    ...state,
    players: [
      { ...state.players[0], companies: [updatedCompany] },
      state.players[1],
    ] as typeof state.players,
    phaseState: makeSitePhase({ activeCompanyIndex: 0 }),
  };
  return updatedState;
}

describe('To Satisfy the Questioner (le-246)', () => {
  beforeEach(() => resetMint());

  // ── Phase restriction: site-phase only ──────────────────────────────────────

  test('NOT playable during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END, characters: [GORBAG] }],
          hand: [TO_SATISFY],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [BAG_END],
        },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effect 1: play-target (site filter: free-hold only) ─────────────────────

  test('NOT playable at ruins-and-lairs site', () => {
    const state = buildMinionSitePhaseState({
      site: BANDIT_LAIR_MINION,
      hand: [TO_SATISFY],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('IS playable at a free-hold (Bag End)', () => {
    const state = buildMinionSitePhaseState({
      site: BAG_END,
      hand: [TO_SATISFY],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ── Effect 2: play-target (character filter: untapped only) ─────────────────

  test('NOT playable on a tapped character', () => {
    const state = buildMinionSitePhaseState({
      site: BAG_END,
      hand: [TO_SATISFY],
    });
    // Tap Gorbag manually
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const tappedState = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          characters: {
            ...state.players[RESOURCE_PLAYER].characters,
            [gorbagId as string]: {
              ...state.players[RESOURCE_PLAYER].characters[gorbagId as string],
              status: CardStatus.Tapped,
            },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };
    const actions = viableActions(tappedState, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('IS playable on an untapped character, emits one action per untapped character', () => {
    const state = buildMinionSitePhaseState({
      site: BAG_END,
      characters: [GORBAG, ASTERNAK],
      hand: [TO_SATISFY],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    // Two untapped characters → two actions
    expect(actions.length).toBe(2);
    const targets = actions.map(
      ea => (ea.action as PlayPermanentEventAction).targetCharacterId,
    );
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const asternakId = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    expect(targets).toContain(gorbagId);
    expect(targets).toContain(asternakId);
  });

  // ── Effects 3+4: tap-site-on-play and tap-character-on-play ─────────────────

  test('both the character and site are tapped when the card resolves', () => {
    const state = buildMinionSitePhaseState({
      site: BAG_END,
      hand: [TO_SATISFY],
    });
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
    const action = actions[0].action as PlayPermanentEventAction;

    // Play and resolve the chain
    const afterPlay = dispatch(state, action);
    const afterResolve = resolveChain(afterPlay);

    // Character must be tapped
    const gorbagChar = afterResolve.players[RESOURCE_PLAYER].characters[gorbagId as string];
    expect(gorbagChar.status).toBe(CardStatus.Tapped);

    // Site must be tapped
    const company = afterResolve.players[RESOURCE_PLAYER].companies[0];
    expect(company.currentSite?.status).toBe(CardStatus.Tapped);
  });

  // ── Effect 5+6: bearer-cannot-untap constraint added at play time ───────────

  test('bearer-cannot-untap constraint is added when card is played on a character', () => {
    const state = buildMinionSitePhaseState({
      site: BAG_END,
      hand: [TO_SATISFY],
    });
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
    const action = actions[0].action as PlayPermanentEventAction;

    const afterPlay = dispatch(state, action);
    const afterResolve = resolveChain(afterPlay);

    const constraint = afterResolve.activeConstraints.find(
      c => c.kind.type === 'bearer-cannot-untap'
        && c.target.kind === 'character'
        && c.target.characterId === gorbagId,
    );
    expect(constraint).toBeDefined();
  });

  test('bearer character cannot untap while To Satisfy the Questioner is attached', () => {
    const state = buildMinionSitePhaseState({
      site: BAG_END,
      hand: [TO_SATISFY],
    });
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;
    const afterResolve = resolveChain(dispatch(state, action));

    // Advance to Untap phase
    const inUntap = {
      ...afterResolve,
      phaseState: {
        phase: Phase.Untap,
        untapped: false,
        hazardSideboardDestination: null,
        hazardSideboardFetched: 0,
        hazardSideboardAccessed: false,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      } as typeof afterResolve.phaseState,
    };
    const afterUntap = dispatch(inUntap, { type: 'untap', player: PLAYER_1 });

    // Gorbag must remain tapped (constraint blocks untap)
    expect(afterUntap.players[RESOURCE_PLAYER].characters[gorbagId as string].status).toBe(CardStatus.Tapped);
  });

  // ── Effect 5: storable at a Darkhaven (haven) during organization ────────────

  test('To Satisfy the Questioner can be stored at a Darkhaven during organization', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: GORBAG, items: [TO_SATISFY] }] }],
          hand: [],
          siteDeck: [BAG_END],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          companies: [{ site: BAG_END, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const storeActions = viableActions(base, PLAYER_1, 'store-item');
    expect(storeActions.length).toBe(1);
  });

  test('NOT storable at a non-haven site (free-hold)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END, characters: [{ defId: GORBAG, items: [TO_SATISFY] }] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [BAG_END],
        },
      ],
    });

    const storeActions = viableActions(base, PLAYER_1, 'store-item');
    expect(storeActions.length).toBe(0);
  });

  // ── MPs: 0 while in play, 3 when stored ────────────────────────────────────

  test('no marshalling points while attached to a character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END, characters: [{ defId: GORBAG, items: [TO_SATISFY] }] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [BAG_END],
        },
      ],
    });
    expect(base.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });

  test('3 marshalling points awarded when stored at a Darkhaven', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
          hand: [],
          siteDeck: [BAG_END],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          companies: [{ site: BAG_END, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const stored = addToPile(
      base, RESOURCE_PLAYER, 'killPile',
      { instanceId: mint(), definitionId: TO_SATISFY },
    );
    const state = recomputeDerived(stored);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(3);
  });

  // ── Storing clears bearer-cannot-untap constraint ───────────────────────────

  test('bearer-cannot-untap constraint is cleared when card is stored', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: GORBAG, items: [TO_SATISFY] }] }],
          hand: [],
          siteDeck: [BAG_END],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          companies: [{ site: BAG_END, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const gorbagId = findCharInstanceId(base, RESOURCE_PLAYER, GORBAG);

    // Find instance ID of To Satisfy the Questioner on Gorbag
    const gorbag = base.players[RESOURCE_PLAYER].characters[gorbagId as string];
    const toSatisfyInst = gorbag.items.find(i => i.definitionId === TO_SATISFY);
    expect(toSatisfyInst).toBeDefined();

    // Manually add bearer-cannot-untap constraint (simulating it was placed at play)
    const constrainedState = {
      ...base,
      activeConstraints: [
        ...base.activeConstraints,
        {
          id: 'test-constraint' as import('../../index.js').ConstraintId,
          source: toSatisfyInst!.instanceId,
          sourceDefinitionId: TO_SATISFY,
          scope: { kind: 'until-cleared' as const },
          target: { kind: 'character' as const, characterId: gorbagId },
          kind: { type: 'bearer-cannot-untap' as const, cardInstanceId: toSatisfyInst!.instanceId },
        },
      ],
    };

    const storeActions = viableActions(constrainedState, PLAYER_1, 'store-item');
    expect(storeActions.length).toBe(1);

    const afterStore = dispatch(constrainedState, storeActions[0].action);

    // Constraint must be cleared
    const stillActive = afterStore.activeConstraints.find(
      c => c.kind.type === 'bearer-cannot-untap'
        && c.target.kind === 'character'
        && c.target.characterId === gorbagId,
    );
    expect(stillActive).toBeUndefined();
  });
});
