/**
 * @module rule-2.06-fw-avatar-leaves-play
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.06: Fallen-Wizard Avatar Leaves Play
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] If a Fallen-wizard player's avatar leaves play, that player must immediately discard all of their Stage resource permanent-events in play that are specific to the avatar.
 * [FALLEN-WIZARD] If a Fallen-wizard player's avatar has been eliminated, that player cannot play Stage resource cards that are specific to the avatar, and the player no longer counts "as" that Fallen-wizard for the purpose of non-specific Stage resource cards.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, CardStatus } from '../../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, GameState } from '../../../index.js';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, LORIEN, MINAS_TIRITH,
  buildFallenWizardOrgPhaseState, findHandCardId, viableActions,
} from '../../test-helpers.js';

const ALATAR = 'wh-1' as CardDefinitionId;            // Fallen-wizard avatar
const BOW_OF_ALATAR = 'wh-90' as CardDefinitionId;    // Alatar-specific Stage card (fallen-wizard-specific)
const FORTRESS_OF_ISEN = 'wh-68' as CardDefinitionId; // "Playable if you are Alatar, Pallando, or Saruman" — non-specific
const ISENGARD_WH = 'wh-56' as CardDefinitionId;      // FW Wizardhaven bound to Fortress of Isen
const ASTERNAK = 'le-1' as CardDefinitionId;          // Man (keeps the company non-empty without an avatar)

function inPlay(defId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId: defId, status: CardStatus.Untapped };
}

/** Eliminate a Fallen-wizard's declared avatar: move it from the play deck to the removed-from-play pile. */
function withAvatarEliminated(state: GameState, avatarDefId: CardDefinitionId): GameState {
  const fw = state.players[RESOURCE_PLAYER];
  const eliminated = fw.playDeck.find(c => c.definitionId === avatarDefId)!;
  return {
    ...state,
    players: [
      { ...fw, playDeck: fw.playDeck.filter(c => c !== eliminated), outOfPlayPile: [...fw.outOfPlayPile, eliminated] },
      state.players[1],
    ] as GameState['players'],
  };
}

function isPlayable(state: GameState, instanceId: CardInstanceId): boolean {
  return viableActions(state, PLAYER_1, 'play-permanent-event')
    .some(a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === instanceId);
}

describe('Rule 2.06 — Fallen-Wizard Avatar Leaves Play', () => {
  beforeEach(() => resetMint());

  test('[FALLEN-WIZARD] FW avatar eliminated: discard all avatar-specific Stage resource permanent-events', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.FallenWizard,
          companies: [{ site: LORIEN, characters: [ASTERNAK] }],
          hand: [], playDeck: [ALATAR], siteDeck: [MINAS_TIRITH], cardsInPlay: [inPlay(BOW_OF_ALATAR, 'p1-1000')],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Alatar has been eliminated — the post-reduce sweep discards the
    // Alatar-specific Stage card immediately, on any action.
    const eliminated = withAvatarEliminated(state, ALATAR);
    const after = dispatch(eliminated, { type: 'pass', player: PLAYER_1 });

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === 'p1-1000')).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === 'p1-1000')).toBe(true);
  });

  test('[FALLEN-WIZARD] FW avatar merely not yet played (still declared in the play deck): Stage resource stays in play', () => {
    // Regression test: the avatar has never been played (no company character
    // is Alatar), but it is still declared in the play deck — not eliminated.
    // CoE 2.2.F1's discard trigger requires the avatar to have *left* play, so
    // an avatar that was never fielded must not trip it (bug report: Saruman's
    // Machinery went straight to discard the instant it was played, because
    // Saruman himself had not yet been played).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.FallenWizard,
          companies: [{ site: LORIEN, characters: [ASTERNAK] }],
          hand: [], playDeck: [ALATAR], siteDeck: [MINAS_TIRITH], cardsInPlay: [inPlay(BOW_OF_ALATAR, 'p1-1000')],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === 'p1-1000')).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === 'p1-1000')).toBe(false);
  });

  test('[FALLEN-WIZARD] FW avatar eliminated: cannot play avatar-specific Stage resource cards', () => {
    const revealed = buildFallenWizardOrgPhaseState({
      site: LORIEN, characters: [ALATAR, ASTERNAK], hand: [BOW_OF_ALATAR],
    });
    // Alatar is revealed and in play — the Alatar-specific Stage card is playable.
    expect(isPlayable(revealed, findHandCardId(revealed, RESOURCE_PLAYER, BOW_OF_ALATAR))).toBe(true);

    const declaredOnly = buildFallenWizardOrgPhaseState({
      site: LORIEN, characters: [ASTERNAK], hand: [BOW_OF_ALATAR], playDeck: [ALATAR],
    });
    const eliminated = withAvatarEliminated(declaredOnly, ALATAR);
    // Once Alatar has been eliminated, the wizard-specific card is no longer playable.
    expect(isPlayable(eliminated, findHandCardId(eliminated, RESOURCE_PLAYER, BOW_OF_ALATAR))).toBe(false);
  });

  test('[FALLEN-WIZARD] FW avatar eliminated: player no longer counts as that FW for non-specific Stage resources', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: ISENGARD_WH, characters: [ASTERNAK], hand: [FORTRESS_OF_ISEN], playDeck: [ALATAR],
    });
    // The Fortress of Isen ("Playable if you are Alatar, Pallando, or Saruman")
    // is not specific to a single wizard, yet still keys off the player's FW
    // identity — playable while Alatar is the declared avatar, even before it
    // has been played.
    expect(isPlayable(state, findHandCardId(state, RESOURCE_PLAYER, FORTRESS_OF_ISEN))).toBe(true);

    const eliminated = withAvatarEliminated(state, ALATAR);
    // Once Alatar is eliminated, the player no longer counts "as" Alatar for
    // non-specific Stage resources either.
    expect(isPlayable(eliminated, findHandCardId(eliminated, RESOURCE_PLAYER, FORTRESS_OF_ISEN))).toBe(false);
  });
});
