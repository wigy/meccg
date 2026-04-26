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

import type { GameAction } from '@meccg/shared';
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
} from './common.js';

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
        let hasPlayable = false;
        for (const card of view.self.hand) {
          const def = lookupDef(pool, card.definitionId);
          if (def && resourcePlayableAt(def, siteDef)) {
            hasPlayable = true;
            break;
          }
        }
        if (!hasPlayable) return 0;
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
