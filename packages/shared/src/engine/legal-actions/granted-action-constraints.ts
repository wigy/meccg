/**
 * @module legal-actions/granted-action-constraints
 *
 * Emits `activate-granted-action` actions for every active
 * `granted-action` constraint in the given phase/window. The per-card
 * `grant-action` effects produce their actions through
 * {@link grantedActionActivations}; this module handles the parallel
 * path for actions granted *by a constraint* — Great Ship's
 * cancel-chain-entry, River's cancel-constraint, and any future card
 * whose effect is "while this constraint is in play, the bearer
 * company may tap a qualifying character to do X".
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  Company,
  ActiveConstraint,
  CardInstanceId,
} from '../../index.js';
import { cardStatusToName } from '../../types/common.js';
import { matchesCondition } from '../../effects/condition-matcher.js';
import { logDetail } from './log.js';
import { isCharacterCard } from '../../types/cards.js';
import { canPayCost } from '../cost-evaluator.js';
import { cardName, playerById, defById } from '../reducer-utils.js';
import { getEffectiveNaturalSkills } from '../effects/index.js';

/**
 * Iterate every active `granted-action` constraint whose `phase` /
 * `window` match the given keys and which targets `company`. For each
 * qualifying constraint, evaluate the `when` condition per
 * untapped character in the company against a context containing
 * `actor` plus the caller-supplied `contextExtras`. Emit one
 * `activate-granted-action` per eligible (character, constraint) pair.
 */
export function emitGrantedActionConstraintActions(
  state: GameState,
  playerId: PlayerId,
  company: Company,
  phaseKey: string,
  windowKey: string | undefined,
  contextExtras: Record<string, unknown>,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];

  const matchingConstraints: ActiveConstraint[] = state.activeConstraints.filter(c => {
    if (c.kind.type !== 'granted-action') return false;
    // A constraint's phase gates where it fires. When absent, it's
    // eligible in any phase the emitter is invoked from (River).
    if (c.kind.phase !== undefined && c.kind.phase !== phaseKey) return false;
    if (windowKey !== undefined && c.kind.window !== undefined && c.kind.window !== windowKey) return false;
    if (c.target.kind !== 'company' || c.target.companyId !== company.id) return false;
    return true;
  });

  if (matchingConstraints.length === 0) return actions;

  const player = playerById(state, playerId);
  if (!player) return actions;

  for (const constraint of matchingConstraints) {
    if (constraint.kind.type !== 'granted-action') continue;
    const kind = constraint.kind;
    const sourceName = cardName(state, constraint.sourceDefinitionId, '?');

    for (const charInstId of company.characters) {
      const charId: CardInstanceId = charInstId;
      const char = player.characters[charId];
      if (!char) continue;

      if (!canPayCost(kind.cost, char)) continue;

      const charDef = defById(state, char.definitionId);
      const actorContext: Record<string, unknown> = {
        status: cardStatusToName(char.status),
        name: charDef && isCharacterCard(charDef) ? charDef.name : '',
        race: charDef && isCharacterCard(charDef) ? charDef.race : '',
        skills: getEffectiveNaturalSkills(state, char, charDef && isCharacterCard(charDef) ? charDef : undefined),
      };

      const ctx: Record<string, unknown> = {
        actor: actorContext,
        ...contextExtras,
      };

      if (kind.when && !matchesCondition(kind.when, ctx)) {
        logDetail(`granted-action "${kind.action}" on ${sourceName}: when condition failed for ${charDef?.name ?? '?'}`);
        continue;
      }

      logDetail(`granted-action "${kind.action}" available: ${charDef?.name ?? '?'} (source: ${sourceName})`);
      actions.push({
        action: {
          type: 'activate-granted-action',
          player: playerId,
          characterId: charId,
          sourceCardId: constraint.source,
          sourceCardDefinitionId: constraint.sourceDefinitionId,
          actionId: kind.action,
          rollThreshold: 0,
        },
        viable: true,
      });
    }
  }

  return actions;
}
