/**
 * @module le-240.test
 *
 * Card test: That Ain't No Secret (le-240)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 * Effects:
 *   - play-target: site filter (playableResources includes "information")
 *   - play-target: character filter (target.status: untapped), cost tap character
 *   - storable-at: siteTypes ["haven"], marshallingPoints 1
 *
 * Text:
 *   "Playable during the site phase on an untapped character at a site where
 *    Information is playable. Tap the character (but not the site). No
 *    marshalling points are received until this card is stored at a Darkhaven
 *    [{DH}] during the character's organization phase."
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | Playable during the site phase only                           | OK     |
 * | 2 | Site must have Information in playableResources (any type)     | OK     |
 * | 3 | Target character must be untapped                              | OK     |
 * | 4 | Tap the character on play                                      | OK     |
 * | 5 | Do NOT tap the site on play                                    | OK     |
 * | 6 | No untap lock — bearer untaps normally next turn (vs le-241)   | OK     |
 * | 7 | No MPs received while in play (granted only when stored)       | OK     |
 * | 8 | Storable at a Darkhaven during organization → 1 MP            | OK     |
 * | 9 | Man of Skill (wh-119) in play overrides the stored MP to 2     | OK     |
 *
 * Note (contrast with le-241/le-246): That Ain't No Secret's text omits the
 * "the character may not untap" clause, so it deliberately does NOT carry the
 * `bearer-cannot-untap-until-stored` play-flag and places no untap constraint.
 *
 * Playable: YES — CERTIFIED.
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

const THAT_AINT_NO_SECRET = 'le-240' as CardDefinitionId;
const MAN_OF_SKILL = 'wh-119' as CardDefinitionId; // Saruman-specific stage permanent-event
const SARUMAN_FW = 'wh-9' as CardDefinitionId;     // Fallen-wizard avatar (Saruman)

// Minion characters (no covert requirement on this card — any character works)
const GORBAG = 'le-11' as CardDefinitionId;   // minion-character, orc
const ASTERNAK = 'le-1' as CardDefinitionId;  // minion-character, man

// Minion sites
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // haven (darkhaven), storage target
const BAG_END = 'le-350' as CardDefinitionId;      // free-hold, Information playable
const DIMRILL_DALE = 'le-365' as CardDefinitionId; // ruins-and-lairs, Information playable
const BEORNS_HOUSE = 'le-354' as CardDefinitionId; // free-hold, NO Information

/** Build a site-phase state with a ringwraith company at the given site. */
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

describe("That Ain't No Secret (le-240)", () => {
  beforeEach(() => resetMint());

  // ── Rule 1: site-phase only ──────────────────────────────────────────────

  test('NOT playable during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END, characters: [GORBAG] }],
          hand: [THAT_AINT_NO_SECRET],
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
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 2: site must have Information playable (any site type) ───────────

  test('IS playable at a free-hold where Information is playable (Bag End)', () => {
    const state = buildMinionSitePhaseState({ site: BAG_END, hand: [THAT_AINT_NO_SECRET] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });

  test('IS playable at a ruins-and-lairs where Information is playable (no site-type restriction)', () => {
    const state = buildMinionSitePhaseState({ site: DIMRILL_DALE, hand: [THAT_AINT_NO_SECRET] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });

  test('NOT playable at a site without Information (Beorn\'s House)', () => {
    const state = buildMinionSitePhaseState({ site: BEORNS_HOUSE, hand: [THAT_AINT_NO_SECRET] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 3: target character must be untapped ────────────────────────────

  test('NOT playable when the only character is tapped', () => {
    const state = buildMinionSitePhaseState({ site: BAG_END, hand: [THAT_AINT_NO_SECRET] });
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const tappedState = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          characters: {
            ...state.players[RESOURCE_PLAYER].characters,
            [gorbagId as string]: {
              ...state.players[RESOURCE_PLAYER].characters[gorbagId],
              status: CardStatus.Tapped,
            },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };
    expect(viableActions(tappedState, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('emits one action per untapped character', () => {
    const state = buildMinionSitePhaseState({
      site: BAG_END,
      characters: [GORBAG, ASTERNAK],
      hand: [THAT_AINT_NO_SECRET],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(2);
    const targets = actions.map(ea => (ea.action as PlayPermanentEventAction).targetCharacterId);
    expect(targets).toContain(findCharInstanceId(state, RESOURCE_PLAYER, GORBAG));
    expect(targets).toContain(findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK));
  });

  // ── Rules 4+5: taps the character but NOT the site ───────────────────────

  test('playing the card taps the targeted character but leaves the site untapped', () => {
    const state = buildMinionSitePhaseState({ site: BAG_END, hand: [THAT_AINT_NO_SECRET] });
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
    const afterResolve = resolveChain(dispatch(state, actions[0].action));

    expect(afterResolve.players[RESOURCE_PLAYER].characters[gorbagId].status)
      .toBe(CardStatus.Tapped);
    expect(afterResolve.players[RESOURCE_PLAYER].companies[0].currentSite?.status)
      .toBe(CardStatus.Untapped);
  });

  test('the card is attached to the targeted character on play', () => {
    const state = buildMinionSitePhaseState({ site: BAG_END, hand: [THAT_AINT_NO_SECRET] });
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const afterResolve = resolveChain(dispatch(state, viableActions(state, PLAYER_1, 'play-permanent-event')[0].action));

    const char = afterResolve.players[RESOURCE_PLAYER].characters[gorbagId];
    expect(char.items.some(i => i.definitionId === THAT_AINT_NO_SECRET)).toBe(true);
  });

  // ── Rule 6: NO untap lock (key contrast with le-241/le-246) ──────────────

  test('does NOT place a bearer-cannot-untap constraint (no untap lock)', () => {
    const state = buildMinionSitePhaseState({ site: BAG_END, hand: [THAT_AINT_NO_SECRET] });
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const afterResolve = resolveChain(dispatch(state, viableActions(state, PLAYER_1, 'play-permanent-event')[0].action));

    const constraint = afterResolve.activeConstraints.find(
      c => c.kind.type === 'bearer-cannot-untap'
        && c.target.kind === 'character'
        && c.target.characterId === gorbagId,
    );
    expect(constraint).toBeUndefined();
  });

  test('bearer untaps normally during the untap phase', () => {
    const state = buildMinionSitePhaseState({ site: BAG_END, hand: [THAT_AINT_NO_SECRET] });
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const afterResolve = resolveChain(dispatch(state, viableActions(state, PLAYER_1, 'play-permanent-event')[0].action));

    // Character is tapped from playing the card.
    expect(afterResolve.players[RESOURCE_PLAYER].characters[gorbagId].status)
      .toBe(CardStatus.Tapped);

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

    // No untap lock → Gorbag untaps despite still bearing the card.
    expect(afterUntap.players[RESOURCE_PLAYER].characters[gorbagId].status)
      .toBe(CardStatus.Untapped);
  });

  // ── Rule 7: no MPs while in play ─────────────────────────────────────────

  test('no marshalling points while attached to a character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END, characters: [{ defId: GORBAG, items: [THAT_AINT_NO_SECRET] }] }],
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

  // ── Rule 8: storable at a Darkhaven during organization → 1 MP ───────────

  test('IS storable at a Darkhaven during organization', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: GORBAG, items: [THAT_AINT_NO_SECRET] }] }],
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
    expect(viableActions(base, PLAYER_1, 'store-item').length).toBe(1);
  });

  test('NOT storable at a non-haven site (free-hold)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END, characters: [{ defId: GORBAG, items: [THAT_AINT_NO_SECRET] }] }],
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
    expect(viableActions(base, PLAYER_1, 'store-item').length).toBe(0);
  });

  test('1 marshalling point awarded when stored at a Darkhaven', () => {
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
      { instanceId: mint(), definitionId: THAT_AINT_NO_SECRET },
    );
    const state = recomputeDerived(stored);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1);
  });

  // ── Rule 9: Man of Skill (wh-119) overrides the stored MP to 2 ───────────

  test('stored MP is overridden to 2 while Man of Skill (wh-119) is in play', () => {
    // Man of Skill: "Your permanent-events that require a site where
    // Information is playable are each worth 2 marshalling points." That
    // Ain't No Secret requires a site where Information is playable (its
    // play-target site filter), so once stored it should score 2, not the
    // card's own declared storable-at value of 1.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: DOL_GULDUR, characters: [SARUMAN_FW] }],
          hand: [],
          siteDeck: [BAG_END],
          playDeck: makePlayDeck(),
          cardsInPlay: [{ instanceId: mint(), definitionId: MAN_OF_SKILL, status: CardStatus.Untapped }],
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
      { instanceId: mint(), definitionId: THAT_AINT_NO_SECRET },
    );
    const state = recomputeDerived(stored);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(2);
  });
});
