/**
 * @module td-166.test
 *
 * Card test: When I Know Anything (td-166)
 * Type: hero-resource-event (permanent), alignment wizard
 * Keyword: light-enchantment. Printed: 1 corruption point, 1 misc MP.
 *
 * Effects:
 *   - play-target site:      filter playableResources includes "information"
 *   - play-target character: filter untapped sage, cost tap character
 *   - play-flag:             tap-site-on-play
 *   - grant-action:          modify-corruption-check (corruptionCheckWindow),
 *                            cost tap bearer; apply = sequence of
 *                              add-constraint check-modifier +3 →
 *                                action-target-character (the resolving check)
 *                              enqueue-corruption-check (on the sage/bearer)
 *
 * Text:
 *   "Light enchantment. Playable on a sage during the site phase at a site
 *    where Information is playable. Tap sage and site. Tap sage to modify one
 *    corruption check by a character in his company by +3. Sage makes a
 *    corruption check."
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | Playable during the site phase only                           | OK     |
 * | 2 | Site must have Information playable                            | OK     |
 * | 3 | Target must be an untapped sage                                | OK     |
 * | 4 | Playing taps the sage AND the site, attaches to the sage       | OK     |
 * | 5 | Tap sage to add +3 to a company character's corruption check   | OK     |
 * |   |   — works in the unified pending window (lure/transfer/wound)  | OK     |
 * |   |   — works in the Free Council end-of-turn support window       | OK     |
 * | 6 | The sage makes a corruption check (enqueued on activation)     | OK     |
 *
 * Playable: YES — CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  CardStatus, Phase,
  buildTestState, makePlayDeck,
  resetMint,
  viableActions, viableFor,
  dispatch, resolveChain,
  findCharInstanceId,
  makeSitePhase,
  attachItemToChar, enqueueCorruptionCheck,
  ARAGORN, BILBO,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, FreeCouncilPhaseState, GameState } from '../../index.js';
import type { ActivateGrantedAction } from '../../types/actions-organization.js';
import type { CorruptionCheckAction } from '../../types/actions-universal.js';
import { addConstraint } from '../../engine/pending.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const WHEN_I_KNOW_ANYTHING = 'td-166' as CardDefinitionId;
const SWORD_OF_GONDOLIN = 'tw-336' as CardDefinitionId;   // hero item, CP 2

// Hero sites where Information is playable (ruins-and-lairs)
const DIMRILL_DALE = 'tw-385' as CardDefinitionId;  // information
const WEATHERTOP = 'tw-436' as CardDefinitionId;     // information
// Hero site without Information
const DUNHARROW = 'tw-389' as CardDefinitionId;       // border-hold, no information

// BILBO (tw-131) is a sage; ARAGORN II (tw-120) is not.

/** Build a hero site-phase state with a company at the given site. */
function buildHeroSitePhaseState(opts: {
  site: CardDefinitionId;
  characters?: CardDefinitionId[];
  hand?: CardDefinitionId[];
  siteStatus?: CardStatus;
}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: opts.site, characters: opts.characters ?? [BILBO] }],
        hand: opts.hand ?? [],
        siteDeck: [DIMRILL_DALE],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        companies: [{ site: WEATHERTOP, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [WEATHERTOP],
      },
    ],
  });
  const company = state.players[0].companies[0];
  const siteStatus = opts.siteStatus ?? CardStatus.Untapped;
  const updatedCompany = {
    ...company,
    currentSite: company.currentSite ? { ...company.currentSite, status: siteStatus } : null,
  };
  return {
    ...state,
    players: [
      { ...state.players[0], companies: [updatedCompany] },
      state.players[1],
    ] as typeof state.players,
    phaseState: makeSitePhase({ activeCompanyIndex: 0 }),
  };
}

/** Build a state with BILBO (sage) bearing td-166 and ARAGORN in the company. */
function buildBearerState(opts?: { bilboTapped?: boolean }) {
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: DIMRILL_DALE, characters: [BILBO, ARAGORN] }],
        hand: [],
        siteDeck: [WEATHERTOP],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        companies: [{ site: WEATHERTOP, characters: [] }],
        hand: [],
        siteDeck: [WEATHERTOP],
      },
    ],
  });
  state = attachItemToChar(state, RESOURCE_PLAYER, BILBO, WHEN_I_KNOW_ANYTHING);
  if (opts?.bilboTapped) {
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    state = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          characters: {
            ...state.players[RESOURCE_PLAYER].characters,
            [bilboId]: { ...state.players[RESOURCE_PLAYER].characters[bilboId], status: CardStatus.Tapped },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };
  }
  return recomputeDerived(state);
}

describe('When I Know Anything (td-166)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: site-phase only ──────────────────────────────────────────────

  test('NOT playable during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: DIMRILL_DALE, characters: [BILBO] }], hand: [WHEN_I_KNOW_ANYTHING], siteDeck: [WEATHERTOP], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP, characters: [ARAGORN] }], hand: [], siteDeck: [WEATHERTOP] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 2: site must have Information playable ───────────────────────────

  test('IS playable on a sage at a site where Information is playable', () => {
    const state = buildHeroSitePhaseState({ site: DIMRILL_DALE, hand: [WHEN_I_KNOW_ANYTHING] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });

  test('NOT playable at a site without Information (Dunharrow)', () => {
    const state = buildHeroSitePhaseState({ site: DUNHARROW, hand: [WHEN_I_KNOW_ANYTHING] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 3: target must be an untapped sage ──────────────────────────────

  test('NOT playable on a non-sage character (Aragorn)', () => {
    const state = buildHeroSitePhaseState({ site: DIMRILL_DALE, characters: [ARAGORN], hand: [WHEN_I_KNOW_ANYTHING] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable when the sage is tapped', () => {
    const state = buildHeroSitePhaseState({ site: DIMRILL_DALE, hand: [WHEN_I_KNOW_ANYTHING] });
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const tapped = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          characters: {
            ...state.players[RESOURCE_PLAYER].characters,
            [bilboId]: { ...state.players[RESOURCE_PLAYER].characters[bilboId], status: CardStatus.Tapped },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };
    expect(viableActions(tapped, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('only the sage is offered as a target when the company also has a non-sage', () => {
    const state = buildHeroSitePhaseState({ site: DIMRILL_DALE, characters: [BILBO, ARAGORN], hand: [WHEN_I_KNOW_ANYTHING] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    expect((actions[0].action as { targetCharacterId?: string }).targetCharacterId).toBe(bilboId);
  });

  // ── Rule 4: taps the sage AND the site, attaches to the sage ─────────────

  test('playing taps the sage and the site, and attaches to the sage', () => {
    const state = buildHeroSitePhaseState({ site: DIMRILL_DALE, hand: [WHEN_I_KNOW_ANYTHING] });
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const after = resolveChain(dispatch(state, viableActions(state, PLAYER_1, 'play-permanent-event')[0].action));

    expect(after.players[RESOURCE_PLAYER].characters[bilboId].status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].characters[bilboId].items
      .some(i => i.definitionId === WHEN_I_KNOW_ANYTHING)).toBe(true);
  });

  // ── In-play marshalling point (printed 1 misc) ───────────────────────────

  test('scores 1 misc marshalling point while in play on the sage', () => {
    const state = buildBearerState();
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1);
  });

  // ── Rules 5+6: the +3 ability in the unified pending window ───────────────

  test('the +3 ability is offered while a company character is making a corruption check', () => {
    let state = buildBearerState();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    state = enqueueCorruptionCheck(state, PLAYER_1, aragornId);

    const grants = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'modify-corruption-check');
    expect(grants.length).toBe(1);
    expect(grants[0].characterId).toBe(bilboId);       // the sage taps
    expect(grants[0].targetCardId).toBe(aragornId);    // boosting Aragorn's check
  });

  test('NOT offered when the sage (bearer) is tapped', () => {
    let state = buildBearerState({ bilboTapped: true });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    state = enqueueCorruptionCheck(state, PLAYER_1, aragornId);
    const grants = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'modify-corruption-check');
    expect(grants.length).toBe(0);
  });

  test('activating taps the sage, adds +3 to the check, and enqueues a sage corruption check', () => {
    let state = buildBearerState();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    state = enqueueCorruptionCheck(state, PLAYER_1, aragornId);

    const grant = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .find(a => a.actionId === 'modify-corruption-check')!;
    const after = dispatch(state, grant);

    // Sage tapped (the cost)
    expect(after.players[RESOURCE_PLAYER].characters[bilboId].status).toBe(CardStatus.Tapped);
    // +3 corruption check-modifier constraint now targets Aragorn
    expect(after.activeConstraints.some(c =>
      c.kind.type === 'check-modifier'
      && c.kind.check === 'corruption'
      && c.kind.value === 3
      && c.target.kind === 'character'
      && c.target.characterId === aragornId)).toBe(true);
    // The sage now has his own corruption check enqueued
    expect(after.pendingResolutions.some(r =>
      r.kind.type === 'corruption-check' && r.kind.characterId === bilboId)).toBe(true);

    // The re-emitted roll action for Aragorn now carries the +3 modifier
    const roll = viableActions(after, PLAYER_1, 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction)
      .find(a => a.characterId === aragornId)!;
    expect(roll.corruptionModifier).toBe(3);
  });

  // ── Rule 5 in the Free Council end-of-turn support window ─────────────────

  test('the +3 ability is offered in the Free Council support window', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DIMRILL_DALE, characters: [BILBO, ARAGORN] }], hand: [], siteDeck: [WEATHERTOP], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP, characters: [] }], hand: [], siteDeck: [WEATHERTOP] },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, BILBO, WHEN_I_KNOW_ANYTHING);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: {
        characterId: aragornId,
        corruptionPoints: 8,
        corruptionModifier: 0,
        possessions: [],
        need: 9,
        explanation: 'test',
        supportCount: 0,
      },
    };
    state = { ...state, phaseState: fcState };

    const grants = viableFor(state, PLAYER_1)
      .map(ea => ea.action)
      .filter((a): a is ActivateGrantedAction => a.type === 'activate-granted-action' && a.actionId === 'modify-corruption-check');
    expect(grants.length).toBe(1);
    expect(grants[0].characterId).toBe(bilboId);
    expect(grants[0].targetCardId).toBe(aragornId);
  });

  test('a +3 modifier constraint is consumed and applied when a Free Council check resolves', () => {
    // Aragorn bears Sword of Gondolin (CP 2); a roll of 2 fails (discard)
    // but +3 → 5 passes. The resolver reads CP and possessions from live
    // state, so the CP must come from a real item rather than the snapshot.
    const makeFcState = (aragornId: CardInstanceId): FreeCouncilPhaseState => ({
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: {
        characterId: aragornId,
        corruptionPoints: 2,
        corruptionModifier: 0,
        possessions: [],
        need: 3,
        explanation: 'test',
        supportCount: 0,
      },
    });

    const build = () => {
      const s = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.FreeCouncil,
        recompute: true,
        players: [
          { id: PLAYER_1, companies: [{ site: DIMRILL_DALE, characters: [{ defId: ARAGORN, items: [SWORD_OF_GONDOLIN] }] }], hand: [], siteDeck: [WEATHERTOP], playDeck: makePlayDeck() },
          { id: PLAYER_2, companies: [{ site: WEATHERTOP, characters: [] }], hand: [], siteDeck: [WEATHERTOP] },
        ],
      });
      return s;
    };

    // Control: no +3 — roll 2 vs CP 2 → discarded (removed from play).
    {
      const s = build();
      const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
      expect(s.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(2);
      const withFc = { ...s, phaseState: makeFcState(aragornId), cheatRollTotal: 2 };
      const after = dispatch(withFc, { type: 'pass', player: PLAYER_1 });
      expect(after.players[RESOURCE_PLAYER].characters[aragornId]).toBeUndefined();
    }

    // With +3 constraint targeting Aragorn — roll 2 + 3 = 5 > 2 → survives, constraint consumed.
    {
      const s = build();
      const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
      let withFc: GameState = { ...s, phaseState: makeFcState(aragornId), cheatRollTotal: 2 };
      withFc = addConstraint(withFc, {
        source: aragornId,
        sourceDefinitionId: WHEN_I_KNOW_ANYTHING,
        scope: { kind: 'until-cleared' },
        target: { kind: 'character', characterId: aragornId },
        kind: { type: 'check-modifier', check: 'corruption', value: 3 },
      });
      const after = dispatch(withFc, { type: 'pass', player: PLAYER_1 });
      expect(after.players[RESOURCE_PLAYER].characters[aragornId]).toBeDefined();
      expect(after.activeConstraints.some(c =>
        c.kind.type === 'check-modifier' && c.target.kind === 'character' && c.target.characterId === aragornId)).toBe(false);
    }
  });
});
