/**
 * @module dm-130.test
 *
 * Card test: Fireworks (dm-130)
 * Type: hero-resource-event (permanent), non-unique, keyword "ritual".
 *
 * Text:
 *   "Ritual. Playable on an untapped sage at a tapped Border-hold [{B}] or
 *    Free-hold [{F}]. Tap sage. Make a roll and add the mind of the sage (+10
 *    if a Wizard)—if the result is greater than 12, the site untaps. The next
 *    time the sage would otherwise become untapped make him tapped instead and
 *    discard this card."
 *
 * Effects:
 * | # | Rule (card text)                                          | Encoding                          |
 * |---|-----------------------------------------------------------|-----------------------------------|
 * | 1 | Playable on an untapped sage                              | play-target character (sage+untap)|
 * | 2 | at a tapped Border-hold or Free-hold                      | play-target site + tapped-site-only|
 * | 3 | Tap sage                                                  | play-flag tap-character-on-play   |
 * | 4 | Roll + mind (+10 if Wizard) > 12 → the site untaps        | roll-untap-site (dice-check verb)  |
 * | 5 | Next time the sage would untap, he stays tapped + discard | skip-next-untap-on-play           |
 *
 * The roll surfaces as its own `resolve-dice-check` action (2d6 + the sage's
 * effective mind, plus 10 when the sage is a Wizard). On a pass the sage's
 * company's current site untaps; the sage himself was tapped as the play cost
 * and stays tapped (the skip-next-untap constraint holds him through his next
 * untap, then Fireworks — attached to his items — is discarded).
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, resetMint, Phase, CardStatus,
  viableActions, dispatch, playPermanentEventAndResolve,
  findCharInstanceId, findHandCardId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  BILBO, GANDALF, GIMLI, BREE, EDORAS, MORIA,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const FIREWORKS = 'dm-130' as CardDefinitionId;
// BILBO (tw-131): hobbit sage, mind 5, untapped. GANDALF (tw-156): Wizard sage,
// mind null (→ 0, +10 wizard bonus). GIMLI (tw-159): warrior/diplomat, NOT a sage.
// BREE (tw-378): Border-hold. EDORAS (tw-394): Free-hold. MORIA (tw-413): Ruins & Lairs.

/** Site-phase state: a company with `chars` at `site` (status `siteStatus`), Fireworks in hand. */
function fireworksState(opts: {
  site?: CardDefinitionId;
  chars?: CardDefinitionId[];
  siteStatus?: CardStatus;
}): GameState {
  return buildSitePhaseState({
    site: opts.site ?? BREE,
    characters: opts.chars ?? [BILBO],
    hand: [FIREWORKS],
    siteStatus: opts.siteStatus ?? CardStatus.Tapped,
  });
}

/** Move the resource player's state into their untap phase. */
function toUntapPhase(state: GameState): GameState {
  return {
    ...state,
    activePlayer: PLAYER_1,
    phaseState: {
      phase: Phase.Untap, untapped: false, hazardSideboardDestination: null,
      hazardSideboardFetched: 0, hazardSideboardAccessed: false,
      resourcePlayerPassed: false, hazardPlayerPassed: false,
    } as GameState['phaseState'],
  };
}

describe('Fireworks (dm-130)', () => {
  beforeEach(() => resetMint());

  // ── Playability gate ───────────────────────────────────────────────────────

  test('offered on an untapped sage at a tapped Border-hold', () => {
    const state = fireworksState({ site: BREE, chars: [BILBO], siteStatus: CardStatus.Tapped });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, FIREWORKS);
    const sageId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const a = actions[0].action as { cardInstanceId: CardInstanceId; targetCharacterId: CardInstanceId };
    expect(a.cardInstanceId).toBe(cardId);
    expect(a.targetCharacterId).toBe(sageId);
  });

  test('offered at a tapped Free-hold too', () => {
    const state = fireworksState({ site: EDORAS, chars: [BILBO], siteStatus: CardStatus.Tapped });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(1);
  });

  test('NOT offered when the site is untapped (tapped-site-only)', () => {
    const state = fireworksState({ site: BREE, chars: [BILBO], siteStatus: CardStatus.Untapped });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT offered at a tapped non-Border/Free-hold site (Ruins & Lairs)', () => {
    const state = fireworksState({ site: MORIA, chars: [BILBO], siteStatus: CardStatus.Tapped });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT offered when the only character is not a sage', () => {
    const state = fireworksState({ site: BREE, chars: [GIMLI], siteStatus: CardStatus.Tapped });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT offered on a tapped sage (must be untapped)', () => {
    const base = fireworksState({ site: BREE, chars: [BILBO], siteStatus: CardStatus.Tapped });
    const sageId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
    const tappedSage: GameState = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          characters: {
            ...base.players[RESOURCE_PLAYER].characters,
            [sageId]: { ...base.players[RESOURCE_PLAYER].characters[sageId], status: CardStatus.Tapped },
          },
        },
        base.players[1],
      ] as typeof base.players,
    };
    expect(viableActions(tappedSage, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ── On play: taps the sage, enqueues the roll, installs the delayed skip ─────

  test('playing taps the sage, attaches the card, and enqueues the roll + skip-next-untap', () => {
    const state = fireworksState({ site: BREE, chars: [BILBO] });
    const sageId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, FIREWORKS);

    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, sageId, { targetSiteDefinitionId: BREE });

    // The sage is tapped as the play cost.
    expect(after.players[RESOURCE_PLAYER].characters[sageId].status).toBe(CardStatus.Tapped);
    // The card leaves hand and attaches to the sage's items (not yet discarded).
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === cardId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].characters[sageId].items.some(i => i.instanceId === cardId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardId)).toBe(false);
    // A one-shot skip-next-untap constraint targets the sage.
    const constraints = after.activeConstraints.filter(c => c.kind.type === 'skip-next-untap');
    expect(constraints).toHaveLength(1);
    expect(constraints[0].target.kind === 'character' && constraints[0].target.characterId).toBe(sageId);
    // The roll is pending as its own resolve-dice-check action for the card player.
    expect(viableActions(after, PLAYER_1, 'resolve-dice-check')).toHaveLength(1);
  });

  // ── The roll: pass untaps the site, fail leaves it tapped ────────────────────

  test('roll pass (2d6 + mind > 12) untaps the site', () => {
    const state = fireworksState({ site: BREE, chars: [BILBO] });
    const sageId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, FIREWORKS);
    const played = playPermanentEventAndResolve(state, PLAYER_1, cardId, sageId, { targetSiteDefinitionId: BREE });
    expect(played.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);

    // Bilbo's mind is 5; a rolled 8 → 8 + 5 = 13 > 12 → the site untaps.
    const resolved = dispatch(
      { ...played, cheatRollTotal: 8 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect(resolved.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
    // The sage himself remains tapped (the site untapped, not the sage).
    expect(resolved.players[RESOURCE_PLAYER].characters[sageId].status).toBe(CardStatus.Tapped);
  });

  test('roll fail (2d6 + mind not > 12) leaves the site tapped', () => {
    const state = fireworksState({ site: BREE, chars: [BILBO] });
    const sageId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, FIREWORKS);
    const played = playPermanentEventAndResolve(state, PLAYER_1, cardId, sageId, { targetSiteDefinitionId: BREE });

    // Bilbo's mind is 5; a rolled 7 → 7 + 5 = 12, not strictly greater than 12.
    const resolved = dispatch(
      { ...played, cheatRollTotal: 7 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect(resolved.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
  });

  test('a Wizard sage adds +10, so even a low roll can pass (a non-Wizard would fail)', () => {
    // Gandalf: Wizard sage, mind null → 0 + 10 wizard bonus. Rolled 3 → 3 + 10 = 13 > 12 → pass.
    const wizState = fireworksState({ site: BREE, chars: [GANDALF] });
    const gandalfId = findCharInstanceId(wizState, RESOURCE_PLAYER, GANDALF);
    const wizCard = findHandCardId(wizState, RESOURCE_PLAYER, FIREWORKS);
    const wizPlayed = playPermanentEventAndResolve(wizState, PLAYER_1, wizCard, gandalfId, { targetSiteDefinitionId: BREE });
    const wizResolved = dispatch(
      { ...wizPlayed, cheatRollTotal: 3 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect(wizResolved.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);

    // Control: the same roll of 3 on a non-Wizard sage (Bilbo, mind 5 → 8) fails.
    const heroState = fireworksState({ site: BREE, chars: [BILBO] });
    const bilboId = findCharInstanceId(heroState, RESOURCE_PLAYER, BILBO);
    const heroCard = findHandCardId(heroState, RESOURCE_PLAYER, FIREWORKS);
    const heroPlayed = playPermanentEventAndResolve(heroState, PLAYER_1, heroCard, bilboId, { targetSiteDefinitionId: BREE });
    const heroResolved = dispatch(
      { ...heroPlayed, cheatRollTotal: 3 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect(heroResolved.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
  });

  // ── Delayed effect: the sage stays tapped next untap + Fireworks is discarded ─

  test('at the next untap the sage stays tapped and Fireworks is discarded', () => {
    const state = fireworksState({ site: BREE, chars: [BILBO] });
    const sageId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, FIREWORKS);
    const played = playPermanentEventAndResolve(state, PLAYER_1, cardId, sageId, { targetSiteDefinitionId: BREE });
    expect(played.players[RESOURCE_PLAYER].characters[sageId].status).toBe(CardStatus.Tapped);

    // Resolve the on-play roll (outcome irrelevant to the untap skip).
    const rolled = dispatch(
      { ...played, cheatRollTotal: 8 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    const afterUntap = dispatch(toUntapPhase(rolled), { type: 'untap', player: PLAYER_1 });

    // The sage would normally untap — instead he stays tapped once.
    expect(afterUntap.players[RESOURCE_PLAYER].characters[sageId].status).toBe(CardStatus.Tapped);
    // Fireworks is discarded and removed from the sage's items.
    expect(afterUntap.players[RESOURCE_PLAYER].characters[sageId].items.some(i => i.instanceId === cardId)).toBe(false);
    expect(afterUntap.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardId)).toBe(true);
    // The one-shot constraint is consumed.
    expect(afterUntap.activeConstraints.filter(c => c.kind.type === 'skip-next-untap')).toHaveLength(0);
  });

  test('a second, later untap untaps the sage normally (the skip was one-shot)', () => {
    const state = fireworksState({ site: BREE, chars: [BILBO] });
    const sageId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, FIREWORKS);
    const played = playPermanentEventAndResolve(state, PLAYER_1, cardId, sageId, { targetSiteDefinitionId: BREE });

    const rolled = dispatch(
      { ...played, cheatRollTotal: 8 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    const firstUntap = dispatch(toUntapPhase(rolled), { type: 'untap', player: PLAYER_1 });
    expect(firstUntap.players[RESOURCE_PLAYER].characters[sageId].status).toBe(CardStatus.Tapped);

    const secondUntap = dispatch(toUntapPhase(firstUntap), { type: 'untap', player: PLAYER_1 });
    expect(secondUntap.players[RESOURCE_PLAYER].characters[sageId].status).toBe(CardStatus.Untapped);
  });
});
