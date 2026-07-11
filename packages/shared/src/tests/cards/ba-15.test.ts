/**
 * @module ba-15.test
 *
 * Card test: Darkness Made by Malice (ba-15)
 * Type: hazard-event (short), non-unique, Neutral
 *
 * Text:
 *   "Playable on a company at or moving to a Ruins & Lairs [{R}] or Under-deeps
 *    site, if there are more Spawn cards in play than characters in the company.
 *    Eliminated Spawn do not count. The company must do nothing during its site
 *    phase this turn."
 *
 * Effects (data):
 *   - play-target company, filter:
 *       (site is Ruins & Lairs OR carries the `under-deeps` keyword)
 *       AND more Spawn cards in play than characters in the company
 *   - company-site-phase-do-nothing
 *
 * Engine support:
 * | # | Rule                                                        | Status |
 * |---|-------------------------------------------------------------|--------|
 * | 1 | Playable on a company AT a Ruins & Lairs                     | OK     |
 * | 2 | Playable on a company MOVING TO a Ruins & Lairs             | OK     |
 * | 3 | Playable on a company at/moving to an Under-deeps site      | OK     |
 * | 4 | NOT playable at any other site type (shadow-hold, free-hold) | OK    |
 * | 5 | Requires MORE Spawn in play than characters (strict >)      | OK     |
 * | 6 | Eliminated (discarded) Spawn do not count                    | OK     |
 * | 7 | The company must do nothing during its site phase this turn  | OK     |
 *
 * Player-index convention: the moving (resource) company is a hero company
 * (P1 / RESOURCE_PLAYER); the hazard player (P2 / HAZARD_PLAYER) plays the
 * Neutral short-event and owns the in-play Spawn cards.
 *
 * Playable: YES. The two playability restrictions ride a `play-target: company`
 * filter (the short-event company-target path exposes the target company's site
 * type / keywords and the precomputed Spawn-vs-character comparison), and the
 * "do nothing during its site phase" clause is a `company-site-phase-do-nothing`
 * effect that adds a `site-phase-do-nothing` constraint to the company on chain
 * resolution — the same constraint that collapses the company's site phase to a
 * single `pass` (shared with `company-return-to-origin` / rule 2.IV.4).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, resetMint, makeMHState,
  addCardInPlay,
  viableActions, handCardId, companyIdAt, dispatch,
  playHazardAndResolve,
} from '../test-helpers.js';
import { Phase, Alignment, CardStatus, computeLegalActions } from '../../index.js';
import type { GameState, CardDefinitionId } from '../../index.js';

const DARKNESS_MADE_BY_MALICE = 'ba-15' as CardDefinitionId;

// Sites (all hero-sites so the hero moving company is valid).
const GLADDEN_FIELDS = 'tw-396' as CardDefinitionId;   // ruins-and-lairs
const THE_UNDER_LEAS = 'dm-40' as CardDefinitionId;    // shadow-hold + `under-deeps`
const MORIA = 'tw-413' as CardDefinitionId;            // shadow-hold, NOT under-deeps
const MINAS_TIRITH = 'tw-412' as CardDefinitionId;     // free-hold (site-deck filler / negative)

const ARAGORN = 'tw-120' as CardDefinitionId;          // hero character
const GLOIN = 'tw-160' as CardDefinitionId;            // hero character (second body)
const MIONID = 'as-3' as CardDefinitionId;             // minion character (hazard placeholder)

// Spawn-keyword cards used to populate "Spawn cards in play".
const BALROG_OF_MORIA = 'tw-12' as CardDefinitionId;         // Spawn permanent-event
const MONSTROSITY = 'ba-21' as CardDefinitionId;             // Spawn permanent-event
const SPAWN_OF_UNGOLIANT = 'ba-24' as CardDefinitionId;      // Spawn permanent-event

/**
 * Build an M/H play-hazards state: a hero company (P1) of `chars` at
 * `companySite` (optionally moving to `destinationSite`), and a hazard player
 * (P2) holding Darkness Made by Malice with `spawnInPlay` Spawn cards in its
 * `cardsInPlay` and `spawnInDiscard` Spawn cards in its discard pile.
 */
function build(opts: {
  chars: CardDefinitionId[];
  companySite: CardDefinitionId;
  destinationSite?: CardDefinitionId;
  spawnInPlay?: CardDefinitionId[];
  spawnInDiscard?: CardDefinitionId[];
}): GameState {
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{
          site: opts.companySite,
          characters: opts.chars,
          ...(opts.destinationSite ? { destinationSite: opts.destinationSite } : {}),
        }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MORIA, characters: [MIONID] }],
        hand: [DARKNESS_MADE_BY_MALICE],
        siteDeck: [MINAS_TIRITH],
        discardPile: opts.spawnInDiscard ?? [],
      },
    ],
  });
  for (const spawn of opts.spawnInPlay ?? []) {
    state = addCardInPlay(state, HAZARD_PLAYER, spawn);
  }
  return { ...state, phaseState: makeMHState({ destinationSiteName: 'x' }) };
}

describe('Darkness Made by Malice (ba-15)', () => {
  beforeEach(() => resetMint());

  // ─── Site-type playability ──────────────────────────────────────────────────

  test('playable on a company AT a Ruins & Lairs when Spawn outnumber characters', () => {
    const s = build({ chars: [ARAGORN], companySite: GLADDEN_FIELDS, spawnInPlay: [BALROG_OF_MORIA, MONSTROSITY] });
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(1);
  });

  test('playable on a company MOVING TO a Ruins & Lairs (reads the destination site)', () => {
    // The company sits at a non-qualifying shadow-hold but is moving to a R&L.
    const s = build({ chars: [ARAGORN], companySite: MORIA, destinationSite: GLADDEN_FIELDS, spawnInPlay: [BALROG_OF_MORIA, MONSTROSITY] });
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(1);
  });

  test('playable on a company at an Under-deeps site (keyword, not a R&L site type)', () => {
    const s = build({ chars: [ARAGORN], companySite: THE_UNDER_LEAS, spawnInPlay: [BALROG_OF_MORIA, MONSTROSITY] });
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(1);
  });

  test('NOT playable at a plain shadow-hold (neither R&L nor Under-deeps)', () => {
    const s = build({ chars: [ARAGORN], companySite: MORIA, spawnInPlay: [BALROG_OF_MORIA, MONSTROSITY] });
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const all = computeLegalActions(s, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
  });

  test('NOT playable at a free-hold', () => {
    const s = build({ chars: [ARAGORN], companySite: MINAS_TIRITH, spawnInPlay: [BALROG_OF_MORIA, MONSTROSITY] });
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Spawn-count playability (strictly greater than character count) ──────────

  test('NOT playable when Spawn in play EQUAL the character count (needs strictly more)', () => {
    // 1 Spawn in play vs 1 character → 1 is not > 1.
    const s = build({ chars: [ARAGORN], companySite: GLADDEN_FIELDS, spawnInPlay: [BALROG_OF_MORIA] });
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable when Spawn in play are fewer than the characters', () => {
    // 1 Spawn in play vs 2 characters.
    const s = build({ chars: [ARAGORN, GLOIN], companySite: GLADDEN_FIELDS, spawnInPlay: [BALROG_OF_MORIA] });
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('playable once Spawn in play exceed a two-character company', () => {
    // 3 Spawn in play vs 2 characters → 3 > 2.
    const s = build({
      chars: [ARAGORN, GLOIN],
      companySite: GLADDEN_FIELDS,
      spawnInPlay: [BALROG_OF_MORIA, MONSTROSITY, SPAWN_OF_UNGOLIANT],
    });
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(1);
  });

  // ─── "Eliminated Spawn do not count" ─────────────────────────────────────────

  test('Spawn in the discard pile do not count toward the total', () => {
    // 1 Spawn in play + 1 Spawn in the hazard player's discard, vs 1 character.
    // Only the in-play copy counts → 1 is not > 1 → not playable.
    const s = build({
      chars: [ARAGORN],
      companySite: GLADDEN_FIELDS,
      spawnInPlay: [BALROG_OF_MORIA],
      spawnInDiscard: [MONSTROSITY],
    });
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(0);

    // Bringing that second Spawn into play instead flips it to playable.
    const s2 = build({
      chars: [ARAGORN],
      companySite: GLADDEN_FIELDS,
      spawnInPlay: [BALROG_OF_MORIA, MONSTROSITY],
    });
    expect(viableActions(s2, PLAYER_2, 'play-hazard')).toHaveLength(1);
  });

  // ─── Effect: the company must do nothing during its site phase ───────────────

  test('resolving adds a site-phase-do-nothing constraint bound to the company', () => {
    const s = build({ chars: [ARAGORN], companySite: GLADDEN_FIELDS, spawnInPlay: [BALROG_OF_MORIA, MONSTROSITY] });
    const cardId = handCardId(s, HAZARD_PLAYER);
    const companyId = companyIdAt(s, RESOURCE_PLAYER);

    const after = playHazardAndResolve(s, PLAYER_2, cardId, companyId);

    expect(after.activeConstraints.some(
      c => c.kind.type === 'site-phase-do-nothing'
        && c.target.kind === 'company' && c.target.companyId === companyId
        && c.sourceDefinitionId === DARKNESS_MADE_BY_MALICE,
    )).toBe(true);
    // The company keeps its site — this hazard does not move it (contrast with
    // company-return-to-origin).
    expect((after.phaseState as { returnedToOrigin?: boolean }).returnedToOrigin).toBeFalsy();
  });

  test('the constrained company can only pass during its site phase', () => {
    const s = build({ chars: [ARAGORN], companySite: GLADDEN_FIELDS, spawnInPlay: [BALROG_OF_MORIA, MONSTROSITY] });
    const cardId = handCardId(s, HAZARD_PLAYER);
    const companyId = companyIdAt(s, RESOURCE_PLAYER);
    const resolved = playHazardAndResolve(s, PLAYER_2, cardId, companyId);

    // Carry the constraint into the company's site phase and confirm the engine
    // collapses its choices to a single pass at the enter-or-skip step.
    const inSitePhase: GameState = {
      ...resolved,
      phaseState: {
        phase: Phase.Site,
        step: 'select-company',
        activeCompanyIndex: 0,
        handledCompanyIds: [],
        siteEntered: false,
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
      } as GameState['phaseState'],
    };
    const atEnterOrSkip = dispatch(inSitePhase, { type: 'select-company', player: PLAYER_1, companyId: companyId as never });

    const viableTypes = new Set(
      computeLegalActions(atEnterOrSkip, PLAYER_1).filter(ea => ea.viable).map(ea => ea.action.type),
    );
    expect(viableTypes.has('enter-site')).toBe(false);
    expect([...viableTypes]).toEqual(['pass']);
  });

  // ─── Marker: the company keeps CardStatus untouched (no forced tap/return) ────

  test('resolving does not tap or wound the company members', () => {
    const s = build({ chars: [ARAGORN], companySite: GLADDEN_FIELDS, spawnInPlay: [BALROG_OF_MORIA, MONSTROSITY] });
    const cardId = handCardId(s, HAZARD_PLAYER);
    const companyId = companyIdAt(s, RESOURCE_PLAYER);
    const after = playHazardAndResolve(s, PLAYER_2, cardId, companyId);

    const chars = Object.values(after.players[RESOURCE_PLAYER].characters);
    expect(chars.every(c => c.status === CardStatus.Untapped)).toBe(true);
  });
});
