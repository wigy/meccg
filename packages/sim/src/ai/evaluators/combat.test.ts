import { describe, test, expect } from 'vitest';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import { CardStatus } from '@meccg/shared';
import { combatEvaluator } from './combat.js';
import type { AiContext } from '../strategy.js';

// Dodge (tw-209): waives the tap penalty for one strike, but if the
// character is wounded by that strike, its body is modified -1 for the
// resulting body check.
const DODGE: CardDefinition = {
  cardType: 'hero-resource-event',
  id: 'tw-209',
  name: 'Dodge',
  eventType: 'short',
  effects: [{ type: 'strike-modifier', dodge: true, bodyPenalty: -1 }],
} as unknown as CardDefinition;

// Risky Blow (dm-...): a default-mode strike-modifier event with a prowess
// bonus and its own body penalty — not a dodge card, so it's unaffected by
// the already-wounded discount.
const RISKY_BLOW: CardDefinition = {
  cardType: 'hero-resource-event',
  id: 'dm-9999',
  name: 'Risky Blow',
  eventType: 'short',
  effects: [{ type: 'strike-modifier', prowessBonus: 3, bodyPenalty: -1 }],
} as unknown as CardDefinition;

const POOL: Record<string, CardDefinition> = {
  'tw-209': DODGE,
  'dm-9999': RISKY_BLOW,
};

function playStrikeEvent(cardInstanceId: string, need: number): GameAction {
  return {
    type: 'play-strike-event',
    player: 'p2',
    cardInstanceId,
    need,
    explanation: '',
  } as unknown as GameAction;
}

function makeContext(struckStatus: CardStatus, handDefIds: readonly string[]): AiContext {
  const view = {
    self: {
      hand: handDefIds.map((definitionId, i) => ({ instanceId: `h${i}`, definitionId })),
      companies: [],
      characters: {
        'p2-107': {
          instanceId: 'p2-107',
          status: struckStatus,
          effectiveStats: { prowess: 5, body: 8, directInfluence: 0, corruptionPoints: 0 },
        },
      },
    },
    opponent: { companies: [], characters: {} },
    combat: {
      strikeAssignments: [{ characterId: 'p2-107', excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
    },
  } as unknown as PlayerView;
  return { view, cardPool: POOL, legalActions: [] };
}

describe('combatEvaluator play-strike-event', () => {
  // Bug report: AI-Heuristic played Dodge on Gildor Inglorion while he was
  // already wounded (inverted). Dodge's only upside — skipping the tap
  // penalty — is moot for an already-wounded character (the wounded penalty
  // is already worse than tapped), while its -1 body penalty still applies
  // to the body check if the strike wounds (re-wounds) him again, making the
  // play strictly harmful.
  test('scores Dodge at zero on an already-wounded character', () => {
    const context = makeContext(CardStatus.Inverted, ['tw-209']);
    expect(combatEvaluator.score(playStrikeEvent('h0', 9), context)).toBe(0);
  });

  test('scores Dodge above zero on an untapped, unwounded character', () => {
    const context = makeContext(CardStatus.Untapped, ['tw-209']);
    expect(combatEvaluator.score(playStrikeEvent('h0', 9), context)!).toBeGreaterThan(0);
  });

  // Bug report: AI-Heuristic played Dodge on Théoden for a strike after an
  // earlier strike against the same character (from a multi-strike attack)
  // was already cancelled by tapping him. Dodge's only upside — skipping the
  // tap penalty — is moot on an already-tapped character, while its -1 body
  // penalty still applies if the strike wounds him, making the play strictly
  // harmful, same as the already-wounded case above.
  test('scores Dodge at zero on an already-tapped character', () => {
    const context = makeContext(CardStatus.Tapped, ['tw-209']);
    expect(combatEvaluator.score(playStrikeEvent('h0', 8), context)).toBe(0);
  });

  test('does not discount a non-dodge strike-modifier event on a wounded character', () => {
    const context = makeContext(CardStatus.Inverted, ['dm-9999']);
    expect(combatEvaluator.score(playStrikeEvent('h0', 6), context)!).toBeGreaterThan(0);
  });
});

describe('combatEvaluator convert-creature-to-ally', () => {
  // Bug report: AI-Heuristic ("Ready to His Will was not playable on
  // Orc-Lieutenant (not enhanced) with 1@7") had le-220 in hand and the
  // action was legal, but it fought the creature instead of converting it.
  // Root cause was routing, not scoring: `convert-creature-to-ally` was
  // missing from `COMBAT_ACTION_TYPES` in heuristic.ts, so the dispatcher
  // sent it to the movement-hazard evaluator, which doesn't score it either,
  // leaving it at the flat default weight of 1 — far below assign-strike's
  // prowess-based score.
  const convertAction = {
    type: 'convert-creature-to-ally',
    player: 'p1',
    cardInstanceId: 'h0',
    controllingCharacterId: 'p1-98',
    explanation: '',
  } as unknown as GameAction;

  const assignStrikeAction = {
    type: 'assign-strike',
    player: 'p1',
    characterId: 'p1-98',
    tapped: false,
    explanation: '',
  } as unknown as GameAction;

  function makeConvertContext(): AiContext {
    const view = {
      self: {
        hand: [{ instanceId: 'h0', definitionId: 'le-220' }],
        characters: {
          'p1-98': {
            instanceId: 'p1-98',
            status: CardStatus.Untapped,
            effectiveStats: { prowess: 7, body: 8, directInfluence: 0, corruptionPoints: 0 },
          },
        },
      },
      opponent: { companies: [], characters: {} },
      combat: {
        strikeAssignments: [],
        currentStrikeIndex: 0,
      },
    } as unknown as PlayerView;
    return { view, cardPool: POOL, legalActions: [] };
  }

  test('scores convert-creature-to-ally above assign-strike, so the AI takes the free ally over fighting', () => {
    const context = makeConvertContext();
    const convertScore = combatEvaluator.score(convertAction, context)!;
    const assignScore = combatEvaluator.score(assignStrikeAction, context)!;
    expect(convertScore).toBeGreaterThan(assignScore);
  });
});

describe('combatEvaluator resolve-strike', () => {
  // Bug report: AI-Heuristic (auto-attack at a site) chose to stay untapped
  // (tapToFight: false) for every character in a 3-member company, even
  // after an earlier teammate had already resolved its strike and stayed
  // untapped. Staying untapped applies a -3 prowess penalty (CoE 3.iv.3),
  // so risking it for a second or third character is pure unnecessary
  // danger once the company already has one untapped member — one of the
  // characters (Saruman) died to the resulting body check as a result.
  function makeCompanyContext(companionStatus: 'success-untapped' | 'wounded-tapped'): AiContext {
    const companionResult = companionStatus === 'success-untapped' ? 'success' : 'wounded';
    const companionCharStatus = companionStatus === 'success-untapped' ? CardStatus.Untapped : CardStatus.Inverted;
    const view = {
      self: {
        hand: [],
        companies: [{ id: 'company-p2-0', characters: ['p2-2', 'p2-108', 'p2-104'] }],
        characters: {
          'p2-2': {
            instanceId: 'p2-2',
            status: companionCharStatus,
            effectiveStats: { prowess: 3, body: 9, directInfluence: 0, corruptionPoints: 0 },
          },
          'p2-104': {
            instanceId: 'p2-104',
            status: CardStatus.Untapped,
            effectiveStats: { prowess: 1, body: 6, directInfluence: 0, corruptionPoints: 0 },
          },
        },
      },
      opponent: { companies: [], characters: {} },
      combat: {
        strikeAssignments: [
          { characterId: 'p2-2', excessStrikes: 0, resolved: true, result: companionResult },
          { characterId: 'p2-104', excessStrikes: 0, resolved: false },
        ],
        currentStrikeIndex: 1,
      },
    } as unknown as PlayerView;
    return { view, cardPool: POOL, legalActions: [] };
  }

  const tapToFight = (need: number): GameAction =>
    ({ type: 'resolve-strike', player: 'p2', tapToFight: true, need, explanation: '' } as unknown as GameAction);
  const stayUntapped = (need: number): GameAction =>
    ({ type: 'resolve-strike', player: 'p2', tapToFight: false, need, explanation: '' } as unknown as GameAction);

  test('prefers tapping once a teammate already resolved untapped', () => {
    const context = makeCompanyContext('success-untapped');
    const tapScore = combatEvaluator.score(tapToFight(7), context)!;
    const untapScore = combatEvaluator.score(stayUntapped(4), context)!;
    expect(tapScore).toBeGreaterThan(untapScore);
  });

  test('falls back to need-based scoring when no teammate stayed untapped', () => {
    const context = makeCompanyContext('wounded-tapped');
    const tapScore = combatEvaluator.score(tapToFight(7), context)!;
    const untapScore = combatEvaluator.score(stayUntapped(4), context)!;
    expect(untapScore).toBeGreaterThan(tapScore);
  });
});

describe('combatEvaluator tap-item-for-strike', () => {
  // Bug report: AI-Heuristic did not tap Shield of Iron-bound Ash (tw-327)
  // to gain +1 prowess on the last strike of the attack, even though doing
  // so improved the roll need from 7+ (untapped) to 3+ and cost nothing.
  // `tap-item-for-strike` was scored by diceSuccessPct(need), which should
  // outscore the alternative `resolve-strike` (untapped) action once the
  // item's boost is applied.
  const tapItemAction = {
    type: 'tap-item-for-strike',
    player: 'p2',
    cardInstanceId: 'p2-103',
    characterInstanceId: 'p2-107',
    need: 3,
    explanation: '',
  } as unknown as GameAction;

  const resolveStrikeUntapped = {
    type: 'resolve-strike',
    player: 'p2',
    tapToFight: false,
    need: 7,
    explanation: '',
  } as unknown as GameAction;

  test('scores tap-item-for-strike above the resolve-strike alternative it improves on', () => {
    const context = makeContext(CardStatus.Untapped, []);
    const tapItemScore = combatEvaluator.score(tapItemAction, context)!;
    const resolveScore = combatEvaluator.score(resolveStrikeUntapped, context)!;
    expect(tapItemScore).toBeGreaterThan(resolveScore);
  });
});
