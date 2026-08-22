/**
 * @module tw-298.test
 *
 * Card test: Palantír of Elostirion (tw-298)
 * Type: hero-resource-item (special, palantír), alignment wizard, unique.
 * Marshalling Points: 2. Corruption Points: 2. Keywords: palantir.
 *
 * "Unique. Palantír. Playable only at The White Towers. Discard if the
 *  bearer moves. If the bearer is a sage, he may tap Palantír of Elostirion
 *  to remove one corruption card from an Elf or a Wizard under your control.
 *  Bearer makes a corruption check. This item does not give MPs to a
 *  Fallen-wizard regardless of other cards in play."
 *
 * Effects & engine support:
 * | # | Rule                                             | Mechanism                                                             |
 * |---|---------------------------------------------------|-------------------------------------------------------------------------|
 * | 1 | Playable only at The White Towers                 | item-play-site sites=["The White Towers"]                              |
 * | 2 | Discard if the bearer moves                       | on-event bearer-company-moves → move self to discard (unconditional)   |
 * | 3 | Sage bearer may tap to remove a corruption card    | grant-action elostirion-remove-corruption, when bearer.skills          |
 * |   | from an Elf or a Wizard under your control         | $includes sage, targets own-hazard-corruption-cards filter race        |
 * |   |                                                    | $in [elf, wizard] → discard-target-corruption-card                     |
 * | 4 | Bearer makes a corruption check                   | enqueue-corruption-check in the same sequence apply                    |
 * | 5 | No MPs to a Fallen-wizard, regardless of other    | fw-mp-none — checked before the §4 clamp, `fw-mp-full (cards: items)`  |
 * |   | cards in play                                     | exemptions, and every MP override/pin                                  |
 *
 * Unlike Palantír of Amon Sûl (tw-296) or the minion Palantír of Elostirion
 * (le-332), this card's own tap ability has no "bearer able to use a
 * Palantír" precondition of its own — its text gates the tap purely on
 * "the bearer is a sage". Palantír of Amon Sûl (tw-296, certified) already
 * borrows this exact ability via its own `amon-sul-use-elostirion`
 * grant-action (own-hazard-corruption-cards scope, discard-target-corruption-card
 * apply), so the whole mechanism is established precedent.
 *
 * Fixtures: Saruman (tw-181, Wizard/sage) bears Elostirion. Legolas (tw-168,
 * Elf) and Aragorn II (tw-120, Dúnadan) are company-mates used to prove the
 * "an Elf or a Wizard" target filter.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  Phase, CardStatus, Alignment,
  CardDefinitionId,
  buildTestState, buildSitePhaseState, resetMint, makeMHState,
  viableActions, dispatch, makePlayDeck,
  findCharInstanceId, attachHazardToChar,
  ARAGORN, LEGOLAS, SARUMAN, RIVENDELL, MORIA, ISENGARD,
} from '../test-helpers.js';
import type { ActivateGrantedAction, GameState } from '../../index.js';

const PALANTIR_ELOSTIRION = 'tw-298' as CardDefinitionId;
const WHITE_TOWERS = 'tw-430' as CardDefinitionId; // hero ruins-and-lairs, wizard alignment
const DESPAIR_OF_THE_HEART = 'tw-27' as CardDefinitionId; // hazard-event, keywords: ["corruption"]
const SARUMAN_FW = 'wh-9' as CardDefinitionId; // FW avatar with fw-mp-full (cards: items)

/** All viable `activate-granted-action` actions carrying the given action id. */
function grantActions(state: GameState, actionId: string): ActivateGrantedAction[] {
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === actionId);
}

/** Hero organization-phase state; PLAYER_1's company bears Elostirion. */
function buildOrgState(opts: {
  bearer?: CardDefinitionId;
  bearerItems?: CardDefinitionId[];
  companyMates?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{
          site: MORIA,
          characters: [
            { defId: opts.bearer ?? SARUMAN, items: opts.bearerItems ?? [PALANTIR_ELOSTIRION] },
            ...(opts.companyMates ?? []).map(defId => ({ defId })),
          ],
        }],
        hand: [],
        siteDeck: [RIVENDELL],
        playDeck: makePlayDeck(),
      },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [MORIA] },
    ],
  });
}

describe('Palantír of Elostirion (tw-298)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: item-play-site (playable only at The White Towers) ──

  test('playable at The White Towers during site phase', () => {
    const state = buildSitePhaseState({
      site: WHITE_TOWERS,
      characters: [SARUMAN],
      hand: [PALANTIR_ELOSTIRION],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBe(1);
  });

  test('NOT playable at Isengard (wrong ruins-and-lairs)', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [SARUMAN],
      hand: [PALANTIR_ELOSTIRION],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBe(0);
  });

  test('NOT playable at Rivendell (haven)', () => {
    const state = buildSitePhaseState({
      site: RIVENDELL,
      characters: [SARUMAN],
      hand: [PALANTIR_ELOSTIRION],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBe(0);
  });

  // ── Effect 2: discard if the bearer moves ──

  test('discarded when the bearer’s company moves', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: SARUMAN, items: [PALANTIR_ELOSTIRION] }] }], hand: [], siteDeck: [RIVENDELL], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const dest = base.players[0].siteDeck[0];
    const withDest: GameState = {
      ...base,
      players: [
        {
          ...base.players[0],
          companies: [{
            ...base.players[0].companies[0],
            destinationSite: { instanceId: dest.instanceId, definitionId: dest.definitionId, status: CardStatus.Untapped },
          }],
        },
        base.players[1],
      ] as typeof base.players,
      phaseState: makeMHState({ activeCompanyIndex: 0 }),
    };

    const sarumanId = findCharInstanceId(withDest, RESOURCE_PLAYER, SARUMAN);
    expect(withDest.players[0].characters[sarumanId].items.length).toBe(1);

    const afterMove = dispatch(dispatch(withDest, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

    expect(afterMove.players[0].characters[sarumanId].items.some(i => i.definitionId === PALANTIR_ELOSTIRION)).toBe(false);
    expect(afterMove.players[0].discardPile.some(c => c.definitionId === PALANTIR_ELOSTIRION)).toBe(true);
  });

  // ── Effects 3 & 4: tap to remove a corruption card from an Elf or Wizard, then corruption check ──

  test('grant-action requires the bearer to be a sage AND an eligible corruption card', () => {
    const withoutCorruption = buildOrgState({ companyMates: [LEGOLAS] });
    expect(grantActions(withoutCorruption, 'elostirion-remove-corruption').length).toBe(0);

    const withCorruptionOnLegolas = attachHazardToChar(
      buildOrgState({ companyMates: [LEGOLAS] }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );
    expect(grantActions(withCorruptionOnLegolas, 'elostirion-remove-corruption').length).toBe(1);
  });

  test('NOT available when the bearer is not a sage', () => {
    const state = attachHazardToChar(
      buildOrgState({ bearer: ARAGORN, companyMates: [LEGOLAS] }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );
    expect(grantActions(state, 'elostirion-remove-corruption').length).toBe(0);
  });

  test('target filter: a corruption card on a non-Elf, non-Wizard company-mate is NOT offered', () => {
    const state = attachHazardToChar(
      buildOrgState({ companyMates: [ARAGORN] }),
      RESOURCE_PLAYER, ARAGORN, DESPAIR_OF_THE_HEART, 1,
    );
    expect(grantActions(state, 'elostirion-remove-corruption').length).toBe(0);
  });

  test('target filter: a corruption card on the Wizard bearer himself is offered', () => {
    const state = attachHazardToChar(
      buildOrgState({}),
      RESOURCE_PLAYER, SARUMAN, DESPAIR_OF_THE_HEART, 1,
    );
    expect(grantActions(state, 'elostirion-remove-corruption').length).toBe(1);
  });

  test('target filter: a corruption card on an Elf company-mate is offered', () => {
    const state = attachHazardToChar(
      buildOrgState({ companyMates: [LEGOLAS] }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );
    expect(grantActions(state, 'elostirion-remove-corruption').length).toBe(1);
  });

  test('activating discards the chosen corruption card to its owner’s pile, taps the Palantír, and enqueues a corruption check', () => {
    const state = attachHazardToChar(
      buildOrgState({ companyMates: [LEGOLAS] }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const corruptionInstId = state.players[0].characters[legolasId].hazards[0].instanceId;

    const action = grantActions(state, 'elostirion-remove-corruption')[0];
    expect(action.targetCardId).toBe(corruptionInstId);

    const after = dispatch(state, action);

    expect(after.players[0].characters[legolasId].hazards.length).toBe(0);
    // Corruption cards are owned by the opponent (hazard player).
    expect(after.players[1].discardPile.some(c => c.instanceId === corruptionInstId)).toBe(true);

    const sarumanId = findCharInstanceId(after, RESOURCE_PLAYER, SARUMAN);
    expect(after.players[0].characters[sarumanId].items.find(i => i.definitionId === PALANTIR_ELOSTIRION)?.status).toBe(CardStatus.Tapped);
    const pending = after.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });

  // ── Effect 5: no marshalling points to a Fallen-wizard ──

  test('a Wizard-aligned player scores the printed 2 item MP', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: SARUMAN, items: [PALANTIR_ELOSTIRION] }] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
  });

  test('a Fallen-wizard scores no MP for it, even with Saruman in play', () => {
    // Saruman's `fw-mp-full (cards: items)` would otherwise exempt this
    // (non-weapon) item from the MEWH §4 clamp and score its full 2 MP.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW, { defId: ARAGORN, items: [PALANTIR_ELOSTIRION] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(0);
  });
});
