/**
 * @module ai/evaluators/site-phase
 *
 * Heuristic scoring for the Site phase: entering sites, playing resources
 * (items, factions, allies, events), making influence attempts on factions,
 * playing minor items, and revealing on-guard cards.
 *
 * Resources are scored by marshalling-point value with adjustments for
 * prowess gain (items) and corruption risk. Faction influence attempts
 * favor situations with a comfortable success probability.
 */

import type { GameAction, Company, PlayerView } from '@meccg/shared';
import type { ActionEvaluator } from './types.js';
import type { AiContext } from '../strategy.js';
import {
  lookupDef,
  mpValue,
  isItem,
  isFaction,
  isAlly,
  isSite,
  diceSuccessPct,
  resourcePlayableAt,
  hasUntappedCharacter,
  hasUntapSource,
  handHasNoTapPlayableAt,
  type AnySiteCard,
} from './common.js';

/**
 * Whether a site's automatic attacks make tapping the defender the only
 * sensible choice, even for the company's strongest character — i.e. that
 * character's need to stay untapped is "hard" (>= 8, the same threshold
 * `combatEvaluator`'s `resolve-strike` scoring uses to prefer tapping over
 * staying untapped — `packages/sim/src/ai/evaluators/combat.ts`). Mirrors the
 * reducer's strike-need arithmetic (`need = attackerProwess - defenderProwess
 * + 1`, with an extra 3-point penalty for staying untapped —
 * `packages/shared/src/engine/legal-actions/combat.ts`), using the company's
 * best available prowess, since the defender can always choose to send their
 * strongest character.
 */
function automaticAttackForcesTap(
  view: PlayerView,
  company: Company,
  siteDef: AnySiteCard,
): boolean {
  const attacks = siteDef.automaticAttacks ?? [];
  if (attacks.length === 0) return false;
  let bestProwess = 0;
  for (const id of company.characters) {
    const ch = view.self.characters[id];
    if (ch) bestProwess = Math.max(bestProwess, ch.effectiveStats.prowess);
  }
  const bestUntappedProwess = bestProwess - 3;
  return attacks.some(atk => atk.prowess - bestUntappedProwess + 1 >= 8);
}

export const sitePhaseEvaluator: ActionEvaluator = {
  phases: ['site'],

  score(action: GameAction, context: AiContext): number | null {
    const view = context.view;
    const pool = context.cardPool;

    switch (action.type) {
      case 'enter-site': {
        // Don't enter a site where nothing in hand is playable — entering
        // only exposes the company to on-guard attacks without any payoff.
        const company = view.self.companies.find(c => c.id === action.companyId);
        if (!company?.currentSite) return 50;
        const siteDef = lookupDef(pool, company.currentSite.definitionId);
        if (!isSite(siteDef)) return 50;
        let bestPlayableMp = -1;
        for (const card of view.self.hand) {
          const def = lookupDef(pool, card.definitionId);
          if (def && resourcePlayableAt(def, siteDef)) {
            bestPlayableMp = Math.max(bestPlayableMp, mpValue(def));
          }
        }
        if (bestPlayableMp < 0) return 0;
        // Items, factions, and allies all require tapping a character on
        // play. If every character in the company is tapped and the
        // company has no untap source (item / spell), the only MP plays
        // that work are ones that don't need a tap — currently permanent
        // resource events (e.g. "information"-typed ritual events).
        // Otherwise entering just exposes the company to on-guard
        // attacks without a payoff.
        if (!hasUntappedCharacter(view, company)
            && !hasUntapSource(view, pool, company)
            && !handHasNoTapPlayableAt(view, pool, siteDef)) {
          return 0;
        }
        // Automatic attacks resolve before any resource can be played. If
        // even the company's strongest character would rather tap than risk
        // staying untapped against them, entering costs a tapped defender
        // (plus a real chance of a wound) for the sake of one low-value
        // item — not a good trade. (Bug report: the AI entered Glittering
        // Caves with Théoden/Balin/Fatty Bolger/Ioreth against a 9-prowess
        // automatic-attack; Fatty Bolger was assigned to defend and ended up
        // wounded, and the 1-MP item it entered for was never even played.)
        if (bestPlayableMp <= 1 && automaticAttackForcesTap(view, company, siteDef)) {
          return 0;
        }
        return 50;
      }

      case 'play-hero-resource': {
        const card = view.self.hand.find(c => c.instanceId === action.cardInstanceId);
        if (!card) return 1;
        const def = lookupDef(pool, card.definitionId);
        if (!def) return 1;

        const baseMP = mpValue(def);
        let score = baseMP * 10;

        if (isItem(def)) {
          score += def.prowessModifier * 2 - def.corruptionPoints * 3;
        } else if (isFaction(def)) {
          // Factions are scored separately via faction-influence-roll, but
          // playing the card to start the chain is high value.
          score += 5;
        } else if (isAlly(def)) {
          score += 5;
        }
        return Math.max(1, score);
      }

      case 'play-minor-item': {
        const card = view.self.hand.find(c => c.instanceId === action.cardInstanceId);
        if (!card) return 1;
        const def = lookupDef(pool, card.definitionId);
        if (!def || !isItem(def)) return 5;
        return Math.max(1, mpValue(def) * 5 + def.prowessModifier);
      }

      case 'influence-attempt':
      case 'faction-influence-roll': {
        // Favor influence rolls with comfortable need.
        return Math.max(1, diceSuccessPct(action.need) / 5);
      }

      case 'opponent-influence-attempt':
        return 6;

      case 'opponent-influence-defend':
        return 100;

      case 'reveal-on-guard':
        return 20;

      case 'declare-agent-attack':
        return 8;

      case 'place-on-guard':
        return 4;

      case 'pass':
        return 1;

      default:
        return null;
    }
  },
};
