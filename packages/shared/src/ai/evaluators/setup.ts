/**
 * @module ai/evaluators/setup
 *
 * Heuristic scoring for the pre-game Setup phase: character draft,
 * starting item assignment, character-deck draft, starting site selection,
 * character placement, deck shuffle, and initiative roll.
 *
 * Scoring favors strong characters early (high MP + prowess + DI), weapons
 * on the strongest characters, havens for the starting site, and grouping
 * the avatar with the strongest companions when there are two companies.
 */

import type { GameAction } from '../../types/actions.js';
import type {
  CardDefinition,
  HeroSiteCard,
  MinionSiteCard,
  FallenWizardSiteCard,
  BalrogSiteCard,
  CharacterCard,
} from '../../types/cards.js';
import type { ActionEvaluator } from './types.js';
import type { AiContext } from '../strategy.js';
import { lookupDef, isCharacter, isItem } from './common.js';

type AnySite = HeroSiteCard | MinionSiteCard | FallenWizardSiteCard | BalrogSiteCard;

/** Compute a draft-priority score for a character. */
function characterDraftScore(def: CharacterCard): number {
  const isAvatar = def.mind === null;
  const base = def.marshallingPoints * 3 + def.prowess + def.body + def.directInfluence * 2;
  return base + (isAvatar ? 50 : 0);
}

/** Whether a site is a haven (most useful starting site). */
function isHaven(def: CardDefinition): def is AnySite {
  if (def.cardType !== 'hero-site' && def.cardType !== 'minion-site' && def.cardType !== 'fallen-wizard-site' && def.cardType !== 'balrog-site') {
    return false;
  }
  return (def as AnySite).siteType === 'haven';
}

export const setupEvaluator: ActionEvaluator = {
  phases: ['setup'],

  score(action: GameAction, context: AiContext): number | null {
    const pool = context.cardPool;

    switch (action.type) {
      case 'draft-pick': {
        const view = context.view;
        const phaseState = view.phaseState;
        if (phaseState.phase !== 'setup' || phaseState.setupStep.step !== 'character-draft') return 1;
        const draftState = phaseState.setupStep.draftState[view.selfIndex];
        const card = draftState.pool.find(c => c.instanceId === action.characterInstanceId);
        if (!card) return 1;
        const def = lookupDef(pool, card.definitionId);
        if (!isCharacter(def)) return 1;
        return Math.max(1, characterDraftScore(def));
      }

      case 'draft-stop': {
        // Stop drafting once we have at least 4 characters with one avatar
        const view = context.view;
        const phaseState = view.phaseState;
        if (phaseState.phase !== 'setup' || phaseState.setupStep.step !== 'character-draft') return 1;
        const draftState = phaseState.setupStep.draftState[view.selfIndex];
        const drafted = draftState.drafted;
        const hasAvatar = drafted.some(c => {
          const def = lookupDef(pool, c.definitionId);
          return isCharacter(def) && def.mind === null;
        });
        if (drafted.length >= 6 && hasAvatar) return 5;
        if (drafted.length >= 4 && hasAvatar) return 1;
        return 0;
      }

      case 'assign-starting-item': {
        // Prefer giving items to the highest-prowess character.
        const view = context.view;
        const target = view.self.characters[action.characterInstanceId];
        if (!target) return 1;
        const def = lookupDef(pool, action.itemDefId);
        if (!isItem(def)) return 1;
        // Score: prowess of target + small bonus for matching weapon to high prowess.
        return Math.max(1, target.effectiveStats.prowess + def.prowessModifier);
      }

      case 'add-character-to-deck': {
        // Score remaining pool characters the same way as draft picks.
        const view = context.view;
        const phaseState = view.phaseState;
        if (phaseState.phase !== 'setup' || phaseState.setupStep.step !== 'character-deck-draft') return 1;
        const deckDraft = phaseState.setupStep.deckDraftState[view.selfIndex];
        const card = deckDraft.remainingPool.find(c => c.instanceId === action.characterInstanceId);
        if (!card) return 1;
        const def = lookupDef(pool, card.definitionId);
        if (!isCharacter(def)) return 1;
        return Math.max(1, characterDraftScore(def));
      }

      case 'select-starting-site': {
        // Strongly prefer havens for the starting site.
        const view = context.view;
        const card = view.self.siteDeck.find(c => c.instanceId === action.siteInstanceId);
        if (!card) return 1;
        const def = lookupDef(pool, card.definitionId);
        if (!def) return 1;
        return isHaven(def) ? 100 : 5;
      }

      case 'place-character': {
        // Place avatars and high-MP characters into the first company.
        const view = context.view;
        const char = view.self.characters[action.characterInstanceId];
        if (!char) return 1;
        const def = lookupDef(pool, char.definitionId);
        if (!isCharacter(def)) return 1;
        // Higher score for high-mind chars (avatars + heavy hitters).
        return Math.max(1, def.prowess + (def.mind ?? 0) + def.marshallingPoints);
      }

      case 'shuffle-play-deck':
      case 'roll-initiative':
        return 100;

      default:
        return null;
    }
  },
};
