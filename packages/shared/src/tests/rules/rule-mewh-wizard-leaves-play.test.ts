/**
 * MEWH §12 — When your Fallen-wizard leaves play.
 *
 * Source: The White Hand Insert, "When Your Fallen-wizard leaves play": "If your
 * Fallen-wizard leaves play, discard all of your stage resource permanent-events
 * in play that are specific for your wizard."
 *
 * Wizard-specific stage cards carry the `fallen-wizard-specific` keyword. The
 * post-reduce sweep discards them once the Fallen-wizard avatar has actually
 * left play (been eliminated, per CoE 2.2.F1) — not merely whenever it's absent
 * from the company, since a declared-but-not-yet-fielded avatar never "left"
 * play in the first place. Non-specific stage cards stay, and the sweep does
 * not fire while the avatar is present.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, CardStatus } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, GameState } from '../../index.js';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, LORIEN, MINAS_TIRITH,
  withAvatarEliminated,
} from '../test-helpers.js';

const ALATAR = 'wh-1' as CardDefinitionId;            // Fallen-wizard avatar
const BOW_OF_ALATAR = 'wh-90' as CardDefinitionId;    // Alatar-specific stage card (fallen-wizard-specific)
const A_MERRIER_WORLD = 'wh-59' as CardDefinitionId;  // stage card, NOT wizard-specific
const ASTERNAK = 'le-1' as CardDefinitionId;          // Man (keeps the company non-empty)

function inPlay(defId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId: defId, status: CardStatus.Untapped };
}

/** Fallen-wizard org-phase state with `cards` in play; the avatar is either fielded or merely declared (in the play deck). */
function fwState(cards: CardInPlay[], withAvatar: boolean): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: LORIEN, characters: withAvatar ? [ALATAR, ASTERNAK] : [ASTERNAK] }],
        hand: [],
        playDeck: withAvatar ? [] : [ALATAR],
        siteDeck: [MINAS_TIRITH],
        cardsInPlay: cards,
      },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

function inPlayIds(state: GameState): string[] {
  return state.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.instanceId as string);
}
function discardIds(state: GameState): string[] {
  return state.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId as string);
}

describe('MEWH §12 — Fallen-wizard leaves play', () => {
  beforeEach(() => resetMint());

  test('wizard-specific stage cards are discarded once the avatar is gone', () => {
    const declared = fwState([inPlay(BOW_OF_ALATAR, 'p1-1000'), inPlay(A_MERRIER_WORLD, 'p1-1001')], false);
    const state = withAvatarEliminated(declared, RESOURCE_PLAYER, ALATAR);
    // Any action triggers the post-reduce sweep.
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    // Alatar-specific card discarded; the non-specific stage card stays in play.
    expect(inPlayIds(after)).not.toContain('p1-1000');
    expect(discardIds(after)).toContain('p1-1000');
    expect(inPlayIds(after)).toContain('p1-1001');
    expect(discardIds(after)).not.toContain('p1-1001');
  });

  test('wizard-specific stage cards stay while the avatar is in play', () => {
    const state = fwState([inPlay(BOW_OF_ALATAR, 'p1-1000')], true);
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect(inPlayIds(after)).toContain('p1-1000');
    expect(discardIds(after)).not.toContain('p1-1000');
  });
});
