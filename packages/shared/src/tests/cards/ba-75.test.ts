/**
 * @module ba-75.test
 *
 * Card test: Scourge of Fire (ba-75)
 * Type: minion-resource-event (short), keyword "balrog-specific". Alignment:
 * Ringwraith/Balrog. Non-unique. Marshalling points: 0.
 *
 * Text:
 *   "Balrog specific. Playable if Flame of Udûn is in play. You may bring this
 *    card from your sideboard into your play deck and reshuffle during your
 *    organization phase. Choose and discard one item an opponent's company bears
 *    if The Balrog is untapped and in company vs. company combat with that
 *    company. Cannot be duplicated on a given turn."
 *
 * Engine support:
 * | # | Rule                                                            | Status      |
 * |---|----------------------------------------------------------------|-------------|
 * | 1 | Balrog-specific (deck restriction)                             | keyword     |
 * | 2 | Playable only if Flame of Udûn is in play                      | IMPLEMENTED |
 * | 3 | Sideboard → play deck + reshuffle during organization phase    | IMPLEMENTED |
 * | 4 | CvCC: discard one item the opposing company bears (Balrog up)  | IMPLEMENTED |
 * | 5 | Cannot be duplicated on a given turn                           | IMPLEMENTED |
 *
 * Rules 1–2 are carried by the `balrog-specific` keyword and a `card-in-play`
 * play-condition on "Flame of Udûn"; rule 3 by a `select: "self"` sideboard→deck
 * `move` (shared with Terror Heralds Doom ba-78, exercised by its own test); rule
 * 5 by a `duplication-limit` with `scope: "turn"`.
 *
 * Rule 4 is the new `combat-discard-opponent-item` effect: a Balrog resource
 * short-event playable during a company-vs-company combat in which The Balrog is
 * untapped and a participant on the acting player's side. On play it enqueues a
 * `discard-one-company-item` pending resolution on the *opposing* company (actor
 * = the card-player), letting them choose one item borne by that company; the
 * item is discarded to the opponent's discard pile. The play is offered to
 * whichever side The Balrog is on, and only when the opposing company bears an
 * item. Playing leaves a turn-scoped duplication marker so a second copy is not
 * offered the same turn.
 *
 * Fixture alignment: Balrog-specific minion event → The Balrog (ba-3) plus a
 * Balrog surface site (Barad-dûr ba-84). The opposing CvCC company is a Wizard
 * company whose character (Beregond, tw-127) bears the hero weapon Orcrist
 * (tw-295) and the item Star-glass (tw-330). Flame of Udûn (ba-58) is placed on
 * The Balrog to satisfy the "in play" prerequisite.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase, CardStatus, Alignment,
  buildTestState, resetMint,
  viableActions, viableActionsForHandCard,
  findCharInstanceId, getCharacter, getItemsOn,
  attachItemToChar, companyIdAt, makeShadowMHState, recomputeDerived,
  dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CombatState, GameState } from '../../index.js';
import { Race } from '../../index.js';

// ── Local card-ID constants ───────────────────────────────────────────────────

/** Scourge of Fire — the card under test */
const SCOURGE_OF_FIRE = 'ba-75' as CardDefinitionId;
/** The Balrog — Balrog avatar (prowess 8, body 11, mind null) */
const THE_BALROG = 'ba-3' as CardDefinitionId;
/** Flame of Udûn — the "in play" prerequisite (a Demon fána on The Balrog) */
const FLAME_OF_UDUN = 'ba-58' as CardDefinitionId;
/** Beregond — a Wizard-side hero, the opposing CvCC character */
const BEREGOND = 'tw-127' as CardDefinitionId;
/** Orcrist — hero weapon, the opponent's item */
const ORCRIST = 'tw-295' as CardDefinitionId;
/** Star-glass — a second, non-weapon opponent item */
const STAR_GLASS = 'tw-330' as CardDefinitionId;
/** Barad-dûr (BA) — dark-hold surface site (both companies stand here) */
const BARAD_DUR_BA = 'ba-84' as CardDefinitionId;

interface CvccOpts {
  /** Flame of Udûn in play (attached to The Balrog). Default true. */
  flame?: boolean;
  /** The Balrog is tapped rather than untapped. Default false (untapped). */
  balrogTapped?: boolean;
  /** The combat is company-vs-company. Default true. */
  cvcc?: boolean;
  /** The opposing company bears item(s). Default true (Orcrist). */
  oppHasItem?: boolean;
  /** Give the opponent a second item (Star-glass) as well. Default false. */
  twoOppItems?: boolean;
  /** The Balrog's company is the *attacker* rather than the defender. Default false. */
  balrogAttacks?: boolean;
  /** Number of Scourge of Fire copies in the Balrog player's hand. Default 1. */
  copies?: number;
}

/**
 * Build a shadow-phase combat with The Balrog's company opposing a Wizard
 * company, with Scourge of Fire in the Balrog player's hand.
 */
function cvccState(opts: CvccOpts = {}): GameState {
  const {
    flame = true, balrogTapped = false, cvcc = true,
    oppHasItem = true, twoOppItems = false, balrogAttacks = false, copies = 1,
  } = opts;

  const oppItems = twoOppItems ? [ORCRIST, STAR_GLASS] : oppHasItem ? [ORCRIST] : [];
  const hand: CardDefinitionId[] = [];
  for (let i = 0; i < copies; i++) hand.push(SCOURGE_OF_FIRE);

  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: BARAD_DUR_BA, characters: [THE_BALROG] }], hand, siteDeck: [] },
      {
        id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: BARAD_DUR_BA, characters: [{ defId: BEREGOND, items: oppItems }] }],
        hand: [], siteDeck: [],
      },
    ],
  });

  if (flame) state = attachItemToChar(state, RESOURCE_PLAYER, THE_BALROG, FLAME_OF_UDUN);

  if (balrogTapped) {
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const bal = state.players[RESOURCE_PLAYER].characters[balrogId];
    const chars = { ...state.players[RESOURCE_PLAYER].characters, [balrogId as string]: { ...bal, status: CardStatus.Tapped } };
    const p0 = { ...state.players[RESOURCE_PLAYER], characters: chars };
    state = { ...state, players: [p0, state.players[HAZARD_PLAYER]] as typeof state.players };
  }

  state = recomputeDerived(state);
  const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
  const beregondId = findCharInstanceId(state, HAZARD_PLAYER, BEREGOND);
  const balrogCompanyId = companyIdAt(state, RESOURCE_PLAYER);
  const wizardCompanyId = companyIdAt(state, HAZARD_PLAYER);

  // Attacker/defender wiring: by default The Balrog defends; balrogAttacks flips it.
  const defendingPlayerId = balrogAttacks ? PLAYER_2 : PLAYER_1;
  const attackingPlayerId = balrogAttacks ? PLAYER_1 : PLAYER_2;
  const defendingCompanyId = balrogAttacks ? wizardCompanyId : balrogCompanyId;
  const attackingCompanyId = balrogAttacks ? balrogCompanyId : wizardCompanyId;
  const defenderCharId = balrogAttacks ? beregondId : balrogId;
  const attackerCharId = balrogAttacks ? balrogId : beregondId;

  const combat: CombatState = {
    attackSource: cvcc
      ? { type: 'company-attack', attackingCompanyId }
      : { type: 'creature', instanceId: 'fake-orc' as CardInstanceId },
    companyId: defendingCompanyId,
    defendingPlayerId,
    attackingPlayerId,
    strikesTotal: 1,
    strikeProwess: 8,
    creatureBody: null,
    ...(cvcc ? { isCvCC: true } : { creatureRace: Race.Orc }),
    strikeAssignments: [{ characterId: defenderCharId, attackingCharacterId: attackerCharId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, phaseState: makeShadowMHState(), combat };
}

/** Viable Scourge-of-Fire play-short-event actions for the Balrog player. */
function scourgePlays(state: GameState, playerIdx: number = RESOURCE_PLAYER) {
  return viableActionsForHandCard(
    state,
    playerIdx === RESOURCE_PLAYER ? PLAYER_1 : PLAYER_2,
    'play-short-event',
    playerIdx,
    SCOURGE_OF_FIRE,
  );
}

describe('Scourge of Fire (ba-75)', () => {
  beforeEach(() => resetMint());

  // ── Rule 4: playability gates (CvCC, Flame in play, Balrog untapped, opp item) ──

  test('offered during CvCC when The Balrog is untapped, Flame is in play, opponent bears an item', () => {
    const state = cvccState();
    expect(scourgePlays(state)).toHaveLength(1);
  });

  test('NOT offered when Flame of Udûn is not in play', () => {
    const state = cvccState({ flame: false });
    expect(scourgePlays(state)).toHaveLength(0);
  });

  test('NOT offered when The Balrog is tapped', () => {
    const state = cvccState({ balrogTapped: true });
    expect(scourgePlays(state)).toHaveLength(0);
  });

  test('NOT offered outside company-vs-company combat', () => {
    const state = cvccState({ cvcc: false });
    expect(scourgePlays(state)).toHaveLength(0);
  });

  test('NOT offered when the opposing company bears no item', () => {
    const state = cvccState({ oppHasItem: false });
    expect(scourgePlays(state)).toHaveLength(0);
  });

  test('NOT offered to the opposing (non-Balrog) player', () => {
    const state = cvccState();
    // Player 2 owns no Balrog and no Scourge of Fire in hand.
    expect(viableActions(state, PLAYER_2, 'play-short-event')).toHaveLength(0);
  });

  // ── Rule 4: playing discards one item the opposing company bears ────────────

  test('playing enqueues a discard choice over the opposing company; chosen item is discarded', () => {
    const state = cvccState({ twoOppItems: true });
    const orcristId = getItemsOn(state, HAZARD_PLAYER, BEREGOND).find(i => i.definitionId === ORCRIST)!.instanceId;
    const scourgeId = (scourgePlays(state)[0].action as { cardInstanceId: CardInstanceId }).cardInstanceId;

    const afterPlay = dispatch(state, scourgePlays(state)[0].action);

    // The spent short-event went to the Balrog player's discard pile.
    expect(afterPlay.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === scourgeId)).toBe(true);
    expect(afterPlay.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === scourgeId)).toBe(false);

    // A discard choice is now pending for the Balrog player, one per opposing item.
    const choices = viableActions(afterPlay, PLAYER_1, 'discard-item-from-company');
    expect(choices).toHaveLength(2);

    // Choose Orcrist to discard.
    const discardOrcrist = choices.find(
      ea => (ea.action as { itemInstanceId: CardInstanceId }).itemInstanceId === orcristId,
    )!;
    const afterDiscard = dispatch(afterPlay, discardOrcrist.action);

    // Orcrist left Beregond and landed in the opponent's (P2) discard pile.
    expect(getItemsOn(afterDiscard, HAZARD_PLAYER, BEREGOND).some(i => i.instanceId === orcristId)).toBe(false);
    expect(afterDiscard.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === orcristId)).toBe(true);
    // Star-glass remains (only one item is discarded).
    expect(getItemsOn(afterDiscard, HAZARD_PLAYER, BEREGOND).some(i => i.definitionId === STAR_GLASS)).toBe(true);
    // The resolution is consumed; combat continues.
    expect(afterDiscard.pendingResolutions).toHaveLength(0);
    expect(afterDiscard.combat).not.toBeNull();
  });

  // ── Rule 4: works from the attacking side too ───────────────────────────────

  test('offered when The Balrog\'s company is the CvCC attacker; discards a defender item', () => {
    const state = cvccState({ balrogAttacks: true });
    expect(scourgePlays(state)).toHaveLength(1);

    const orcristId = getItemsOn(state, HAZARD_PLAYER, BEREGOND)[0].instanceId;
    const afterPlay = dispatch(state, scourgePlays(state)[0].action);
    const choice = viableActions(afterPlay, PLAYER_1, 'discard-item-from-company')
      .find(ea => (ea.action as { itemInstanceId: CardInstanceId }).itemInstanceId === orcristId)!;
    const afterDiscard = dispatch(afterPlay, choice.action);
    expect(afterDiscard.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === orcristId)).toBe(true);
  });

  // ── Rule 5: cannot be duplicated on a given turn ────────────────────────────

  test('a second copy is not offered the same turn after one has been played', () => {
    const state = cvccState({ twoOppItems: true, copies: 2 });
    expect(scourgePlays(state)).toHaveLength(2);

    // Play the first copy and resolve its discard (Orcrist), leaving Star-glass
    // so the opponent still bears an item — isolating the turn duplication gate.
    const orcristId = getItemsOn(state, HAZARD_PLAYER, BEREGOND).find(i => i.definitionId === ORCRIST)!.instanceId;
    const afterPlay = dispatch(state, scourgePlays(state)[0].action);
    const choice = viableActions(afterPlay, PLAYER_1, 'discard-item-from-company')
      .find(ea => (ea.action as { itemInstanceId: CardInstanceId }).itemInstanceId === orcristId)!;
    const afterDiscard = dispatch(afterPlay, choice.action);

    // The opponent still bears Star-glass, yet the remaining copy is blocked.
    expect(getItemsOn(afterDiscard, HAZARD_PLAYER, BEREGOND).some(i => i.definitionId === STAR_GLASS)).toBe(true);
    expect(scourgePlays(afterDiscard)).toHaveLength(0);
  });

  test('The Balrog\'s non-combat prowess is unaffected by playing the event', () => {
    // Guards against the event leaking a stat change; it only discards an item.
    const state = cvccState();
    const before = getCharacter(state, RESOURCE_PLAYER, THE_BALROG).effectiveStats.prowess;
    const afterPlay = dispatch(state, scourgePlays(state)[0].action);
    const choice = viableActions(afterPlay, PLAYER_1, 'discard-item-from-company')[0];
    const afterDiscard = dispatch(afterPlay, choice.action);
    expect(getCharacter(afterDiscard, RESOURCE_PLAYER, THE_BALROG).effectiveStats.prowess).toBe(before);
  });
});
