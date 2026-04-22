/**
 * @module legal-actions/combat
 *
 * Legal actions during combat. Combat is a self-contained sub-state machine
 * that interrupts the enclosing phase. When `state.combat` is non-null,
 * combat actions take priority over normal phase actions.
 *
 * Combat proceeds through four sub-phases:
 * 1. assign-strikes: defending player assigns strikes to characters, then attacker assigns remaining
 * 2. choose-strike-order: defending player picks which unresolved strike resolves next
 * 3. resolve-strike: defending player resolves the chosen strike (tap-to-fight or stay untapped)
 * 4. body-check: attacking player rolls body check
 */

import type { GameState, PlayerId, EvaluatedAction, CombatState, CardInstanceId } from '../../index.js';
import type { CancelAttackEffect, DodgeStrikeEffect, HalveStrikesEffect, ModifyAttackEffect, ModifyAttackFromHandEffect, ModifyStrikeEffect, RerollStrikeEffect, PlayConditionEffect, PlayWindowEffect, PlayTargetEffect } from '../../types/effects.js';
import type { AllyInPlay } from '../../types/state-cards.js';
import type { PlayerState } from '../../types/state-player.js';
import { CardStatus, isCharacterCard, isAllyCard, isSiteCard, matchesCondition, SiteType } from '../../index.js';
import { logHeading, logDetail } from './log.js';
import { computeCombatProwess } from '../recompute-derived.js';

/**
 * Find all allies in a company by iterating over each character's allies array.
 * Returns tuples of [allyInPlay, hostCharacterId] for combat targeting.
 */
function findCompanyAllies(
  player: PlayerState,
  companyCharacters: readonly CardInstanceId[],
): Array<{ ally: AllyInPlay; hostCharId: CardInstanceId }> {
  const result: Array<{ ally: AllyInPlay; hostCharId: CardInstanceId }> = [];
  for (const charId of companyCharacters) {
    const charData = player.characters[charId as string];
    if (!charData) continue;
    for (const ally of charData.allies) {
      result.push({ ally, hostCharId: charId });
    }
  }
  return result;
}

/**
 * Check whether a given instance ID belongs to an ally in the defending company.
 * Returns the ally data if found, or undefined.
 */
export function findAllyInCompany(
  player: PlayerState,
  companyCharacters: readonly CardInstanceId[],
  allyInstanceId: CardInstanceId,
): { ally: AllyInPlay; hostCharId: CardInstanceId } | undefined {
  for (const charId of companyCharacters) {
    const charData = player.characters[charId as string];
    if (!charData) continue;
    for (const ally of charData.allies) {
      if (ally.instanceId === allyInstanceId) {
        return { ally, hostCharId: charId };
      }
    }
  }
  return undefined;
}

/**
 * Compute legal actions for the current combat sub-phase.
 * Only returns actions for the player whose turn it is to act.
 */
export function combatActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const combat = state.combat;
  if (!combat) return [];

  logHeading(`Combat actions (phase: ${combat.phase}, assignment: ${combat.assignmentPhase})`);

  // Cancel-attack, halve-strikes, and modify-attack actions are available to
  // the defending player before any strikes have been assigned (pre-assignment
  // window). Modify-attack-from-hand supports either side per the card
  // declaration (e.g. hazard-side Dragon's Desolation Mode A).
  const cancelActions = cancelAttackActions(state, playerId, combat);
  const halveActions = halveStrikesActions(state, playerId, combat);
  const modifyActions = modifyAttackActions(state, playerId, combat);
  const modifyFromHandActions = modifyAttackFromHandActions(state, playerId, combat);

  switch (combat.phase) {
    case 'assign-strikes':
      if (combat.assignmentPhase === 'cancel-by-tap') {
        return cancelByTapActions(state, playerId, combat);
      }
      // Cancel-window: defender's pre-assignment window to cancel the attack
      // before the attacker assigns strikes (attacker-chooses-defenders).
      // Only the defending player may act: cancel-attack, halve-strikes,
      // modify-attack, or pass.
      if (combat.assignmentPhase === 'cancel-window') {
        if (playerId !== combat.defendingPlayerId) return [];
        return [
          ...cancelActions,
          ...halveActions,
          ...modifyActions,
          ...modifyFromHandActions,
          { action: { type: 'pass' as const, player: playerId }, viable: true },
        ];
      }
      return [...cancelActions, ...halveActions, ...modifyActions, ...modifyFromHandActions, ...assignStrikeActions(state, playerId, combat)];
    case 'choose-strike-order':
      return chooseStrikeOrderActions(state, playerId, combat);
    case 'resolve-strike':
      return [
        ...resolveStrikeActions(state, playerId, combat),
        ...combatHazardPermanentPlays(state, playerId, combat),
      ];
    case 'body-check':
      return bodyCheckActions(state, playerId, combat);
    case 'item-salvage':
      return itemSalvageActions(state, playerId, combat);
    default:
      return [];
  }
}

/**
 * Actions during the assign-strikes sub-phase.
 *
 * The defending player assigns strikes to untapped characters first.
 * When they pass, the attacking player assigns remaining strikes to
 * any unassigned characters.
 */
function assignStrikeActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];

  if (combat.assignmentPhase === 'defender' && playerId === combat.defendingPlayerId) {
    // Find characters in the defending company
    const playerIndex = state.players.findIndex(p => p.id === playerId);
    const player = state.players[playerIndex];
    const company = player.companies.find(c => c.id === combat.companyId);
    if (!company) return [];

    const assignedCharIds = new Set(combat.strikeAssignments.map(a => a.characterId as string));
    const strikesRemaining = combat.strikesTotal - combat.strikeAssignments.length;

    if (strikesRemaining <= 0) return [];

    // Offer untapped characters that don't already have a strike
    for (const charId of company.characters) {
      if (assignedCharIds.has(charId as string)) continue;
      const charData = player.characters[charId as string];
      if (!charData) continue;
      if (charData.status !== CardStatus.Untapped) {
        logDetail(`Character ${charId as string} is ${charData.status} — not available for defender assignment`);
        continue;
      }
      logDetail(`Defender can assign strike to ${charId as string} (untapped)`);
      actions.push({
        action: { type: 'assign-strike', player: playerId, characterId: charId, tapped: false },
        viable: true,
      });
    }

    // Per CoE rule 2.V.2.2: Allies are treated as characters for combat purposes
    // (facing strikes, tapping in support, etc.). Offer untapped allies as strike targets.
    for (const { ally } of findCompanyAllies(player, company.characters)) {
      if (assignedCharIds.has(ally.instanceId as string)) continue;
      if (ally.status !== CardStatus.Untapped) {
        logDetail(`Ally ${ally.instanceId as string} is ${ally.status} — not available for defender assignment`);
        continue;
      }
      logDetail(`Defender can assign strike to ally ${ally.instanceId as string} (untapped)`);
      actions.push({
        action: { type: 'assign-strike', player: playerId, characterId: ally.instanceId, tapped: false },
        viable: true,
      });
    }

    // Defender can always pass to let attacker assign remaining
    logDetail(`Defender can pass (${strikesRemaining} strike(s) remaining)`);
    actions.push({
      action: { type: 'pass', player: playerId },
      viable: true,
    });

    return actions;
  }

  if (combat.assignmentPhase === 'attacker' && playerId === combat.attackingPlayerId) {
    // Attacker assigns remaining strikes to unassigned characters or as excess
    const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
    const defPlayer = state.players[defPlayerIndex];
    const company = defPlayer.companies.find(c => c.id === combat.companyId);
    if (!company) return [];

    const assignedCharIds = new Set(combat.strikeAssignments.map(a => a.characterId as string));
    const totalAllocated = combat.strikeAssignments.length
      + combat.strikeAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);
    const strikesRemaining = combat.strikesTotal - totalAllocated;

    if (strikesRemaining <= 0) return [];

    // Collect all combatants: characters + allies (CoE rule 2.V.2.2)
    const allCombatantIds: Array<{ id: CardInstanceId; tapped: boolean }> = [];
    for (const charId of company.characters) {
      const charData = defPlayer.characters[charId as string];
      allCombatantIds.push({ id: charId, tapped: charData?.status !== CardStatus.Untapped });
    }
    for (const { ally } of findCompanyAllies(defPlayer, company.characters)) {
      allCombatantIds.push({ id: ally.instanceId, tapped: ally.status !== CardStatus.Untapped });
    }

    const unassigned = allCombatantIds.filter(c => !assignedCharIds.has(c.id as string));

    if (unassigned.length > 0) {
      // Still unassigned combatants — must assign to them first
      for (const { id, tapped } of unassigned) {
        logDetail(`Attacker can assign strike to unassigned ${id as string} (${tapped ? 'tapped' : 'untapped'})`);
        actions.push({
          action: { type: 'assign-strike', player: playerId, characterId: id, tapped },
          viable: true,
        });
      }
    } else {
      // All combatants have a strike — distribute excess as -1 prowess
      for (const { id, tapped } of allCombatantIds) {
        logDetail(`Attacker can assign excess strike to ${id as string} (${tapped ? 'tapped' : 'untapped'})`);
        actions.push({
          action: { type: 'assign-strike', player: playerId, characterId: id, excess: true, tapped },
          viable: true,
        });
      }
    }

    return actions;
  }

  return [];
}

/**
 * Actions during the choose-strike-order sub-phase.
 *
 * The defending player picks which unresolved strike to resolve next.
 * Per CRF: "In an order chosen by the defending player, each assigned
 * strike is then resolved by proceeding through an individual strike sequence."
 */
function chooseStrikeOrderActions(state: GameState, playerId: PlayerId, combat: CombatState): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];

  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const company = defPlayer.companies.find(c => c.id === combat.companyId);

  const actions: EvaluatedAction[] = [];
  for (let i = 0; i < combat.strikeAssignments.length; i++) {
    const sa = combat.strikeAssignments[i];
    if (sa.resolved) continue;
    // Target may be a character or ally (CoE rule 2.V.2.2)
    const charData = defPlayer.characters[sa.characterId as string];
    const allyMatch = !charData && company
      ? findAllyInCompany(defPlayer, company.characters, sa.characterId)
      : undefined;
    const targetStatus = charData?.status ?? allyMatch?.ally.status ?? CardStatus.Untapped;
    const isTapped = targetStatus !== CardStatus.Untapped;
    logDetail(`Defender can choose to resolve strike ${i} (combatant ${sa.characterId as string}, ${isTapped ? 'tapped' : 'untapped'})`);
    actions.push({
      action: { type: 'choose-strike-order', player: playerId, strikeIndex: i, characterId: sa.characterId, tapped: isTapped },
      viable: true,
    });
  }
  return actions;
}

/**
 * Actions during the resolve-strike sub-phase.
 *
 * The defending player chooses to tap-to-fight (normal) or stay untapped
 * (-3 prowess penalty). They may also have untapped characters support
 * the current strike (+1 prowess each).
 */
function resolveStrikeActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];

  const actions: EvaluatedAction[] = [];
  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!currentStrike || currentStrike.resolved) return [];

  // Resolve-strike: tap to fight (normal) or stay untapped (-3 prowess)
  // The -3 option is only available if the combatant is currently untapped
  const playerIndex0 = state.players.findIndex(p => p.id === playerId);
  const player0 = state.players[playerIndex0];
  const charData = player0.characters[currentStrike.characterId as string];
  const company0 = player0.companies.find(c => c.id === combat.companyId);

  // The strike target may be a character or an ally (CoE rule 2.V.2.2)
  const allyMatch = !charData && company0
    ? findAllyInCompany(player0, company0.characters, currentStrike.characterId)
    : undefined;
  const targetStatus = charData?.status ?? allyMatch?.ally.status ?? CardStatus.Untapped;
  const targetDefId = charData?.definitionId ?? allyMatch?.ally.definitionId;
  const isUntapped = targetStatus === CardStatus.Untapped;

  // Compute prowess and need for both tap/untap options
  // Must match the reducer's prowess calculation: base effective prowess,
  // then -1 if tapped, -2 if wounded, -N for excess strikes (CoE 3.iv.7.3)
  const charDef = state.cardPool[targetDefId as string];
  const charName = charDef && 'name' in charDef ? (charDef as { name: string }).name : (currentStrike.characterId as string);
  // Recompute prowess with combat context when creature race is known,
  // so combat-conditional weapon effects (e.g. Glamdring vs Orcs) apply.
  let baseProwess: number;
  if (allyMatch) {
    // Allies use prowess from card definition directly
    baseProwess = isAllyCard(charDef) ? (charDef).prowess : 0;
  } else if (combat.creatureRace && charDef && isCharacterCard(charDef) && charData) {
    baseProwess = computeCombatProwess(state, charData, charDef, combat.creatureRace);
  } else {
    baseProwess = charData?.effectiveStats?.prowess ?? 0;
  }
  const strikeProwess = combat.strikeProwess;
  let statusPenalty = 0;
  if (targetStatus === CardStatus.Tapped) statusPenalty = 1;
  if (targetStatus === CardStatus.Inverted) statusPenalty = 2; // Wounded
  const excessPenalty = currentStrike.excessStrikes > 0 ? currentStrike.excessStrikes : 0;

  // Tap: full prowess; Untap: -3 prowess penalty.
  // Add +1 per character/ally that has tapped to support this strike
  // (CoE rule 3.iv.4) so the displayed "need" updates as the defender
  // taps supporters.
  const supportBonus = currentStrike.supportCount ?? 0;
  const strikeBonus = currentStrike.strikeProwessBonus ?? 0;
  const tapProwess = baseProwess - statusPenalty - excessPenalty + supportBonus + strikeBonus;
  const untapProwess = baseProwess - 3 - statusPenalty - excessPenalty + supportBonus + strikeBonus;

  const tapNeed = Math.max(2, strikeProwess - tapProwess + 1);
  const tapExplanation = `Tapped: need ${tapNeed}+ (prowess ${tapProwess} vs ${strikeProwess})`;
  const untapNeed = Math.max(2, strikeProwess - untapProwess + 1);
  const untapExplanation = `Untapped: need ${untapNeed}+ (prowess ${untapProwess} vs ${strikeProwess})`;

  logDetail(`Defender can resolve strike against ${charName} (${isUntapped ? 'untapped' : 'tapped/wounded'})`);
  actions.push({
    action: { type: 'resolve-strike', player: playerId, tapToFight: true, need: tapNeed, explanation: tapExplanation },
    viable: true,
  });
  if (isUntapped) {
    actions.push({
      action: { type: 'resolve-strike', player: playerId, tapToFight: false, need: untapNeed, explanation: untapExplanation },
      viable: true,
    });
  }

  // Dodge: scan hand for cards with dodge-strike effect. The character
  // resolves the strike at full prowess without tapping (unless wounded).
  for (const handCard of player0.hand) {
    const cardDef = state.cardPool[handCard.definitionId as string];
    if (!cardDef || !('effects' in cardDef)) continue;
    const cardWithEffects = cardDef as { effects?: readonly import('../../types/effects.js').CardEffect[] };
    if (!cardWithEffects.effects) continue;

    const dodgeEffect = cardWithEffects.effects.find(
      (e): e is DodgeStrikeEffect => e.type === 'dodge-strike',
    );
    if (!dodgeEffect) continue;

    const dodgeExplanation = `Dodge: need ${tapNeed}+ (prowess ${tapProwess} vs ${strikeProwess}, no tap)`;
    logDetail(`Dodge available: ${handCard.definitionId as string} for ${charName}`);
    actions.push({
      action: {
        type: 'play-dodge',
        player: playerId,
        cardInstanceId: handCard.instanceId,
        need: tapNeed,
        explanation: dodgeExplanation,
      },
      viable: true,
    });
  }

  // Modify-strike short events (e.g. Risky Blow): scan hand for cards
  // whose `modify-strike` effect's required skill matches the struck
  // character. The card modifies the current strike's prowess/body when
  // played.
  if (charData && charDef && isCharacterCard(charDef)) {
    const struckSkills = charDef.skills ?? [];
    for (const handCard of player0.hand) {
      const cardDef2 = state.cardPool[handCard.definitionId as string];
      if (!cardDef2 || !('effects' in cardDef2)) continue;
      const cardWithEffects = cardDef2 as { effects?: readonly import('../../types/effects.js').CardEffect[]; name?: string };
      if (!cardWithEffects.effects) continue;

      const modifyEffect = cardWithEffects.effects.find(
        (e): e is ModifyStrikeEffect => e.type === 'modify-strike',
      );
      if (!modifyEffect) continue;

      if (modifyEffect.requiredSkill && !struckSkills.some(s => s === modifyEffect.requiredSkill)) {
        logDetail(`${cardWithEffects.name ?? handCard.definitionId as string}: ${charName} lacks required skill '${modifyEffect.requiredSkill}' — not playable`);
        continue;
      }

      if (modifyEffect.requiredSkill && currentStrike.requiredSkillEventPlayed) {
        logDetail(`${cardWithEffects.name ?? handCard.definitionId as string}: a skill-required resource has already been played against this strike (CoE 3.iv.5) — not playable`);
        continue;
      }

      const bonus = modifyEffect.prowessBonus ?? 0;
      const modifiedTapProwess = tapProwess + bonus;
      const modifiedNeed = Math.max(2, strikeProwess - modifiedTapProwess + 1);
      const bonusSign = bonus >= 0 ? '+' : '';
      const bodyPenalty = modifyEffect.bodyPenalty ?? 0;
      const bodyNote = bodyPenalty ? `, body ${bodyPenalty >= 0 ? '+' : ''}${bodyPenalty}` : '';
      const explanation = `${cardWithEffects.name ?? 'Strike event'}: need ${modifiedNeed}+ (prowess ${modifiedTapProwess} vs ${strikeProwess}${bonus !== 0 ? `, ${bonusSign}${bonus}` : ''}${bodyNote})`;
      logDetail(`Strike event available: ${cardWithEffects.name ?? handCard.definitionId as string} for ${charName} — ${explanation}`);
      actions.push({
        action: {
          type: 'play-strike-event',
          player: playerId,
          cardInstanceId: handCard.instanceId,
          need: modifiedNeed,
          explanation,
        },
        viable: true,
      });
    }
  }

  // Reroll-strike: scan hand for cards with reroll-strike effect (e.g. Lucky
  // Strike). Two 2d6 rolls are made and the better total is used; the strike
  // otherwise resolves like a normal tap-to-fight. An optional `filter`
  // gates availability on the strike target character's race/skills/name.
  for (const handCard of player0.hand) {
    const cardDef = state.cardPool[handCard.definitionId as string];
    if (!cardDef || !('effects' in cardDef)) continue;
    const cardWithEffects = cardDef as { effects?: readonly import('../../types/effects.js').CardEffect[] };
    if (!cardWithEffects.effects) continue;

    const rerollEffect = cardWithEffects.effects.find(
      (e): e is RerollStrikeEffect => e.type === 'reroll-strike',
    );
    if (!rerollEffect) continue;

    if (rerollEffect.filter) {
      if (!charDef) continue;
      const targetObj: Record<string, unknown> = {};
      if ('race' in charDef) targetObj.race = (charDef as { race: string }).race;
      if ('skills' in charDef) targetObj.skills = (charDef as { skills: readonly string[] }).skills;
      if ('name' in charDef) targetObj.name = (charDef as { name: string }).name;
      if (!matchesCondition(rerollEffect.filter, { target: targetObj })) {
        logDetail(`Reroll-strike ${handCard.definitionId as string}: filter not met for ${charName}`);
        continue;
      }
    }

    const rerollExplanation = `Reroll: need ${tapNeed}+ (prowess ${tapProwess} vs ${strikeProwess}, better of two rolls)`;
    logDetail(`Reroll-strike available: ${handCard.definitionId as string} for ${charName}`);
    actions.push({
      action: {
        type: 'play-reroll-strike',
        player: playerId,
        cardInstanceId: handCard.instanceId,
        need: tapNeed,
        explanation: rerollExplanation,
      },
      viable: true,
    });
  }

  // Support: any untapped character in the same company who hasn't been assigned a strike,
  // or any untapped ally in the company.
  // (CRF: "tap one or more of their untapped characters ... who hasn't been assigned a strike")
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];
  const company = player.companies.find(c => c.id === combat.companyId);
  const assignedCharIds = new Set(combat.strikeAssignments.map(sa => sa.characterId as string));
  if (company) {
    for (const charId of company.characters) {
      // Untapped characters without a strike can support
      if (!assignedCharIds.has(charId as string)) {
        const charData = player.characters[charId as string];
        if (charData && charData.status === CardStatus.Untapped) {
          logDetail(`Untapped character ${charId as string} can support (no strike assigned)`);
          actions.push({
            action: {
              type: 'support-strike',
              player: playerId,
              supportingCharacterId: charId,
              targetCharacterId: currentStrike.characterId,
            },
            viable: true,
          });
        }
      }

      // Untapped allies on any character in the company can support
      const hostChar = player.characters[charId as string];
      if (hostChar) {
        for (const ally of hostChar.allies) {
          if (ally.status !== CardStatus.Untapped) continue;
          logDetail(`Untapped ally ${ally.instanceId as string} can support`);
          actions.push({
            action: {
              type: 'support-strike',
              player: playerId,
              supportingCharacterId: ally.instanceId,
              targetCharacterId: currentStrike.characterId,
            },
            viable: true,
          });
        }
      }
    }
  }

  // Cancel-strike: scan characters in the company for cancel-strike effects
  // targeting other characters (e.g. Fatty Bolger taps to cancel a hobbit's strike).
  if (company0) {
    const strikeTargetDef = charDef;
    for (const compCharId of company0.characters) {
      if (compCharId === currentStrike.characterId) continue;
      const compCharData = player0.characters[compCharId as string];
      if (!compCharData || compCharData.status !== CardStatus.Untapped) continue;
      const compCharDef = state.cardPool[compCharData.definitionId as string];
      if (!compCharDef || !isCharacterCard(compCharDef)) continue;
      if (!compCharDef.effects) continue;

      for (const eff of compCharDef.effects) {
        if (eff.type !== 'cancel-strike') continue;
        const csEff = eff;
        if (csEff.target !== 'other-in-company') continue;
        if (csEff.cost?.tap !== 'self') continue;

        // Check when condition (enemy filtering)
        if (csEff.when) {
          const ctx: Record<string, unknown> = {};
          if (combat.creatureRace) ctx['enemy.race'] = combat.creatureRace;
          if (!matchesCondition(csEff.when, ctx)) continue;
        }

        // Check filter condition (target character filtering)
        if (csEff.filter) {
          if (!strikeTargetDef) continue;
          const targetObj: Record<string, unknown> = {};
          if ('race' in strikeTargetDef) targetObj.race = (strikeTargetDef as { race: string }).race;
          if ('skills' in strikeTargetDef) targetObj.skills = (strikeTargetDef as { skills: readonly string[] }).skills;
          if ('name' in strikeTargetDef) targetObj.name = (strikeTargetDef as { name: string }).name;
          if (!matchesCondition(csEff.filter, { target: targetObj })) continue;
        }

        const cancellerName = compCharDef.name;
        logDetail(`Cancel-strike available: ${cancellerName} can tap to cancel strike against ${charName}`);
        actions.push({
          action: {
            type: 'cancel-strike',
            player: playerId,
            cancellerInstanceId: compCharId,
            targetCharacterId: currentStrike.characterId,
          },
          viable: true,
        });
      }
    }
  }

  // Cancel-strike: scan items attached to the struck character for cancel-strike
  // effects with `cost: { tap: "self" }` and `target` absent or "self" (item
  // taps to protect its bearer — e.g. Enruned Shield's Warrior-only tap).
  if (charData && charDef && isCharacterCard(charDef)) {
    const bearerSkills = charDef.skills ?? [];
    const bearerRace = charDef.race;
    const bearerName = charDef.name;
    for (const item of charData.items) {
      if (item.status !== CardStatus.Untapped) continue;
      const itemDef = state.cardPool[item.definitionId as string];
      if (!itemDef || !('effects' in itemDef) || !itemDef.effects) continue;

      for (const eff of itemDef.effects) {
        if (eff.type !== 'cancel-strike') continue;
        const csEff = eff;
        if (csEff.cost?.tap !== 'self') continue;
        if (csEff.target && csEff.target !== 'self') continue;

        const itemName = 'name' in itemDef ? (itemDef as { name: string }).name : (item.definitionId as string);

        // Evaluate `when` against a context carrying bearer + enemy facts.
        if (csEff.when) {
          const ctx: Record<string, unknown> = {
            bearer: { skills: bearerSkills, race: bearerRace, name: bearerName },
          };
          if (combat.creatureRace) ctx.enemy = { race: combat.creatureRace };
          if (!matchesCondition(csEff.when, ctx)) {
            logDetail(`Cancel-strike ${itemName}: when condition not met for bearer ${bearerName}`);
            continue;
          }
        }

        logDetail(`Cancel-strike available: ${itemName} can tap to cancel strike against ${charName}`);
        actions.push({
          action: {
            type: 'cancel-strike',
            player: playerId,
            cancellerInstanceId: item.instanceId,
            targetCharacterId: currentStrike.characterId,
          },
          viable: true,
        });
      }
    }
  }

  return actions;
}

/**
 * Actions during the body-check sub-phase.
 * The attacking player rolls 2d6 against the body value.
 */
function bodyCheckActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.attackingPlayerId) return [];

  let body: number;
  let targetLabel: string;
  if (combat.bodyCheckTarget === 'creature') {
    body = combat.creatureBody ?? 0;
    targetLabel = 'creature';
  } else {
    const strike = combat.strikeAssignments[combat.currentStrikeIndex];
    const defPlayer = state.players.find(p => p.id === combat.defendingPlayerId);
    const charData = defPlayer?.characters[strike?.characterId as string];
    const charDef = charData ? state.cardPool[charData.definitionId as string] : undefined;
    body = (charDef as { body?: number } | undefined)?.body ?? 9;
    // Dodge body penalty
    if (strike?.dodged && strike.dodgeBodyPenalty) {
      body = body + strike.dodgeBodyPenalty;
    }
    // Modify-strike body penalty (e.g. Risky Blow's -1)
    if (strike?.strikeBodyPenalty) {
      body = body + strike.strikeBodyPenalty;
    }
    targetLabel = charDef && 'name' in charDef ? (charDef as { name: string }).name : 'character';
  }
  // +1 to body check roll if the character was already wounded before this strike (CoE rule 3.I)
  const isWounded = combat.bodyCheckTarget === 'character' &&
    combat.strikeAssignments[combat.currentStrikeIndex]?.wasAlreadyWounded === true;
  const woundedBonus = isWounded ? 1 : 0;
  const bcNeed = body + 1 - woundedBonus;
  const bcParts = [`${targetLabel} body ${body}`];
  if (woundedBonus) bcParts.push('+1 wounded');

  logDetail(`Attacker rolls body check vs ${targetLabel} (body ${body}${isWounded ? ', wounded +1' : ''})`);
  return [{
    action: {
      type: 'body-check-roll',
      player: playerId,
      need: bcNeed,
      explanation: `Body check: need ${bcNeed}+ (${bcParts.join(', ')})`,
    },
    viable: true,
  }];
}

/**
 * Generate cancel-attack actions for the defending player during the
 * pre-assignment window (assign-strikes phase before any strikes assigned).
 *
 * Scans two sources for `cancel-attack` effects:
 * 1. Cards in the defending player's hand (short events like Concealment,
 *    Dark Quarrels).
 * 2. In-play allies attached to any character in the defending company
 *    (e.g. The Warg-king's "tap to cancel a Wolf or Animal attack"). For
 *    in-play sources the effect must declare `cost: { tap: "self" }`;
 *    the ally must be untapped. The action emits `cardInstanceId` of the
 *    ally itself — `handleCancelAttack` detects this and taps the ally
 *    instead of discarding from hand.
 */
function cancelAttackActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  // Only the defending player can cancel, and only before any strikes are assigned
  if (playerId !== combat.defendingPlayerId) return [];
  if (combat.phase !== 'assign-strikes') return [];
  if (combat.strikeAssignments.length > 0) return [];

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];
  const company = player.companies.find(c => c.id === combat.companyId);
  if (!company) return [];

  const actions: EvaluatedAction[] = [];

  // Resolve the defending company's site type so cancel-attack `when` clauses
  // can gate on `bearer.atHaven` (used by cards like Adûnaphel the Ringwraith,
  // which may tap to cancel only when at a Darkhaven).
  const siteDef = company.currentSite ? state.cardPool[company.currentSite.definitionId] : undefined;
  const siteType = siteDef && isSiteCard(siteDef) ? siteDef.siteType : null;
  const atHaven = siteType === SiteType.Haven;

  const whenContext = (): Record<string, unknown> => {
    const ctx: Record<string, unknown> = {};
    if (combat.creatureRace) {
      ctx['enemy'] = { race: combat.creatureRace };
    }
    // Always expose `attack.source` (the AttackSource discriminator) so
    // cards can distinguish M/H creatures from on-guard reveals and site
    // automatic attacks. `attack.keying` is additive when present.
    const attackCtx: Record<string, unknown> = { source: combat.attackSource.type };
    if (combat.attackKeying && combat.attackKeying.length > 0) {
      attackCtx['keying'] = combat.attackKeying;
    }
    ctx['attack'] = attackCtx;
    ctx['bearer'] = { companySize: company.characters.length, atHaven };
    return ctx;
  };

  // In-play characters in the defending company with a cancel-attack effect
  // and a "tap self" cost (e.g. Adûnaphel the Ringwraith's Darkhaven tap).
  for (const charId of company.characters) {
    const charData = player.characters[charId as string];
    if (!charData) continue;
    const charDef = state.cardPool[charData.definitionId as string];
    if (!charDef || !('effects' in charDef) || !charDef.effects) continue;
    const cancelEffect = charDef.effects.find(
      (e): e is CancelAttackEffect => e.type === 'cancel-attack',
    );
    if (!cancelEffect) continue;
    if (cancelEffect.cost?.tap !== 'self') continue;
    if (charData.status !== CardStatus.Untapped) {
      logDetail(`Cancel-attack ${charDef.name ?? charData.definitionId as string}: character tapped, cannot activate`);
      continue;
    }
    if (cancelEffect.when && !matchesCondition(cancelEffect.when, whenContext())) {
      logDetail(`Cancel-attack ${charDef.name ?? charData.definitionId as string}: when condition not met (attack source: ${combat.attackSource.type}, atHaven: ${atHaven})`);
      continue;
    }
    logDetail(`Cancel-attack available: tap ${charDef.name ?? charData.definitionId as string} (in-play character)`);
    actions.push({
      action: {
        type: 'cancel-attack',
        player: playerId,
        cardInstanceId: charId,
      },
      viable: true,
    });
  }

  // In-play allies in the defending company with a cancel-attack effect
  // and a "tap self" cost (e.g. The Warg-king).
  for (const { ally } of findCompanyAllies(player, company.characters)) {
    const allyDef = state.cardPool[ally.definitionId as string];
    if (!allyDef || !('effects' in allyDef) || !allyDef.effects) continue;
    const cancelEffect = allyDef.effects.find(
      (e): e is CancelAttackEffect => e.type === 'cancel-attack',
    );
    if (!cancelEffect) continue;
    if (cancelEffect.cost?.tap !== 'self') continue;
    if (ally.status !== CardStatus.Untapped) {
      logDetail(`Cancel-attack ${allyDef.name ?? ally.definitionId as string}: ally tapped, cannot activate`);
      continue;
    }
    if (cancelEffect.when && !matchesCondition(cancelEffect.when, whenContext())) {
      logDetail(`Cancel-attack ${allyDef.name ?? ally.definitionId as string}: when condition not met (creature race: ${combat.creatureRace ?? 'none'})`);
      continue;
    }
    logDetail(`Cancel-attack available: tap ${allyDef.name ?? ally.definitionId as string} (in-play ally)`);
    actions.push({
      action: {
        type: 'cancel-attack',
        player: playerId,
        cardInstanceId: ally.instanceId,
      },
      viable: true,
    });
  }

  for (const handCard of player.hand) {
    const cardDef = state.cardPool[handCard.definitionId as string];
    if (!cardDef || !('effects' in cardDef)) continue;
    const cardWithEffects = cardDef as { effects?: readonly import('../../types/effects.js').CardEffect[] };
    if (!cardWithEffects.effects) continue;

    const cancelEffect = cardWithEffects.effects.find(
      (e): e is CancelAttackEffect => e.type === 'cancel-attack',
    );
    if (!cancelEffect) continue;

    // Check `when` condition against combat context (e.g. enemy.race filter)
    if (cancelEffect.when) {
      const ctx: Record<string, unknown> = {};
      if (combat.creatureRace) {
        ctx['enemy'] = { race: combat.creatureRace };
      }
      if (!matchesCondition(cancelEffect.when, ctx)) {
        logDetail(`Cancel-attack ${handCard.definitionId as string}: when condition not met (creature race: ${combat.creatureRace ?? 'none'})`);
        continue;
      }
    }

    // Costless cancel-attack: no skill/race requirement (e.g. Dark Quarrels)
    if (!cancelEffect.requiredSkill && !cancelEffect.requiredRace) {
      logDetail(`Cancel-attack available (no cost): ${handCard.definitionId as string}`);
      actions.push({
        action: {
          type: 'cancel-attack',
          player: playerId,
          cardInstanceId: handCard.instanceId,
        },
        viable: true,
      });
      continue;
    }

    // Character-gated cancel-attack: a character matching requiredSkill or
    // requiredRace must be in the company. When the effect has a tap cost,
    // the character must be untapped (one action per qualifying character).
    // When the cost is a check (e.g. corruption), tapped characters qualify
    // too. When there is no cost, any matching character suffices.
    const matchesRequirement = (charDef: import('../../types/cards.js').CharacterCard): boolean => {
      if (cancelEffect.requiredSkill) {
        return charDef.skills.includes(cancelEffect.requiredSkill as import('../../types/common.js').Skill);
      }
      if (cancelEffect.requiredRace) {
        return charDef.race === cancelEffect.requiredRace;
      }
      return false;
    };

    const requiresTap = cancelEffect.cost?.tap !== undefined;

    if (cancelEffect.cost) {
      for (const charId of company.characters) {
        const charData = player.characters[charId as string];
        if (!charData) continue;
        if (requiresTap && charData.status !== CardStatus.Untapped) continue;

        const charDef = state.cardPool[charData.definitionId as string];
        if (!charDef || !isCharacterCard(charDef)) continue;
        if (!matchesRequirement(charDef)) continue;

        logDetail(`Cancel-attack available: ${handCard.definitionId as string} via ${charData.definitionId as string} (${requiresTap ? 'tap' : 'check'} cost)`);
        actions.push({
          action: {
            type: 'cancel-attack',
            player: playerId,
            cardInstanceId: handCard.instanceId,
            scoutInstanceId: charId,
          },
          viable: true,
        });
      }
    } else {
      const hasMatch = company.characters.some(charId => {
        const charData = player.characters[charId as string];
        if (!charData) return false;
        const charDef = state.cardPool[charData.definitionId as string];
        if (!charDef || !isCharacterCard(charDef)) return false;
        return matchesRequirement(charDef);
      });
      if (hasMatch) {
        logDetail(`Cancel-attack available (no tap cost): ${handCard.definitionId as string}`);
        actions.push({
          action: {
            type: 'cancel-attack',
            player: playerId,
            cardInstanceId: handCard.instanceId,
          },
          viable: true,
        });
      }
    }
  }

  return actions;
}

/**
 * Generate halve-strikes actions for the defending player during the
 * pre-assignment window. For each card in hand with a `halve-strikes`
 * effect whose `when` condition matches the combat context, generate
 * an action to play it (e.g. Dark Quarrels alternative mode).
 */
function halveStrikesActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];
  if (combat.phase !== 'assign-strikes') return [];
  if (combat.strikeAssignments.length > 0) return [];

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];

  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardDef = state.cardPool[handCard.definitionId as string];
    if (!cardDef || !('effects' in cardDef)) continue;
    const cardWithEffects = cardDef as { effects?: readonly import('../../types/effects.js').CardEffect[] };
    if (!cardWithEffects.effects) continue;

    const halveEffect = cardWithEffects.effects.find(
      (e): e is HalveStrikesEffect => e.type === 'halve-strikes',
    );
    if (!halveEffect) continue;

    // Check `when` condition (e.g. "inPlay": "Gates of Morning")
    if (halveEffect.when) {
      const inPlayNames = [
        ...state.players[0].cardsInPlay.map(c => {
          const d = state.cardPool[c.definitionId as string];
          return d && 'name' in d ? (d as { name: string }).name : '';
        }),
        ...state.players[1].cardsInPlay.map(c => {
          const d = state.cardPool[c.definitionId as string];
          return d && 'name' in d ? (d as { name: string }).name : '';
        }),
      ];
      const ctx: Record<string, unknown> = { inPlay: inPlayNames };
      if (combat.creatureRace) {
        ctx['enemy'] = { race: combat.creatureRace };
      }
      if (!matchesCondition(halveEffect.when, ctx)) {
        logDetail(`Halve-strikes ${handCard.definitionId as string}: when condition not met`);
        continue;
      }
    }

    logDetail(`Halve-strikes available: ${handCard.definitionId as string}`);
    actions.push({
      action: {
        type: 'halve-strikes',
        player: playerId,
        cardInstanceId: handCard.instanceId,
      },
      viable: true,
    });
  }

  return actions;
}

/**
 * Generate modify-attack actions for the defending player during the
 * pre-assignment window. Scans items attached to every character in the
 * defending company for a `modify-attack` effect whose `when` condition
 * matches (e.g. Warrior-only items gate on `bearer.skills`). One action
 * is emitted per eligible untapped item; activating it taps the item (or
 * discards it, per `discardIfBearerNot`) and applies the prowess/body
 * modifiers to the whole attack.
 *
 * Used by Black Arrow (tw-494).
 */
function modifyAttackActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];
  if (combat.phase !== 'assign-strikes') return [];
  if (combat.strikeAssignments.length > 0) return [];

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];
  const company = player.companies.find(c => c.id === combat.companyId);
  if (!company) return [];

  const actions: EvaluatedAction[] = [];

  for (const charId of company.characters) {
    const charData = player.characters[charId as string];
    if (!charData) continue;
    const charDef = state.cardPool[charData.definitionId as string];
    if (!charDef || !isCharacterCard(charDef)) continue;

    for (const item of charData.items) {
      if (item.status !== CardStatus.Untapped) continue;
      const itemDef = state.cardPool[item.definitionId as string];
      if (!itemDef || !('effects' in itemDef) || !itemDef.effects) continue;
      const effect = itemDef.effects.find(
        (e): e is ModifyAttackEffect => e.type === 'modify-attack',
      );
      if (!effect) continue;
      if (effect.cost?.tap !== 'self') continue;

      if (effect.when) {
        const ctx: Record<string, unknown> = {
          bearer: {
            race: charDef.race,
            skills: charDef.skills,
            name: charDef.name,
          },
        };
        if (combat.creatureRace) {
          ctx['enemy'] = { race: combat.creatureRace };
        }
        const attackCtx: Record<string, unknown> = { source: combat.attackSource.type };
        if (combat.attackKeying && combat.attackKeying.length > 0) {
          attackCtx['keying'] = combat.attackKeying;
        }
        ctx['attack'] = attackCtx;
        if (!matchesCondition(effect.when, ctx)) {
          const itemName = 'name' in itemDef ? (itemDef as { name: string }).name : item.definitionId as string;
          logDetail(`Modify-attack ${itemName}: when condition not met (bearer ${charDef.name ?? ''})`);
          continue;
        }
      }

      const itemName = 'name' in itemDef ? (itemDef as { name: string }).name : item.definitionId as string;
      logDetail(`Modify-attack available: tap ${itemName} on ${charDef.name ?? ''} (prowess ${effect.prowessModifier ?? 0}, body ${effect.bodyModifier ?? 0})`);
      actions.push({
        action: {
          type: 'modify-attack',
          player: playerId,
          cardInstanceId: item.instanceId,
          characterInstanceId: charId,
        },
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * Generate modify-attack-from-hand actions for the player declared on
 * the effect (attacker or defender). For each matching card in the
 * player's hand whose `when` condition matches the combat context,
 * generate one action to discard-and-apply.
 *
 * Used by Dragon's Desolation (tw-29) Mode A — hazard player discards
 * the card from hand to add +2 prowess to one Dragon attack.
 */
function modifyAttackFromHandActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (combat.phase !== 'assign-strikes') return [];
  if (combat.strikeAssignments.length > 0) return [];

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex < 0) return [];
  const player = state.players[playerIndex];

  const inPlayNames = [
    ...state.players[0].cardsInPlay.map(c => {
      const d = state.cardPool[c.definitionId as string];
      return d && 'name' in d ? (d as { name: string }).name : '';
    }),
    ...state.players[1].cardsInPlay.map(c => {
      const d = state.cardPool[c.definitionId as string];
      return d && 'name' in d ? (d as { name: string }).name : '';
    }),
  ];

  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardDef = state.cardPool[handCard.definitionId as string];
    if (!cardDef || !('effects' in cardDef) || !cardDef.effects) continue;
    const effect = cardDef.effects.find(
      (e): e is ModifyAttackFromHandEffect => e.type === 'modify-attack-from-hand',
    );
    if (!effect) continue;

    const expectedPlayerId = effect.player === 'attacker'
      ? combat.attackingPlayerId
      : combat.defendingPlayerId;
    if (playerId !== expectedPlayerId) continue;

    if (effect.when) {
      const ctx: Record<string, unknown> = { inPlay: inPlayNames };
      if (combat.creatureRace) {
        ctx['enemy'] = { race: combat.creatureRace };
      }
      const attackCtx: Record<string, unknown> = { source: combat.attackSource.type };
      if (combat.attackKeying && combat.attackKeying.length > 0) {
        attackCtx['keying'] = combat.attackKeying;
      }
      ctx['attack'] = attackCtx;
      if (!matchesCondition(effect.when, ctx)) {
        logDetail(`Modify-attack-from-hand ${handCard.definitionId as string}: when condition not met`);
        continue;
      }
    }

    logDetail(`Modify-attack-from-hand available: ${handCard.definitionId as string} (prowess ${effect.prowessModifier ?? 0}, body ${effect.bodyModifier ?? 0})`);
    actions.push({
      action: {
        type: 'modify-attack-from-hand',
        player: playerId,
        cardInstanceId: handCard.instanceId,
      },
      viable: true,
    });
  }

  return actions;
}

/**
 * Generate cancel-by-tap actions for the defending player during the
 * cancel-by-tap sub-phase. The defender can tap untapped non-target
 * characters in the company to cancel one strike each (e.g. Assassin).
 */
function cancelByTapActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];
  if (combat.assignmentPhase !== 'cancel-by-tap') return [];
  if (!combat.cancelByTapRemaining || combat.cancelByTapRemaining <= 0) return [];

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];
  const company = player.companies.find(c => c.id === combat.companyId);
  if (!company) return [];

  // The target character is the one all strikes are assigned to
  const targetCharId = combat.strikeAssignments[0]?.characterId;
  if (!targetCharId) return [];

  const actions: EvaluatedAction[] = [];

  for (const charId of company.characters) {
    // Cannot tap the target character
    if (charId === targetCharId) continue;
    const charData = player.characters[charId as string];
    if (!charData || charData.status !== CardStatus.Untapped) continue;

    logDetail(`Cancel-by-tap available: tap ${charId as string} to cancel one attack`);
    actions.push({
      action: { type: 'cancel-by-tap', player: playerId, characterId: charId },
      viable: true,
    });
  }

  // Defender can always pass (decline to cancel more attacks)
  logDetail(`Defender can pass cancel-by-tap (${combat.cancelByTapRemaining} cancel(s) remaining)`);
  actions.push({
    action: { type: 'pass', player: playerId },
    viable: true,
  });

  return actions;
}

/**
 * Actions during the item-salvage sub-phase (CoE rule 3.I.2).
 *
 * After a character is eliminated by a body check, the defending player
 * may transfer one item per unwounded character in the same company.
 * The player can also pass to discard all remaining items.
 */
function itemSalvageActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];

  const { salvageItems, salvageRecipients } = combat;
  if (!salvageItems || !salvageRecipients || salvageItems.length === 0 || salvageRecipients.length === 0) return [];

  const actions: EvaluatedAction[] = [];

  // For each available item × each eligible recipient = one action
  for (const item of salvageItems) {
    for (const recipientId of salvageRecipients) {
      const charData = state.players.find(p => p.id === playerId)?.characters[recipientId as string];
      const charDef = charData ? state.cardPool[charData.definitionId as string] : undefined;
      const charName = charDef && 'name' in charDef ? (charDef as { name: string }).name : (recipientId as string);
      const itemDef = state.cardPool[item.definitionId as string];
      const itemName = itemDef && 'name' in itemDef ? (itemDef as { name: string }).name : (item.instanceId as string);
      logDetail(`Salvage available: ${itemName} → ${charName}`);
      actions.push({
        action: {
          type: 'salvage-item',
          player: playerId,
          itemInstanceId: item.instanceId,
          recipientCharacterId: recipientId,
        },
        viable: true,
      });
    }
  }

  // Player can always pass to skip remaining transfers
  logDetail('Defender can pass to discard remaining items');
  actions.push({
    action: { type: 'pass', player: playerId },
    viable: true,
  });

  return actions;
}

/**
 * Emit `play-hazard` actions for hazard permanent-events in the
 * attacker's hand that declare `play-window { phase: 'combat', step:
 * 'resolve-strike' }`. Each candidate is gated on its
 * `play-condition` (currently only `requires: 'combat-creature-race'`
 * is understood here — matched against `combat.creatureRace`) and its
 * `play-target` filter (evaluated against the defender currently
 * facing the strike). Used by Dragon's Curse (td-16).
 */
function combatHazardPermanentPlays(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (combat.phase !== 'resolve-strike') return [];
  if (playerId !== combat.attackingPlayerId) return [];

  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!currentStrike || currentStrike.resolved) return [];

  const attackerIndex = state.players.findIndex(p => p.id === playerId);
  const attacker = state.players[attackerIndex];
  if (!attacker) return [];

  const defenderIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defender = state.players[defenderIndex];
  const targetCharId = currentStrike.characterId;
  const targetChar = defender.characters[targetCharId as string];
  if (!targetChar) return [];
  const targetDef = state.cardPool[targetChar.definitionId as string];
  if (!targetDef || !isCharacterCard(targetDef)) return [];

  const results: EvaluatedAction[] = [];
  for (const handCard of attacker.hand) {
    const def = state.cardPool[handCard.definitionId as string];
    if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'permanent') continue;
    if (!('effects' in def) || !def.effects) continue;

    const playWindow = def.effects.find(
      (e): e is PlayWindowEffect => e.type === 'play-window',
    );
    if (!playWindow || playWindow.phase !== 'combat' || playWindow.step !== 'resolve-strike') continue;

    const playCondition = def.effects.find(
      (e): e is PlayConditionEffect => e.type === 'play-condition' && e.requires === 'combat-creature-race',
    );
    if (playCondition) {
      if (!combat.creatureRace || combat.creatureRace !== playCondition.race) {
        logDetail(`Combat play-hazard "${def.name}": creature race "${combat.creatureRace ?? 'none'}" does not match required "${playCondition.race ?? '?'}"`);
        continue;
      }
    }

    const playTarget = def.effects.find(
      (e): e is PlayTargetEffect => e.type === 'play-target',
    );
    if (playTarget && playTarget.target === 'character' && playTarget.filter) {
      const possessionNames = targetChar.items
        .map(item => state.cardPool[item.definitionId as string]?.name)
        .filter((n): n is string => n != null);
      const itemKeywords = targetChar.items.flatMap(item => {
        const iDef = state.cardPool[item.definitionId as string];
        return iDef && 'keywords' in iDef ? (iDef as { keywords?: readonly string[] }).keywords ?? [] : [];
      });
      const ctx = {
        target: {
          race: targetDef.race,
          skills: targetDef.skills,
          name: targetDef.name,
          mind: targetDef.mind,
          possessions: possessionNames,
          itemKeywords,
        },
      };
      if (!matchesCondition(playTarget.filter, ctx)) {
        logDetail(`Combat play-hazard "${def.name}" filter excludes ${targetDef.name}`);
        continue;
      }
    }

    // Per-character duplication limit: skip if a copy is already on the target.
    const charDupLimit = def.effects.find(
      (e): e is import('../../types/effects.js').DuplicationLimitEffect =>
        e.type === 'duplication-limit' && e.scope === 'character',
    );
    if (charDupLimit) {
      const copies = targetChar.hazards.filter(h => {
        const hDef = state.cardPool[h.definitionId as string];
        return hDef && hDef.name === def.name;
      }).length;
      if (copies >= charDupLimit.max) {
        logDetail(`Combat play-hazard "${def.name}" already on ${targetDef.name} (${copies}/${charDupLimit.max})`);
        continue;
      }
    }

    const companyId = defender.companies.find(c => c.characters.includes(targetCharId))?.id;
    if (!companyId) continue;

    logDetail(`Combat play-hazard "${def.name}" playable on ${targetDef.name}`);
    results.push({
      action: {
        type: 'play-hazard',
        player: playerId,
        cardInstanceId: handCard.instanceId,
        targetCompanyId: companyId,
        targetCharacterId: targetCharId,
      },
      viable: true,
    });
  }
  return results;
}
