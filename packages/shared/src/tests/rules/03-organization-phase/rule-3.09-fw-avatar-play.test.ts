/**
 * @module rule-3.09-fw-avatar-play
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.09: Fallen-Wizard Avatar Play
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard avatar can only be played at the avatar's home site.
 * [FALLEN-WIZARD] Whenever a Fallen-wizard avatar is played, its player's general influence immediately becomes the number in the white hand on the left side of the avatar card for as long as the avatar is in play.
 * [FALLEN-WIZARD] When a Fallen-wizard player plays a Fallen-wizard avatar, any of their opponent's Stage resource permanent-events in play that are specific to that avatar are immediately discarded.
 */

import { describe, test, expect } from 'vitest';
import {
  buildTestState,
  effectiveGeneralInfluence,
  viablePlayCharacterActions,
  addP2CardsInPlay,
  dispatch,
  mint,
  CardStatus,
  Phase,
  Alignment,
  PLAYER_1,
  PLAYER_2,
  ISENGARD,
  ARAGORN,
  LEGOLAS,
  LORIEN,
  RIVENDELL,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../test-helpers.js';

// Fallen-wizard avatars carry their general influence as the white-hand value
// printed on the card (data field `generalInfluence`). Single-test use → inline.
const SARUMAN_FW = 'wh-9' as CardDefinitionId; // home Isengard, white-hand GI 15
const ALATAR_FW = 'wh-1' as CardDefinitionId; //  white-hand GI 17
const RADAGAST_FW = 'wh-8' as CardDefinitionId; // white-hand GI 22
const THE_WHITE_HAND_STAGE = 'wh-122' as CardDefinitionId; // saruman-specific stage resource
const BOW_OF_ALATAR = 'wh-90' as CardDefinitionId; // alatar-specific stage resource

/** Build a state with a single Fallen-wizard company holding `chars` at Isengard. */
function fwState(chars: CardDefinitionId[]) {
  return buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD, characters: chars }],
        hand: [],
        siteDeck: [ISENGARD],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Rule 3.09 — Fallen-Wizard Avatar Play', () => {
  describe('[FALLEN-WIZARD] avatar fixes general influence to its white-hand value while in play', () => {
    test('Saruman in play → GI pool is 15 (not the default 20)', () => {
      const state = fwState([SARUMAN_FW]);
      expect(effectiveGeneralInfluence(state, PLAYER_1)).toBe(15);
    });

    test('different avatars carry different white-hand values (Alatar 17, Radagast 22)', () => {
      expect(effectiveGeneralInfluence(fwState([ALATAR_FW]), PLAYER_1)).toBe(17);
      expect(effectiveGeneralInfluence(fwState([RADAGAST_FW]), PLAYER_1)).toBe(22);
    });

    test('before the avatar is revealed, the Fallen-wizard has the default 20', () => {
      // A Fallen-wizard company without its avatar in play (pre-reveal) keeps
      // the standard pool. CRF-22: "Prior to that, his general influence is 20."
      const state = fwState([ARAGORN]); // non-avatar character only
      expect(effectiveGeneralInfluence(state, PLAYER_1)).toBe(20);
    });

    test('the white-hand value reduces how much mind can be controlled under GI', () => {
      // Saruman (GI 15) + Aragorn II (mind 9) under general influence: 9 of 15
      // used, 6 free — versus 11 free if the pool were the default 20.
      const state = fwState([SARUMAN_FW, ARAGORN]);
      const free = effectiveGeneralInfluence(state, PLAYER_1) - state.players[0].generalInfluenceUsed;
      expect(state.players[0].generalInfluenceUsed).toBe(9);
      expect(free).toBe(6);
    });
  });

  test('[FALLEN-WIZARD] Avatar can only be played at its home site', () => {
    // Saruman's home site is Isengard. The FW already has a company at Rivendell
    // (a haven that is NOT his home) and Isengard waiting in the site deck.
    // Rule 2.II.2.1.F1: unlike a normal character (playable at any haven), a
    // Fallen-wizard avatar may enter play only at his home site — so Isengard,
    // and never the non-home haven (Rivendell).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [SARUMAN_FW],
          siteDeck: [ISENGARD],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const sarumanInst = state.players[0].hand.find(c => c.definitionId === SARUMAN_FW)!.instanceId;
    const isengardInst = state.players[0].siteDeck.find(s => s.definitionId === ISENGARD)!.instanceId;
    const rivendellInst = state.players[0].companies[0].currentSite!.instanceId;

    const sarumanPlays = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === sarumanInst);

    // Offered at his home site (Isengard) …
    expect(sarumanPlays.map(a => a.atSite)).toContain(isengardInst);
    // … and nowhere else — not at the non-home haven where his company sits.
    expect(sarumanPlays.map(a => a.atSite)).not.toContain(rivendellInst);
    expect(sarumanPlays).toHaveLength(1);
  });

  test('[FALLEN-WIZARD] playing the avatar discards the opponent\'s Stage resources specific to that avatar', () => {
    // The opponent (here a Wizard player, who can hold Stage resources via
    // the MEWH anti-FW sideboard) has one Saruman-specific and one
    // Alatar-specific stage card in play. When the Fallen-wizard plays
    // Saruman, only the Saruman-specific card is discarded.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [ARAGORN] }],
          hand: [SARUMAN_FW],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const sarumanSpecificId = mint();
    const alatarSpecificId = mint();
    const state = addP2CardsInPlay(base, [
      { instanceId: sarumanSpecificId, definitionId: THE_WHITE_HAND_STAGE, status: CardStatus.Untapped },
      { instanceId: alatarSpecificId, definitionId: BOW_OF_ALATAR, status: CardStatus.Untapped },
    ]);

    const sarumanInst = state.players[0].hand.find(c => c.definitionId === SARUMAN_FW)!.instanceId;
    const playSaruman = viablePlayCharacterActions(state, PLAYER_1)
      .find(a => a.characterInstanceId === sarumanInst);
    expect(playSaruman).toBeDefined();
    const after = dispatch(state, playSaruman!);

    // The Saruman-specific stage card left play into its owner's discard pile…
    expect(after.players[1].cardsInPlay.some(c => c.instanceId === sarumanSpecificId)).toBe(false);
    expect(after.players[1].discardPile.some(c => c.instanceId === sarumanSpecificId)).toBe(true);
    // …while the Alatar-specific one is untouched.
    expect(after.players[1].cardsInPlay.some(c => c.instanceId === alatarSpecificId)).toBe(true);
  });
});
