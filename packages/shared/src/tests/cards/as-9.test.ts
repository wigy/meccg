/**
 * @module as-9.test
 *
 * Card test: Dwarven Travelers (as-9)
 * Type: hazard-creature (Dwarves), non-unique.
 *
 * Card text (authoritative — data/cards.json AS-9):
 *   "Dwarves. Three strikes. Detainment against hero and covert companies.
 *    Maia hazard creatures may be keyed to Border-holds [{B}] or Ruins & Lairs
 *    [{R}] against any company that has faced Dwarven Travelers this turn."
 *
 * Base stats: strikes 3, prowess 8, no body, kill MP 1*.
 * Canonical playable cost (data/cards.json): {w}{b}{R}{B} — keyable to a
 * Wilderness or Border-land region, or at a Ruins & Lairs or Border-hold site
 * (the four symbols are alternatives).
 *
 * Effects:
 * | # | Effect Type            | Status | Notes                                                       |
 * |---|------------------------|--------|-------------------------------------------------------------|
 * | 1 | combat-detainment      | OK     | hero defenders (Fallen-wizard counts as hero, rule 2.IV.vii.F1) |
 * | 2 | grant-creature-keying  | OK     | `source: "faced-this-turn"` — Maia creatures key to {B}/{R}  |
 *
 * keyedTo:
 * | # | Entry                                       | Symbol      |
 * |---|---------------------------------------------|-------------|
 * | 1 | regionTypes wilderness/border + siteTypes    | {w}{b}{R}{B}|
 * |   | ruins-and-lairs/border-hold (alternatives)  |             |
 *
 * Playable: YES
 * Certified: 2026-07-28
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, GIMLI, FARAMIR, LEGOLAS,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH, BREE, BANDIT_LAIR,
  buildTestState, resetMint,
  makeMHState, makeWildernessMHState, makeBorderMHState,
  playCreatureHazardAndResolve, dispatch, executeAction,
  handCardId, companyIdAt, findCharInstanceId, viableActions, phaseStateAs,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType, SiteType } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, MovementHazardPhaseState,
  PlayHazardAction,
} from '../../index.js';

const DWARVEN_TRAVELERS = 'as-9' as CardDefinitionId;
/** Gandalf the White Rider — a Maia hazard creature keyed to Free-domain / Free-holds. */
const GANDALF_THE_WHITE_RIDER = 'as-11' as CardDefinitionId;
/** Durin's Folk — a Dwarf (non-Maia) creature keyed to {w}{b} only. */
const DURINS_FOLK = 'as-8' as CardDefinitionId;
/** Mionid — minion character, for the Ringwraith-defender fixture. */
const MIONID = 'as-3' as CardDefinitionId;
/** Azog — Balrog-side character, for the Balrog-defender fixture. */
const AZOG = 'ba-2' as CardDefinitionId;

const BORDER_KEYING = { method: 'region-type' as const, value: RegionType.Border };
const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };

/**
 * P1 (active, `alignment`) has one company at `site` with `characters`;
 * P2 is the hazard player holding `hazardHand`. `phaseState` selects the
 * movement/hazard picture (resolved path, destination site type, which
 * hazards the company has already faced).
 */
function readyState(opts: {
  alignment?: Alignment;
  characters?: CardDefinitionId[];
  site?: CardDefinitionId;
  hazardHand?: CardDefinitionId[];
  phaseState?: MovementHazardPhaseState;
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: opts.alignment ?? Alignment.Wizard,
        companies: [{ site: opts.site ?? MORIA, characters: opts.characters ?? [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: opts.hazardHand ?? [DWARVEN_TRAVELERS],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  return { ...state, phaseState: opts.phaseState ?? makeWildernessMHState() };
}

/** Every `keyedBy` descriptor the hazard player is offered for `instanceId`. */
function keyingsOffered(state: GameState, instanceId: CardInstanceId) {
  return viableActions(state, PLAYER_2, 'play-hazard')
    .map(ea => ea.action as PlayHazardAction)
    .filter(a => a.cardInstanceId === instanceId)
    .map(a => a.keyedBy)
    .filter((k): k is NonNullable<typeof k> => k !== undefined);
}

/** Whether `instanceId` is offered keyed via the grant (keying-bypass). */
function offeredViaKeyingBypass(state: GameState, instanceId: CardInstanceId): boolean {
  return keyingsOffered(state, instanceId).some(k => k.method === 'keying-bypass');
}

describe('Dwarven Travelers (as-9)', () => {
  beforeEach(() => resetMint());

  // ─── "Three strikes." + "Detainment against hero and covert companies." ────

  test('attack on a hero (Wizard) company: 3 strikes, prowess 8, detainment', () => {
    const ready = readyState({});
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, cardId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(8);
    expect(afterChain.combat!.detainment).toBe(true);
  });

  test('attack on a Fallen-wizard (covert) company: detainment (rule 2.IV.vii.F1)', () => {
    // A Fallen-wizard player's companies count as hero companies when
    // determining detainment, so the "hero and covert companies" clause fires.
    const ready = readyState({ alignment: Alignment.FallenWizard });
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, cardId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.detainment).toBe(true);
  });

  test('attack on a minion (Ringwraith) company: no detainment', () => {
    // Wilderness keying keeps the attack clear of the §3.II.2.R1/R2 minion
    // detainment branches, isolating the card's own hero-only clause.
    const ready = readyState({ alignment: Alignment.Ringwraith, characters: [MIONID] });
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, cardId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(8);
    expect(afterChain.combat!.detainment).toBe(false);
  });

  test('attack on a Balrog company: no detainment', () => {
    const ready = readyState({ alignment: Alignment.Balrog, characters: [AZOG] });
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, cardId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.detainment).toBe(false);
  });

  // ─── Keying: {w}{b}{R}{B} ─────────────────────────────────────────────────

  test('keyable to a Wilderness ({w})', () => {
    const ready = readyState({ phaseState: makeWildernessMHState() });
    const cardId = handCardId(ready, HAZARD_PLAYER);
    expect(keyingsOffered(ready, cardId)).toContainEqual(
      { method: 'region-type', value: RegionType.Wilderness },
    );
  });

  test('keyable to a Border-land ({b})', () => {
    const ready = readyState({ phaseState: makeBorderMHState() });
    const cardId = handCardId(ready, HAZARD_PLAYER);
    expect(keyingsOffered(ready, cardId)).toContainEqual(
      { method: 'region-type', value: RegionType.Border },
    );
  });

  test('keyable at a Ruins & Lairs ({R}) reached through a Free-domain path', () => {
    // A pure Free-domain path cannot satisfy the {w}/{b} arms, isolating {R}.
    const ready = readyState({
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Free],
        resolvedSitePathNames: ['The Shire'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Bandit Lair',
      }),
    });
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const keyings = keyingsOffered(ready, cardId);
    expect(keyings).toContainEqual({ method: 'site-type', value: SiteType.RuinsAndLairs });
    expect(keyings.some(k => k.method === 'region-type')).toBe(false);
  });

  test('keyable at a Border-hold ({B}) reached through a Free-domain path', () => {
    const ready = readyState({
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Free],
        resolvedSitePathNames: ['The Shire'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      }),
    });
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const keyings = keyingsOffered(ready, cardId);
    expect(keyings).toContainEqual({ method: 'site-type', value: SiteType.BorderHold });
    expect(keyings.some(k => k.method === 'region-type')).toBe(false);
  });

  test('not keyable through a Free-domain path to a Free-hold (none of {w}{b}{R}{B})', () => {
    const ready = readyState({
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Free],
        resolvedSitePathNames: ['The Shire'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Bag End',
      }),
    });
    const cardId = handCardId(ready, HAZARD_PLAYER);
    expect(keyingsOffered(ready, cardId)).toHaveLength(0);
  });

  // ─── "Maia hazard creatures may be keyed to {B} or {R} against any company
  //     that has faced Dwarven Travelers this turn." ────────────────────────

  test('a Maia creature is keyable at a Border-hold once the company has faced Dwarven Travelers', () => {
    const ready = readyState({
      site: BREE,
      hazardHand: [GANDALF_THE_WHITE_RIDER],
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Andrast'],
        hazardsEncountered: ['Dwarven Travelers'],
      }),
    });
    const gandalfId = handCardId(ready, HAZARD_PLAYER);
    expect(offeredViaKeyingBypass(ready, gandalfId)).toBe(true);
  });

  test('a Maia creature is keyable at a Ruins & Lairs once the company has faced Dwarven Travelers', () => {
    const ready = readyState({
      site: BANDIT_LAIR,
      hazardHand: [GANDALF_THE_WHITE_RIDER],
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Andrast'],
        hazardsEncountered: ['Dwarven Travelers'],
      }),
    });
    const gandalfId = handCardId(ready, HAZARD_PLAYER);
    expect(offeredViaKeyingBypass(ready, gandalfId)).toBe(true);
  });

  test('without having faced Dwarven Travelers, the same Maia creature is not keyed at the Border-hold', () => {
    const ready = readyState({
      site: BREE,
      hazardHand: [GANDALF_THE_WHITE_RIDER],
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Andrast'],
      }),
    });
    const gandalfId = handCardId(ready, HAZARD_PLAYER);
    expect(offeredViaKeyingBypass(ready, gandalfId)).toBe(false);
    expect(keyingsOffered(ready, gandalfId)).toHaveLength(0);
  });

  test('the grant does not extend past Border-holds and Ruins & Lairs (Shadow-hold)', () => {
    const ready = readyState({
      site: MORIA,
      hazardHand: [GANDALF_THE_WHITE_RIDER],
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Nan Curunír'],
        hazardsEncountered: ['Dwarven Travelers'],
      }),
    });
    const gandalfId = handCardId(ready, HAZARD_PLAYER);
    expect(offeredViaKeyingBypass(ready, gandalfId)).toBe(false);
  });

  test('the grant is restricted to Maia creatures — a Dwarf creature gets no keying', () => {
    // Durin's Folk is keyed {w}{b} only; the Border-hold cannot key it and the
    // grant does not apply to its race.
    const ready = readyState({
      site: BREE,
      hazardHand: [DURINS_FOLK],
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Free],
        resolvedSitePathNames: ['Lebennin'],
        hazardsEncountered: ['Dwarven Travelers'],
      }),
    });
    const durinsId = handCardId(ready, HAZARD_PLAYER);
    expect(offeredViaKeyingBypass(ready, durinsId)).toBe(false);
    expect(keyingsOffered(ready, durinsId)).toHaveLength(0);
  });

  test('end to end: after Dwarven Travelers attacks, a Maia creature keys to the Border-hold', () => {
    // A three-character company takes one strike each, so the defender can
    // assign all three and the combat runs to finalization.
    const ready = readyState({
      site: BREE,
      characters: [ARAGORN, GIMLI, FARAMIR],
      hazardHand: [DWARVEN_TRAVELERS, GANDALF_THE_WHITE_RIDER],
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Andrast'],
      }),
    });
    const dwarvenId = handCardId(ready, HAZARD_PLAYER, 0);
    const gandalfId = handCardId(ready, HAZARD_PLAYER, 1);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // Before the attack the Maia creature has no keying at Bree.
    expect(offeredViaKeyingBypass(ready, gandalfId)).toBe(false);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, dwarvenId, companyId, BORDER_KEYING,
    );
    // One strike per character, then Aragorn beats the 8-prowess detainment
    // attack — the body-less creature is defeated and the combat finalizes.
    let s = afterChain;
    for (const charDef of [ARAGORN, GIMLI, FARAMIR]) {
      s = dispatch(s, {
        type: 'assign-strike', player: PLAYER_1,
        characterId: findCharInstanceId(s, RESOURCE_PLAYER, charDef),
      });
    }
    // Defender picks the order for the first two strikes; the last is implied.
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);
    const afterCombat = executeAction(s, PLAYER_1, 'resolve-strike', 12);
    expect(afterCombat.combat).toBeNull();

    const mh = phaseStateAs<MovementHazardPhaseState>(afterCombat);
    expect(mh.hazardsEncountered).toContain('Dwarven Travelers');

    // The company has now faced Dwarven Travelers — the Maia creature keys in.
    expect(offeredViaKeyingBypass(afterCombat, gandalfId)).toBe(true);
  });
});
