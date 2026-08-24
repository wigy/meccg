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
  buildSitePhaseState, buildFallenWizardOrgPhaseState, buildFallenWizardSitePhaseState, resetMint, mint, Phase, CardStatus,
  viableActions, dispatch, resolveChain, playPermanentEventAndResolve,
  findCharInstanceId, findHandCardId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  BILBO, GANDALF, GIMLI, BREE, EDORAS, MORIA,
  AND_FORTH_HE_HASTENED,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayShortEventAction, SitePhaseState } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const FIREWORKS = 'dm-130' as CardDefinitionId;
const PALLANDO = 'tw-175' as CardDefinitionId;
const CHAMBERS_IN_THE_ROYAL_COURT = 'wh-97' as CardDefinitionId;
// wh-4: the Fallen-wizard Gandalf avatar (distinct from the Wizard-side
// GANDALF/tw-156 above) — also a sage, and the bearer required to play
// Chambers in the Royal Court ("Gandalf specific").
const GANDALF_FW = 'wh-4' as CardDefinitionId;
// BILBO (tw-131): hobbit sage, mind 5, untapped. GANDALF (tw-156): Wizard sage,
// mind null (→ 0, +10 wizard bonus). GIMLI (tw-159): warrior/diplomat, NOT a sage.
// PALLANDO (tw-175): Wizard sage, another eligible bearer when both are untapped
// in the same company. BREE (tw-378): Border-hold. EDORAS (tw-394): Free-hold.
// MORIA (tw-413): Ruins & Lairs.

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

/** Move the state into `activePlayer`'s untap phase (PLAYER_1 by default). */
function toUntapPhase(state: GameState, activePlayer = PLAYER_1): GameState {
  return {
    ...state,
    activePlayer,
    phaseState: {
      phase: Phase.Untap, untapped: false, hazardSideboardDestination: null,
      hazardSideboardFetched: 0, hazardSideboardAccessed: false,
      resourcePlayerPassed: false, hazardPlayerPassed: false,
    } as GameState['phaseState'],
  };
}

/** Move the state into the end-of-turn phase's signal-end step. */
function toEndOfTurnSignalEnd(state: GameState): GameState {
  return {
    ...state,
    phaseState: {
      phase: Phase.EndOfTurn, step: 'signal-end',
      discardDone: [true, true], resetHandDone: [true, true],
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

  test('NOT offered at a Free-hold converted into a Wizardhaven by Chambers in the Royal Court (bug fb14353f0fe88be1)', () => {
    // Reported in bug fb14353f0fe88be1 (game mszgyykt-wmmhec, seq 1031): a
    // Fallen-wizard player had already played Chambers in the Royal Court
    // (wh-97) on a hero Free-hold, converting it into a Wizardhaven (haven)
    // for their companies — yet Fireworks was still offered there and,
    // played, taps the sage and enqueues a site-untap roll on a site that,
    // per the printed site-type filter check, should no longer count as a
    // Border-hold or Free-hold. Fireworks' `play-target` site filter checked
    // the raw (printed) `siteType` instead of `effectiveSiteType`, so the
    // Chambers-installed `site-type-override` (→ haven) was never consulted.
    const orgState = buildFallenWizardOrgPhaseState({
      site: EDORAS, characters: [GANDALF_FW], hand: [CHAMBERS_IN_THE_ROYAL_COURT, FIREWORKS],
    });
    const converted = playPermanentEventAndResolve(
      orgState, PLAYER_1,
      orgState.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === CHAMBERS_IN_THE_ROYAL_COURT)!.instanceId,
      undefined, { targetSiteDefinitionId: EDORAS },
    );

    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'play-resources',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      siteEntered: true,
      resourcePlayed: false,
      minorItemAvailable: false,
      hoardBountyAvailable: false,
      thoroughSearchAvailable: false,
      declaredAgentAttack: null,
      automaticAttacksResolved: 0,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const state: GameState = {
      ...converted,
      players: [
        {
          ...converted.players[RESOURCE_PLAYER],
          companies: [{
            ...converted.players[RESOURCE_PLAYER].companies[0],
            currentSite: { ...converted.players[RESOURCE_PLAYER].companies[0].currentSite!, status: CardStatus.Tapped },
          }],
        },
        converted.players[1],
      ] as GameState['players'],
      phaseState: sitePhaseState,
    };

    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('offers a choice of targetCharacterId when multiple untapped sages are in the company (bug bb9cb4be1d9b048e)', () => {
    // Reported in bug bb9cb4be1d9b048e (game msnaf4am-v3zo0j, seq 876): with
    // both Bilbo and Pallando untapped in the same company at a tapped
    // Free-hold during the end-of-turn phase, Fireworks attached to Bilbo
    // without offering the player a choice — the "any phase" fast path
    // (organization-events.ts, evaluated outside the site phase's
    // play-resources step) picked the first eligible sage via `.find()`
    // instead of emitting one action per eligible bearer.
    const site = fireworksState({ site: EDORAS, chars: [BILBO, PALLANDO], siteStatus: CardStatus.Tapped });
    const state = toEndOfTurnSignalEnd(site);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);
    const targets = actions.map(a => (a.action as { targetCharacterId: CardInstanceId }).targetCharacterId).sort();
    expect(targets).toEqual([bilboId, pallandoId].sort());
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

  // ── Timing: rule 2.1.1 any-phase (bug e581dd026dbdf502) ─────────────────────

  test('offered during the end-of-turn phase signal-end step (rule 2.1.1)', () => {
    // Reported in bug e581dd026dbdf502 (game msgkexwh-ttj1sr, seq 1059): a
    // player with Fireworks in hand and an untapped sage at a tapped
    // Free-hold during the end-of-turn phase's signal-end step could not
    // play the card — the engine wrongly deferred it to the site phase.
    // Unlike its site-tapping siblings (Rescue Prisoners, Andúril, …), which
    // all print "during the site phase" on their card text, Fireworks'
    // text declares no such restriction, so under rule 2.1.1 it remains
    // playable during any phase as long as the sage is still untapped and
    // the site is still tapped from an earlier site phase.
    const site = fireworksState({ site: EDORAS, chars: [BILBO], siteStatus: CardStatus.Tapped });
    const state = toEndOfTurnSignalEnd(site);

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, FIREWORKS);
    const sageId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const a = actions[0].action as { cardInstanceId: CardInstanceId; targetCharacterId: CardInstanceId };
    expect(a.cardInstanceId).toBe(cardId);
    expect(a.targetCharacterId).toBe(sageId);
  });

  test('NOT offered during the end-of-turn phase when the site is untapped', () => {
    const site = fireworksState({ site: EDORAS, chars: [BILBO], siteStatus: CardStatus.Untapped });
    const state = toEndOfTurnSignalEnd(site);
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
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

  test('a Fallen-wizard avatar sage also adds +10 per g.wiz.F1 (bug 5349ae0a977d2f79)', () => {
    // Reported in bug 5349ae0a977d2f79 (game mszq6oak-jexnvn, seq 683):
    // Fireworks played on Gandalf the Fallen-wizard avatar (wh-4, race
    // "fallen-wizard") never applied the +10 Wizard bonus, so the roll's
    // constant modifier came out as 0 instead of 10 and the site never
    // untapped. CoE glossary g.wiz.F1: card text referring to a Fallen-wizard
    // player's "Wizard" (as Fireworks' "+10 if a Wizard" does) refers to that
    // player's Fallen-wizard avatar — the "isWizard" check must accept the
    // avatar's race, not just the raw Race.Wizard value.
    const fwState = buildFallenWizardSitePhaseState({
      site: EDORAS, characters: [GANDALF_FW], hand: [FIREWORKS], siteStatus: CardStatus.Tapped,
    });
    const gandalfFwId = findCharInstanceId(fwState, RESOURCE_PLAYER, GANDALF_FW);
    const fwCard = findHandCardId(fwState, RESOURCE_PLAYER, FIREWORKS);
    const fwPlayed = playPermanentEventAndResolve(fwState, PLAYER_1, fwCard, gandalfFwId, { targetSiteDefinitionId: EDORAS });
    // Rolled 3 → mind null (→ 0) + 10 wizard bonus = 13 > 12 → pass.
    const fwResolved = dispatch(
      { ...fwPlayed, cheatRollTotal: 3 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect(fwResolved.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
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

  test('the opponent\'s untap phase does not consume the skip-next-untap constraint', () => {
    // The constraint targets PLAYER_1's sage; PLAYER_2's own untap phase runs
    // in between (the very next turn) and must not touch it — only the sage's
    // own controller's untap phase may consume it.
    const state = fireworksState({ site: BREE, chars: [BILBO] });
    const sageId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, FIREWORKS);
    const played = playPermanentEventAndResolve(state, PLAYER_1, cardId, sageId, { targetSiteDefinitionId: BREE });
    const rolled = dispatch(
      { ...played, cheatRollTotal: 8 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );

    const afterOpponentUntap = dispatch(toUntapPhase(rolled, PLAYER_2), { type: 'untap', player: PLAYER_2 });
    expect(afterOpponentUntap.activeConstraints.filter(c => c.kind.type === 'skip-next-untap')).toHaveLength(1);
    expect(afterOpponentUntap.players[RESOURCE_PLAYER].characters[sageId].items.some(i => i.instanceId === cardId)).toBe(true);
    expect(afterOpponentUntap.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardId)).toBe(false);

    // The sage's own controller's untap phase, run afterward, still correctly
    // holds him tapped once and discards Fireworks.
    const afterOwnUntap = dispatch(toUntapPhase(afterOpponentUntap, PLAYER_1), { type: 'untap', player: PLAYER_1 });
    expect(afterOwnUntap.players[RESOURCE_PLAYER].characters[sageId].status).toBe(CardStatus.Tapped);
    expect(afterOwnUntap.activeConstraints.filter(c => c.kind.type === 'skip-next-untap')).toHaveLength(0);
    expect(afterOwnUntap.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardId)).toBe(true);
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

  // ── Bug 92d233ec4e4bb768: a non-phase untap must honor the skip too ────────

  test('a resource event that untaps the sage directly (bypassing the untap phase) still triggers the skip — stays tapped, Fireworks discarded', () => {
    // Reported in bug 92d233ec4e4bb768 (game msdp72wh-j5004s, seq 733):
    // Fireworks installed its skip-next-untap on the sage, but before the
    // sage's own untap phase ever arrived, And Forth He Hastened (td-98) untapped
    // him directly. That direct untap bypassed the constraint entirely — the
    // sage became untapped and Fireworks just sat in his items forever,
    // never discarded. The card text ("the next time the sage would
    // otherwise become untapped...") must intercept ANY untap attempt, not
    // just the untap-phase sweep.
    const state = fireworksState({ site: BREE, chars: [GANDALF] });
    const sageId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, FIREWORKS);
    const played = playPermanentEventAndResolve(state, PLAYER_1, cardId, sageId, { targetSiteDefinitionId: BREE });

    const rolled = dispatch(
      { ...played, cheatRollTotal: 8 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect(rolled.players[RESOURCE_PLAYER].characters[sageId].status).toBe(CardStatus.Tapped);

    // Move to the organization phase and give the sage's controller And Forth
    // He Hastened, then play it targeting the (still tapped) sage — Gandalf
    // is his own avatar, so he's trivially "in the Wizard's company".
    const hastenedCardId = mint();
    const withHastened: GameState = {
      ...rolled,
      phaseState: {
        phase: Phase.Organization,
        characterPlayedThisTurn: false,
        sideboardFetchedThisTurn: 0,
        sideboardFetchDestination: null,
      } as GameState['phaseState'],
      players: [
        {
          ...rolled.players[RESOURCE_PLAYER],
          hand: [...rolled.players[RESOURCE_PLAYER].hand, { instanceId: hastenedCardId, definitionId: AND_FORTH_HE_HASTENED }],
        },
        rolled.players[1],
      ] as typeof rolled.players,
    };

    const untapAction = computeLegalActions(withHastened, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .find(a => a.cardInstanceId === hastenedCardId && a.targetCharacterId === sageId);
    expect(untapAction).toBeDefined();

    const resolved = resolveChain(dispatch(withHastened, untapAction!));

    // The sage stays tapped — the untap was intercepted, not applied.
    expect(resolved.players[RESOURCE_PLAYER].characters[sageId].status).toBe(CardStatus.Tapped);
    // Fireworks is discarded and removed from the sage's items.
    expect(resolved.players[RESOURCE_PLAYER].characters[sageId].items.some(i => i.instanceId === cardId)).toBe(false);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardId)).toBe(true);
    // The one-shot constraint is consumed.
    expect(resolved.activeConstraints.filter(c => c.kind.type === 'skip-next-untap')).toHaveLength(0);
    // And Forth He Hastened itself is still spent/discarded as normal.
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === hastenedCardId)).toBe(true);
  });
});
