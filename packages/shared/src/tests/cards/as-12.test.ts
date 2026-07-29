/**
 * @module as-12.test
 *
 * Card test: Knights of the Prince (as-12)
 * Type: hazard-creature (Dúnedain), unique.
 * Strikes: 4, Prowess: 10, Body: 8, kill MP 3 (starred).
 * Keyed to a `regionNames` entry: Anfalas, Belfalas, Lamedon, Lebennin,
 * Anórien ("or at sites in these regions" covered by the destination site's
 * own region appearing in the resolved site path — as-21 precedent).
 *
 * Card text: "Unique. Dúnedain. Four strikes. Detainment against hero
 * companies. Playable at Anfalas, Belfalas, Lamedon, Lebennin, or Anórien; or
 * at sites in these regions. Unless the attack is canceled, all untapped
 * characters in defending company are tapped following this attack."
 *
 * Rule coverage:
 *
 * | # | Rule                                          | Mechanism                                            |
 * |---|------------------------------------------------|-------------------------------------------------------|
 * | 1 | Four strikes at 10 prowess, body 8, Dúnedain   | printed stats → CombatState                           |
 * | 2 | Detainment against hero companies              | combat-detainment (`defender.alignment: hero`, which  |
 * |   |                                                  | also fires for Fallen-wizard defenders per rule       |
 * |   |                                                  | 2.IV.vii.F1 — as-13/as-14/as-16 shape)                |
 * | 3 | Keyed to the five named regions, or sites      | keyedTo regionNames                                    |
 * |   | therein                                         |                                                         |
 * | 4 | Unless canceled, all untapped characters in    | on-event `attack-not-canceled` →                       |
 * |   | the defending company tap following the attack |  `company-tap-characters` apply (td-81 precedent)      |
 *
 * Rule 4 taps the *whole* company, not just the characters that faced a
 * strike: winning strikers who stayed untapped and an untouched bystander
 * both end tapped. A wounded character is Inverted rather than Untapped, so
 * the sweep leaves it alone. Canceling the attack (Escape, tw-229) skips the
 * sweep entirely.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FARAMIR, BEREGOND,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, makeWildernessMHState,
  playCreatureHazardAndResolve, resolveChain,
  handCardId, companyIdAt, findCharInstanceId, getCharacter, dispatch,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType, CardStatus,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const KNIGHTS_OF_THE_PRINCE = 'as-12' as CardDefinitionId;
const AZOG = 'ba-2' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId;
const ESCAPE = 'tw-229' as CardDefinitionId;

const KEYED_REGIONS = [
  'Anfalas',
  'Belfalas',
  'Lamedon',
  'Lebennin',
  'Anórien',
] as const;

function mhInRegion(regionName: string): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Free],
    resolvedSitePathNames: [regionName],
    destinationSiteType: SiteType.FreeHold,
    destinationSiteName: 'Some Hold',
  });
}

/** Two-player base state; PLAYER_2 holds the Knights unless overridden. */
function baseState(opts: {
  alignment?: Alignment;
  defenders: CardDefinitionId[];
  defenderHand?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: opts.alignment ?? Alignment.Wizard,
        companies: [{ site: MORIA, characters: opts.defenders }],
        hand: opts.defenderHand ?? [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [GIMLI] }],
        hand: [KNIGHTS_OF_THE_PRINCE],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

/** Play the Knights keyed to a named region and resolve the chain into combat. */
function attackWith(state: GameState, region: string): GameState {
  const ready: GameState = { ...state, phaseState: mhInRegion(region) };
  return playCreatureHazardAndResolve(
    ready,
    PLAYER_2,
    handCardId(ready, HAZARD_PLAYER),
    companyIdAt(ready, RESOURCE_PLAYER),
    { method: 'region-name' as const, value: region },
  );
}

/**
 * Drive the assigned strikes to the end of combat with every die showing
 * `roll`: pick the strike order, resolve each strike without tapping to
 * fight (−3 prowess), and answer any body check. Returns the finalized
 * state.
 */
function runStrikesUntapped(state: GameState, roll: number): GameState {
  let s = state;
  let guard = 0;
  while (s.combat !== null && guard++ < 40) {
    const rolled: GameState = { ...s, cheatRollTotal: roll };
    const pick = [PLAYER_1, PLAYER_2]
      .flatMap(p => computeLegalActions(rolled, p))
      .find(a => a.viable && (
        (a.action.type === 'choose-strike-order' && a.action.tapped === false)
        || (a.action.type === 'resolve-strike' && a.action.tapToFight === false)
        || a.action.type === 'body-check-roll'
      ));
    expect(pick).toBeDefined();
    s = dispatch(rolled, pick!.action);
  }
  expect(s.combat).toBeNull();
  return s;
}

describe('Knights of the Prince (as-12)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: 4 strikes at 10 prowess, body 8, Dúnedain ────────────────────

  test('combat initiates with 4 strikes at 10 prowess, body 8, dunadan race', () => {
    const afterChain = attackWith(baseState({ defenders: [ARAGORN] }), 'Anórien');

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(4);
    expect(afterChain.combat!.strikeProwess).toBe(10);
    expect(afterChain.combat!.creatureBody).toBe(8);
    expect(afterChain.combat!.creatureRace).toBe('dunadan');
  });

  // ─── Rule 2: detainment depends on defender alignment ─────────────────────

  test('detainment = true against a hero (Wizard) company', () => {
    const afterChain = attackWith(baseState({ defenders: [ARAGORN] }), 'Anfalas');
    expect(afterChain.combat!.detainment).toBe(true);
  });

  test('detainment = false against a Ringwraith (minion) company', () => {
    const afterChain = attackWith(
      baseState({ alignment: Alignment.Ringwraith, defenders: [MIONID] }),
      'Belfalas',
    );
    expect(afterChain.combat!.detainment).toBe(false);
  });

  test('detainment = false against a Balrog company', () => {
    const afterChain = attackWith(
      baseState({ alignment: Alignment.Balrog, defenders: [AZOG] }),
      'Lamedon',
    );
    expect(afterChain.combat!.detainment).toBe(false);
  });

  // ─── Rule 3: keying against the five named regions ────────────────────────

  test.each(KEYED_REGIONS)('keyable when path passes through %s', (region) => {
    const state = { ...baseState({ defenders: [ARAGORN] }), phaseState: mhInRegion(region) };
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === region;
    })).toBe(true);
  });

  test('NOT keyable when path passes through none of the five regions', () => {
    const state = { ...baseState({ defenders: [ARAGORN] }), phaseState: makeWildernessMHState() };

    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(state, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  // ─── Rule 4: every untapped character taps after the attack ───────────────

  test('strikers who win untapped AND the untouched bystander all tap after the attack', () => {
    const start = baseState({ defenders: [ARAGORN, LEGOLAS, GIMLI, FARAMIR, BEREGOND] });
    const afterChain = attackWith(start, 'Anórien');
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // Defender assigns the four strikes to Aragorn, Legolas, Gimli and
    // Faramir — Beregond is the bystander who never faces a strike.
    let s = afterPass;
    for (const def of [ARAGORN, LEGOLAS, GIMLI, FARAMIR]) {
      s = dispatch(s, {
        type: 'assign-strike',
        player: PLAYER_1,
        characterId: findCharInstanceId(s, RESOURCE_PLAYER, def),
        tapped: false,
      });
    }
    expect(s.combat!.strikeAssignments).toHaveLength(4);

    // Everyone is still untapped going into strike resolution.
    for (const def of [ARAGORN, LEGOLAS, GIMLI, FARAMIR, BEREGOND]) {
      expect(getCharacter(s, RESOURCE_PLAYER, def).status).toBe(CardStatus.Untapped);
    }

    // Resolve every strike with a 12: each defender fights untapped (−3
    // prowess) and still beats the Knights' 10 prowess, so none of them is
    // wounded and none taps to fight.
    s = runStrikesUntapped(s, 12);

    // The card's rule: every untapped character in the company — the four
    // winning strikers and the untouched Beregond — is tapped following the
    // attack.
    for (const def of [ARAGORN, LEGOLAS, GIMLI, FARAMIR, BEREGOND]) {
      expect(getCharacter(s, RESOURCE_PLAYER, def).status).toBe(CardStatus.Tapped);
    }
  });

  // Against a non-hero (Ringwraith) company the attack is not detainment, so
  // a losing character is genuinely wounded (Inverted) rather than merely
  // tapped by the detainment rule — isolating the tap-sweep effect (rule 4)
  // from the detainment tap-instead-of-wound mechanic (rule 2).
  test('a wounded defender stays inverted — the sweep only taps untapped characters', () => {
    const start = baseState({ alignment: Alignment.Ringwraith, defenders: [MIONID, LUITPRAND] });
    const afterChain = attackWith(start, 'Lebennin');
    expect(afterChain.combat!.detainment).toBe(false);
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // All four strikes go to Mîonid; Luitprand never faces one.
    let s = afterPass;
    const mionidId = findCharInstanceId(s, RESOURCE_PLAYER, MIONID);
    for (let i = 0; i < 4; i++) {
      s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: mionidId, tapped: false });
    }
    expect(s.combat!.strikeAssignments).toHaveLength(1);
    expect(s.combat!.strikeAssignments[0].excessStrikes).toBe(3);

    // Low rolls: Mîonid loses every strike and is wounded; body checks at 2
    // (≤ body 8) leave him alive but inverted.
    s = runStrikesUntapped(s, 2);

    // Wounded characters are Inverted, not Untapped — the tap sweep skips them.
    expect(getCharacter(s, RESOURCE_PLAYER, MIONID).status).toBe(CardStatus.Inverted);
    // The untapped bystander is still tapped by the rule.
    expect(getCharacter(s, RESOURCE_PLAYER, LUITPRAND).status).toBe(CardStatus.Tapped);
  });

  test('a canceled attack does NOT tap the company', () => {
    const start = baseState({ defenders: [ARAGORN, LEGOLAS], defenderHand: [ESCAPE] });
    const afterChain = attackWith(start, 'Anfalas');

    // Escape cancels the attack against Aragorn (unwounded, facing the attack).
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const escapeCard = handCardId(afterChain, RESOURCE_PLAYER);
    const after = resolveChain(dispatch(afterChain, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: escapeCard, targetCharacterId: aragornId,
    }));

    expect(after.combat).toBeNull();
    // "Unless the attack is canceled" — nobody taps.
    expect(getCharacter(after, RESOURCE_PLAYER, LEGOLAS).status).toBe(CardStatus.Untapped);
  });
});
