/**
 * @module ba-54.test
 *
 * Card test: Crowned with Storm (ba-54)
 * Type: minion-resource-event (short), keyword "balrog-specific". Alignment:
 * Ringwraith/Balrog. Non-unique. Marshalling points: 0.
 *
 * Text:
 *   "Balrog specific. Playable if The Balrog's company is not at an Under-deeps
 *    site and is in company vs. company combat against a company with a Wizard.
 *    Discard all allies with no body at the site. Make a roll: for each character
 *    at the site with a mind less than 8 and for each ally normally worth less
 *    than 3 marshalling points. If the result minus 1 is greater than the
 *    character's/ally's body, he is wounded or, if already wounded, eliminated.
 *    Tap all untapped allies and characters with a mind stat."
 *
 * Engine support:
 * | # | Rule                                                             | Status      |
 * |---|-----------------------------------------------------------------|-------------|
 * | 1 | Balrog-specific (deck restriction)                              | keyword     |
 * | 2 | Playable during CvCC, Balrog present, not at Under-deeps, vs Wiz| IMPLEMENTED |
 * | 3 | Discard all no-body allies at the site                          | IMPLEMENTED |
 * | 4 | Tap all untapped allies + characters with a mind stat           | IMPLEMENTED |
 * | 5 | Roll each mind<8 character and each <3-MP ally: wound/eliminate  | IMPLEMENTED |
 *
 * Rules 2–5 are carried by the new `site-storm-devastation` effect (+ its
 * `site-storm-devastation` legal-action emitter and the roller-agnostic
 * `wound-or-eliminate` dice-check verb). The effect hits *everyone at the site*
 * — both companies participating in the company-vs-company combat.
 *
 * Fixture alignment: Balrog-specific minion event → Balrog player's company is
 * The Balrog (ba-3, mind null), an Orc Brawler (le-30, mind 1 body 8) hosting a
 * Cave Troll ally (ba-35, body 8, 1 MP) and a no-body Great Bats ally (as-74),
 * and The Mouth (le-24, mind 9 body 8). The opposing Wizard company is Gandalf
 * (tw-156, wizard, mind null) plus Beregond (tw-127, mind 2 body 8) hosting a
 * Roäc the Raven ally (tw-320, body 8, 1 MP), a Tom Bombadil ally (tw-350, body
 * 11, 3 MP) and a no-body Goldberry ally (tw-245). Both companies stand at
 * Barad-dûr (ba-84, a surface dark-hold, not Under-deeps).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase, CardStatus, Alignment,
  buildTestState, resetMint,
  viableActions, viableActionsForHandCard,
  findCharInstanceId, findAllyInstanceId, getCharacter, getAlliesOn,
  attachAllyToChar, setCharStatus, companyIdAt, makeShadowMHState, recomputeDerived,
  dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CombatState, GameState } from '../../index.js';

// ── Local card-ID constants ───────────────────────────────────────────────────

/** Crowned with Storm — the card under test */
const CROWNED_WITH_STORM = 'ba-54' as CardDefinitionId;
/** The Balrog — Balrog avatar (body 11, mind null → immune to roll and tap) */
const THE_BALROG = 'ba-3' as CardDefinitionId;
/** Orc Brawler — minion, mind 1 body 8 (rolled + tapped) */
const ORC_BRAWLER = 'le-30' as CardDefinitionId;
/** The Mouth — minion, mind 9 body 8 (mind ≥ 8 → tapped but NOT rolled) */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Cave Troll — minion ally, body 8, 1 MP (rolled + tapped) */
const CAVE_TROLL = 'ba-35' as CardDefinitionId;
/** Great Bats — minion ally, no body (discarded before any roll) */
const GREAT_BATS = 'as-74' as CardDefinitionId;
/** Gandalf — Wizard avatar (mind null → immune; presence satisfies the gate) */
const GANDALF = 'tw-156' as CardDefinitionId;
/** Beregond — hero, mind 2 body 8 (rolled + tapped) */
const BEREGOND = 'tw-127' as CardDefinitionId;
/** Roäc the Raven — hero ally, body 8, 1 MP (rolled + tapped) */
const ROAC = 'tw-320' as CardDefinitionId;
/** Tom Bombadil — hero ally, body 11, 3 MP (tapped but NOT rolled) */
const TOM_BOMBADIL = 'tw-350' as CardDefinitionId;
/** Goldberry — hero ally, no body (discarded before any roll) */
const GOLDBERRY = 'tw-245' as CardDefinitionId;
/** Barad-dûr (BA) — dark-hold surface site (both companies stand here) */
const BARAD_DUR_BA = 'ba-84' as CardDefinitionId;
/** The Under-grottos (BA) — an Under-deeps site (blocks playability) */
const UNDER_GROTTOS = 'ba-101' as CardDefinitionId;

interface StormOpts {
  /** Opposing company contains a Wizard (Gandalf). Default true. */
  wizard?: boolean;
  /** The Balrog's company is at an Under-deeps site. Default false. */
  underDeeps?: boolean;
  /** The combat is company-vs-company. Default true. */
  cvcc?: boolean;
  /** The Balrog's company is the CvCC attacker rather than defender. Default false. */
  balrogAttacks?: boolean;
  /** Beregond starts already wounded (inverted). Default false. */
  prewoundBeregond?: boolean;
  /** Number of Crowned with Storm copies in the Balrog player's hand. Default 1. */
  copies?: number;
}

/**
 * Build a shadow-phase CvCC with The Balrog's company opposing a Wizard company,
 * with Crowned with Storm in the Balrog player's hand. Allies are attached
 * post-build.
 */
function stormState(opts: StormOpts = {}): GameState {
  const {
    wizard = true, underDeeps = false, cvcc = true,
    balrogAttacks = false, prewoundBeregond = false, copies = 1,
  } = opts;

  const hand: CardDefinitionId[] = [];
  for (let i = 0; i < copies; i++) hand.push(CROWNED_WITH_STORM);

  const balrogSite = underDeeps ? UNDER_GROTTOS : BARAD_DUR_BA;
  const wizardChars: CardDefinitionId[] = wizard ? [GANDALF, BEREGOND] : [BEREGOND];

  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Balrog,
        companies: [{ site: balrogSite, characters: [THE_BALROG, ORC_BRAWLER, THE_MOUTH] }],
        hand, siteDeck: [],
      },
      {
        id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: BARAD_DUR_BA, characters: wizardChars }],
        hand: [], siteDeck: [],
      },
    ],
  });

  // Balrog-side allies: a rolled/tapped ally + a no-body ally.
  state = attachAllyToChar(state, RESOURCE_PLAYER, ORC_BRAWLER, CAVE_TROLL);
  state = attachAllyToChar(state, RESOURCE_PLAYER, ORC_BRAWLER, GREAT_BATS);
  // Wizard-side allies: a rolled/tapped ally, a high-MP tapped-only ally, a no-body ally.
  state = attachAllyToChar(state, HAZARD_PLAYER, BEREGOND, ROAC);
  state = attachAllyToChar(state, HAZARD_PLAYER, BEREGOND, TOM_BOMBADIL);
  state = attachAllyToChar(state, HAZARD_PLAYER, BEREGOND, GOLDBERRY);

  if (prewoundBeregond) state = setCharStatus(state, HAZARD_PLAYER, BEREGOND, CardStatus.Inverted);

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
    ...(cvcc ? { isCvCC: true } : { creatureRace: 'orc' }),
    strikeAssignments: [{ characterId: defenderCharId, attackingCharacterId: attackerCharId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, phaseState: makeShadowMHState(), combat };
}

/** Viable Crowned-with-Storm play-short-event actions for the Balrog player. */
function stormPlays(state: GameState) {
  return viableActionsForHandCard(state, PLAYER_1, 'play-short-event', RESOURCE_PLAYER, CROWNED_WITH_STORM);
}

/** Resolve every pending storm roll for the Balrog player with a fixed 2d6 total. */
function resolveAllRolls(state: GameState, cheatRollTotal: number): GameState {
  let s = state;
  let guard = 0;
  while (s.pendingResolutions.some(r => r.kind.type === 'dice-check' && r.actor === PLAYER_1)) {
    s = dispatch({ ...s, cheatRollTotal }, { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' });
    if (++guard > 20) throw new Error('resolveAllRolls: too many iterations');
  }
  return s;
}

/** The set of targets (character or ally instance IDs) of the pending storm rolls. */
function rollTargets(state: GameState): Set<string> {
  const out = new Set<string>();
  for (const r of state.pendingResolutions) {
    if (r.kind.type !== 'dice-check') continue;
    const id = r.kind.targetCharacterId ?? r.kind.targetInstanceId;
    if (id) out.add(id as string);
  }
  return out;
}

describe('Crowned with Storm (ba-54)', () => {
  beforeEach(() => resetMint());

  // ── Rule 2: playability gates ───────────────────────────────────────────────

  test('offered during CvCC when The Balrog is present, not at Under-deeps, and the opponent has a Wizard', () => {
    expect(stormPlays(stormState())).toHaveLength(1);
  });

  test('offered when The Balrog\'s company is the CvCC attacker', () => {
    expect(stormPlays(stormState({ balrogAttacks: true }))).toHaveLength(1);
  });

  test('NOT offered when the opposing company contains no Wizard', () => {
    expect(stormPlays(stormState({ wizard: false }))).toHaveLength(0);
  });

  test('NOT offered when The Balrog\'s company is at an Under-deeps site', () => {
    expect(stormPlays(stormState({ underDeeps: true }))).toHaveLength(0);
  });

  test('NOT offered outside company-vs-company combat', () => {
    expect(stormPlays(stormState({ cvcc: false }))).toHaveLength(0);
  });

  test('NOT offered to the opposing (non-Balrog) player', () => {
    expect(viableActions(stormState(), PLAYER_2, 'play-short-event')).toHaveLength(0);
  });

  // ── Rule 3: discard all no-body allies at the site (both companies) ──────────

  test('playing discards every no-body ally at the site to its owner\'s discard pile', () => {
    const state = stormState();
    const greatBatsId = findAllyInstanceId(state, RESOURCE_PLAYER, ORC_BRAWLER, GREAT_BATS)!;
    const goldberryId = findAllyInstanceId(state, HAZARD_PLAYER, BEREGOND, GOLDBERRY)!;

    const after = dispatch(state, stormPlays(state)[0].action);

    // Both no-body allies are gone from their hosts …
    expect(getAlliesOn(after, RESOURCE_PLAYER, ORC_BRAWLER).some(a => a.definitionId === GREAT_BATS)).toBe(false);
    expect(getAlliesOn(after, HAZARD_PLAYER, BEREGOND).some(a => a.definitionId === GOLDBERRY)).toBe(false);
    // … and in their respective owners' discard piles (no instance is lost).
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === greatBatsId)).toBe(true);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === goldberryId)).toBe(true);
    // The bodied allies remain attached.
    expect(getAlliesOn(after, RESOURCE_PLAYER, ORC_BRAWLER).some(a => a.definitionId === CAVE_TROLL)).toBe(true);
    expect(getAlliesOn(after, HAZARD_PLAYER, BEREGOND).some(a => a.definitionId === ROAC)).toBe(true);
  });

  // ── Rule 4: tap all untapped allies and characters with a mind stat ─────────

  test('playing taps every untapped ally and every untapped character with a mind stat, sparing avatars', () => {
    const state = stormState();
    const after = dispatch(state, stormPlays(state)[0].action);

    // Characters with a mind stat are tapped …
    expect(getCharacter(after, RESOURCE_PLAYER, ORC_BRAWLER).status).toBe(CardStatus.Tapped);
    expect(getCharacter(after, RESOURCE_PLAYER, THE_MOUTH).status).toBe(CardStatus.Tapped);
    expect(getCharacter(after, HAZARD_PLAYER, BEREGOND).status).toBe(CardStatus.Tapped);
    // … avatars (null mind) are left untapped.
    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).status).toBe(CardStatus.Untapped);
    expect(getCharacter(after, HAZARD_PLAYER, GANDALF).status).toBe(CardStatus.Untapped);
    // Surviving allies (both companies) are tapped.
    expect(getAlliesOn(after, RESOURCE_PLAYER, ORC_BRAWLER).find(a => a.definitionId === CAVE_TROLL)!.status).toBe(CardStatus.Tapped);
    expect(getAlliesOn(after, HAZARD_PLAYER, BEREGOND).find(a => a.definitionId === ROAC)!.status).toBe(CardStatus.Tapped);
    expect(getAlliesOn(after, HAZARD_PLAYER, BEREGOND).find(a => a.definitionId === TOM_BOMBADIL)!.status).toBe(CardStatus.Tapped);
  });

  // ── Rule 5: rolls enqueued only for mind<8 characters and <3-MP allies ──────

  test('playing enqueues one wound roll per mind<8 character and per <3-MP ally, and nothing else', () => {
    const state = stormState();
    const orcBrawlerId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_BRAWLER);
    const beregondId = findCharInstanceId(state, HAZARD_PLAYER, BEREGOND);

    const after = dispatch(state, stormPlays(state)[0].action);
    const caveTrollId = findAllyInstanceId(after, RESOURCE_PLAYER, ORC_BRAWLER, CAVE_TROLL)!;
    const roacId = findAllyInstanceId(after, HAZARD_PLAYER, BEREGOND, ROAC)!;
    const tomId = findAllyInstanceId(after, HAZARD_PLAYER, BEREGOND, TOM_BOMBADIL)!;

    const targets = rollTargets(after);
    // Exactly the two mind<8 characters and the two <3-MP allies are rolled.
    expect(targets).toEqual(new Set([orcBrawlerId as string, beregondId as string, caveTrollId as string, roacId as string]));
    // The Mouth (mind 9), the avatars (null mind), and Tom Bombadil (3 MP) are NOT rolled.
    expect(targets.has(findCharInstanceId(after, RESOURCE_PLAYER, THE_MOUTH) as string)).toBe(false);
    expect(targets.has(findCharInstanceId(after, RESOURCE_PLAYER, THE_BALROG) as string)).toBe(false);
    expect(targets.has(tomId as string)).toBe(false);
    expect(after.pendingResolutions).toHaveLength(4);
  });

  test('the spent short-event goes to the Balrog player\'s discard pile', () => {
    const state = stormState();
    const scId = stormPlays(state)[0].action as { cardInstanceId: CardInstanceId };
    const after = dispatch(state, stormPlays(state)[0].action);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === scId.cardInstanceId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === scId.cardInstanceId)).toBe(false);
  });

  // ── Rule 5: roll outcome — wound when roll-1 > body ─────────────────────────

  test('a high roll (roll-1 > body) wounds each rolled character and ally in both companies', () => {
    const state = stormState();
    const afterPlay = dispatch(state, stormPlays(state)[0].action);
    const resolved = resolveAllRolls(afterPlay, 12); // 12 - 1 = 11 > body 8

    expect(getCharacter(resolved, RESOURCE_PLAYER, ORC_BRAWLER).status).toBe(CardStatus.Inverted);
    expect(getCharacter(resolved, HAZARD_PLAYER, BEREGOND).status).toBe(CardStatus.Inverted);
    expect(getAlliesOn(resolved, RESOURCE_PLAYER, ORC_BRAWLER).find(a => a.definitionId === CAVE_TROLL)!.status).toBe(CardStatus.Inverted);
    expect(getAlliesOn(resolved, HAZARD_PLAYER, BEREGOND).find(a => a.definitionId === ROAC)!.status).toBe(CardStatus.Inverted);
    // The rolls are consumed and combat continues.
    expect(resolved.pendingResolutions).toHaveLength(0);
    expect(resolved.combat).not.toBeNull();
  });

  test('a low roll (roll-1 ≤ body) wounds no one — rolled targets stay merely tapped', () => {
    const state = stormState();
    const afterPlay = dispatch(state, stormPlays(state)[0].action);
    const resolved = resolveAllRolls(afterPlay, 2); // 2 - 1 = 1, not > body 8

    expect(getCharacter(resolved, RESOURCE_PLAYER, ORC_BRAWLER).status).toBe(CardStatus.Tapped);
    expect(getCharacter(resolved, HAZARD_PLAYER, BEREGOND).status).toBe(CardStatus.Tapped);
    expect(getAlliesOn(resolved, RESOURCE_PLAYER, ORC_BRAWLER).find(a => a.definitionId === CAVE_TROLL)!.status).toBe(CardStatus.Tapped);
    expect(getAlliesOn(resolved, HAZARD_PLAYER, BEREGOND).find(a => a.definitionId === ROAC)!.status).toBe(CardStatus.Tapped);
  });

  // ── Rule 5: already-wounded target is eliminated instead of wounded ─────────

  test('a high roll eliminates an already-wounded character (Beregond) rather than re-wounding', () => {
    const state = stormState({ prewoundBeregond: true });
    const beregondId = findCharInstanceId(state, HAZARD_PLAYER, BEREGOND);

    const afterPlay = dispatch(state, stormPlays(state)[0].action);
    // Beregond entered inverted, so the tap step left him wounded (not untapped).
    expect(afterPlay.players[HAZARD_PLAYER].characters[beregondId].status).toBe(CardStatus.Inverted);

    const resolved = resolveAllRolls(afterPlay, 12);
    // Beregond is eliminated — removed from play entirely.
    expect(resolved.players[HAZARD_PLAYER].characters[beregondId]).toBeUndefined();
    expect(resolved.players[HAZARD_PLAYER].companies.some(c => c.characters.includes(beregondId))).toBe(false);
  });
});
