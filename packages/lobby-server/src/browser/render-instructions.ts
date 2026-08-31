/**
 * @module render-instructions
 *
 * Renders the pass/action button in the visual game view. Phase-step
 * instruction text was removed (it duplicated the phase meter); the only
 * surviving guidance — live targeting hints — now renders inside the phase
 * meter breadcrumb (see {@link module:render-phase-meter}).
 */

import type { PlayerView, GameAction, ActivateGrantedAction, CardInstanceId } from '@meccg/shared';
import { Phase, getTitleCharacter } from '@meccg/shared';
import { appState, cardPool } from './app-state.js';
import { passButtonLabel } from './pass-button-label.js';
import { classifyActionKind } from './button-classification.js';
import { showTooltipMenu } from './tooltip-menu.js';
import { buildGrantedActionMenuItems } from './company-modals.js';

/**
 * Remove every child of the tier container `id` (a no-op if the container is
 * missing or already empty). Used to clear the middle and top tiers before
 * rebuilding them from the current legal actions — unlike the previous
 * per-class removal list, a button placed in a tier is guaranteed to be
 * cleaned up on the next render without needing its own cleanup entry.
 */
function clearTier(id: string): HTMLElement | null {
  const el = document.getElementById(id);
  if (el) [...el.children].forEach(child => child.remove());
  return el;
}

/** Render the pass/stop button in the visual view if a pass-like action is available. */
export function renderPassButton(view: PlayerView, onAction: (action: GameAction) => void): void {
  const btn = document.getElementById('pass-btn') as HTMLButtonElement | null;
  if (!btn) return;

  // Clear the middle (in-phase-pass) and top (special) tiers before
  // rebuilding them from the current legal actions. The bottom tier's only
  // dynamic content is #pass-btn itself, toggled via the "hidden" class
  // rather than removed, so it is left alone here.
  const inPhaseTier = clearTier('tier-in-phase-pass');
  const specialTier = clearTier('tier-special');

  // Spectators never act: hide both the pass button and the "Waiting…" box
  // (which would otherwise show permanently, since they have no legal actions).
  if (appState.spectating) {
    btn.classList.add('hidden');
    document.getElementById('waiting-indicator')?.classList.add('hidden');
    return;
  }

  // Top tier: card-granted actions (e.g. Carambor-style taps), otherwise
  // only reachable via portrait click. Rendered here in addition to that
  // affordance — not a replacement — so the fixed slot always exists once
  // any such ability is viable, and multiple simultaneously-viable
  // abilities collapse into one menu instead of one button apiece.
  if (specialTier) {
    const grantedActionEvals = view.legalActions.filter(
      ea => ea.viable && classifyActionKind(ea.action.type) === 'special',
    );
    if (grantedActionEvals.length > 0) {
      const grantedActions = grantedActionEvals.map(ea => ea.action as ActivateGrantedAction);
      const specialBtn = document.createElement('button');
      specialBtn.className = 'special-action-btn';
      specialBtn.textContent = 'Special ▾';
      specialBtn.onclick = () => {
        const resolveName = (id: CardInstanceId): string | undefined => {
          const defId = appState.lastInstanceLookup(id);
          return defId ? cardPool[defId as string]?.name : undefined;
        };
        showTooltipMenu(specialBtn, buildGrantedActionMenuItems(grantedActions, onAction, resolveName), { placement: 'over' });
      };
      specialTier.appendChild(specialBtn);
    }
  }

  // A corruption-check action only belongs on the generic bottom button when
  // it is the sole option: when several characters are simultaneously
  // eligible (e.g. Free Council's declare step, or Ren the Unclean's
  // selectable order), the player must choose which character checks by
  // clicking their portrait (see company-block.ts) — surfacing an arbitrary
  // one here as a "Roll" button would silently bypass that choice.
  const corruptionCheckCount = view.legalActions.filter(ea => ea.viable && ea.action.type === 'corruption-check').length;

  // Find a viable end-of-phase action (including chain priority pass) for the
  // bottom tier. `classifyActionKind` centralizes the whitelist of action
  // types this tier accepts (see button-classification.ts).
  const passEval = view.legalActions.find(ea =>
    ea.viable && classifyActionKind(ea.action.type) === 'end-of-phase'
    && !(ea.action.type === 'corruption-check' && corruptionCheckCount !== 1));
  const passAction = passEval?.action;
  const waitingEl = document.getElementById('waiting-indicator');
  if (!passAction) {
    // Wizard's Test (tw-365) makes two rolls, then the player chooses which
    // rolled total the ring's test uses — `choose-gold-ring-test-roll` has no
    // "default" pick (like the Free Council corruption-check case below), so
    // it is deliberately absent from the pass-like whitelist above rather
    // than having the generic button silently grab one option. Render one
    // button per rolled total instead of hiding the whole panel.
    const chooseTotalEvals = view.legalActions.filter(ea => ea.viable && ea.action.type === 'choose-gold-ring-test-roll');
    if (chooseTotalEvals.length > 0) {
      btn.classList.add('hidden');
      waitingEl?.classList.add('hidden');
      for (const ea of chooseTotalEvals) {
        const chooseAction = ea.action;
        if (chooseAction.type !== 'choose-gold-ring-test-roll') continue;
        const chooseBtn = document.createElement('button');
        chooseBtn.className = 'enter-site-btn gold-ring-choice-btn';
        chooseBtn.textContent = `Use ${chooseAction.rollTotal}`;
        chooseBtn.title = chooseAction.explanation;
        chooseBtn.onclick = () => onAction(chooseAction);
        inPhaseTier?.appendChild(chooseBtn);
      }
      return;
    }

    // The Great Hunt (wh-91): the controller chooses whether the opponent
    // reveals from their play deck or discard pile (`choose-great-hunt-source`).
    // Like the gold-ring choice above, there is no safe default pile to pick
    // silently, so it is deliberately absent from the pass-like whitelist —
    // render one button per offered pile instead of hiding the whole panel.
    const greatHuntSourceEvals = view.legalActions.filter(ea => ea.viable && ea.action.type === 'choose-great-hunt-source');
    if (greatHuntSourceEvals.length > 0) {
      btn.classList.add('hidden');
      waitingEl?.classList.add('hidden');
      for (const ea of greatHuntSourceEvals) {
        const chooseAction = ea.action;
        if (chooseAction.type !== 'choose-great-hunt-source') continue;
        const chooseBtn = document.createElement('button');
        chooseBtn.className = 'enter-site-btn great-hunt-choice-btn';
        chooseBtn.textContent = chooseAction.source === 'deck' ? 'Reveal Play Deck' : 'Reveal Discard Pile';
        chooseBtn.onclick = () => onAction(chooseAction);
        inPhaseTier?.appendChild(chooseBtn);
      }
      return;
    }

    // The Hunt (dm-143): the controller names one hazard-creature instance
    // among the candidates `findHuntCandidates` found in the opponent's play
    // deck/discard pile (`choose-hunt-target`). Like the two choices above,
    // there is no safe default creature to name silently, so it is
    // deliberately absent from the pass-like whitelist — render one button
    // per named candidate instead of hiding the whole panel. The action
    // carries `definitionId` directly (see `ChooseHuntTargetAction`), so the
    // label never needs to resolve the creature's identity through the
    // acting player's own (possibly still-redacted) view of the opponent's
    // deck/discard pile.
    const huntTargetEvals = view.legalActions.filter(ea => ea.viable && ea.action.type === 'choose-hunt-target');
    if (huntTargetEvals.length > 0) {
      btn.classList.add('hidden');
      waitingEl?.classList.add('hidden');
      for (const ea of huntTargetEvals) {
        const chooseAction = ea.action;
        if (chooseAction.type !== 'choose-hunt-target') continue;
        const creatureName = cardPool[chooseAction.definitionId as string]?.name ?? chooseAction.definitionId as string;
        const chooseBtn = document.createElement('button');
        chooseBtn.className = 'enter-site-btn hunt-target-choice-btn';
        chooseBtn.textContent = `Name ${creatureName}`;
        chooseBtn.onclick = () => onAction(chooseAction);
        inPhaseTier?.appendChild(chooseBtn);
      }
      return;
    }

    // CoE 3.47 general-influence overflow: the player left their organization
    // phase over their general influence and must remove one of several
    // named characters (`influence-overflow-discard`). Like the two choices
    // above, there is no safe default to auto-pick, so render one button per
    // candidate rather than falling through to the "no pass action" branch
    // below — which hides both the pass button and the waiting indicator
    // (since a viable action *does* exist), leaving no visible control at all.
    const overflowDiscardEvals = view.legalActions.filter(ea => ea.viable && ea.action.type === 'influence-overflow-discard');
    if (overflowDiscardEvals.length > 0) {
      btn.classList.add('hidden');
      waitingEl?.classList.add('hidden');
      for (const ea of overflowDiscardEvals) {
        const discardAction = ea.action;
        if (discardAction.type !== 'influence-overflow-discard') continue;
        const defId = appState.lastInstanceLookup(discardAction.characterInstanceId);
        const charName = defId ? cardPool[defId as string]?.name : undefined;
        const discardBtn = document.createElement('button');
        discardBtn.className = 'enter-site-btn influence-overflow-discard-btn';
        discardBtn.textContent = `Remove ${charName ?? discardAction.characterInstanceId as string}`;
        discardBtn.onclick = () => onAction(discardAction);
        inPhaseTier?.appendChild(discardBtn);
      }
      return;
    }

    // Call of Home / Pilfer Anything Unwatched (tw-18, as-33): a character
    // returned to hand may have one held item transferred to a company-mate
    // (`transfer-returned-item`) instead of it staying discarded. Like the
    // three choices above, declining is not a privileged default — the
    // player must actively choose which mate (if any) receives the item —
    // so it is deliberately absent from the pass-like whitelist. Render one
    // button per item/mate pair plus a "Leave Discarded" button rather than
    // falling through to the "no pass action" branch below, which would hide
    // the panel entirely while these actions are viable — bug report
    // fee86d3b1b398160 (game mt90y8eu-u0ndem, seq 52): "Game froze after
    // opponent successfully played Call of Home on my Círdan. No option to
    // move game state forward."
    const transferReturnedItemEvals = view.legalActions.filter(ea => ea.viable && ea.action.type === 'transfer-returned-item');
    if (transferReturnedItemEvals.length > 0) {
      btn.classList.add('hidden');
      waitingEl?.classList.add('hidden');
      for (const ea of transferReturnedItemEvals) {
        const transferAction = ea.action;
        if (transferAction.type !== 'transfer-returned-item') continue;
        const transferBtn = document.createElement('button');
        transferBtn.className = 'enter-site-btn transfer-returned-item-btn';
        if (transferAction.itemInstanceId && transferAction.targetCharacterId) {
          const itemDefId = appState.lastInstanceLookup(transferAction.itemInstanceId);
          const itemName = itemDefId ? cardPool[itemDefId as string]?.name : undefined;
          const targetDefId = appState.lastInstanceLookup(transferAction.targetCharacterId);
          const targetName = targetDefId ? cardPool[targetDefId as string]?.name : undefined;
          transferBtn.textContent = `Give ${itemName ?? transferAction.itemInstanceId as string} to ${targetName ?? transferAction.targetCharacterId as string}`;
        } else {
          transferBtn.textContent = 'Leave Discarded';
        }
        transferBtn.onclick = () => onAction(transferAction);
        inPhaseTier?.appendChild(transferBtn);
      }
      return;
    }

    // Tutorial enter-or-skip: the script demands entering the site, so the
    // gate demoted the normal Skip (pass) to non-viable — which would hide
    // the whole button pair. Show the familiar Enter/Skip controls anyway:
    // Enter live, Skip disabled with the tutorial reason as its tooltip.
    if (view.tutorial && view.phaseState.phase === Phase.Site && view.phaseState.step === 'enter-or-skip') {
      const enterEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'enter-site');
      const gatedSkip = view.legalActions.find(ea => !ea.viable && ea.action.type === 'pass');
      if (enterEval && gatedSkip) {
        btn.classList.remove('hidden');
        btn.textContent = 'Enter';
        btn.onclick = () => onAction(enterEval.action);
        const skipBtn = document.createElement('button');
        skipBtn.id = 'enter-site-btn';
        skipBtn.className = 'enter-site-btn';
        skipBtn.textContent = 'Skip';
        skipBtn.disabled = true;
        skipBtn.title = 'reason' in gatedSkip && typeof gatedSkip.reason === 'string' ? gatedSkip.reason : '';
        inPhaseTier?.appendChild(skipBtn);
        waitingEl?.classList.add('hidden');
        return;
      }
    }
    btn.classList.add('hidden');
    const hasViable = view.legalActions.some(ea => ea.viable);
    waitingEl?.classList.toggle('hidden', hasViable);
    return;
  }
  waitingEl?.classList.add('hidden');

  // Choose label based on action type and phase
  const label = passButtonLabel(passAction, view);

  btn.textContent = label;
  btn.classList.remove('hidden');
  btn.onclick = () => onAction(passAction);

  // When the primary button is a non-pass action (e.g. Draw) and a pass action
  // also exists, show a secondary Pass button so both options are available.
  if (passAction.type !== 'pass') {
    const secondaryPass = view.legalActions.find(ea => ea.viable && ea.action.type === 'pass');
    if (secondaryPass) {
      const passBtn2 = document.createElement('button');
      passBtn2.id = 'secondary-pass-btn';
      passBtn2.className = 'enter-site-btn'; // reuse same styling
      passBtn2.textContent = passButtonLabel(secondaryPass.action, view);
      passBtn2.onclick = () => onAction(secondaryPass.action);
      inPhaseTier?.appendChild(passBtn2);
    }
  }

  // During untap phase, add hazard sideboard buttons for the hazard player
  if (view.phaseState.phase === Phase.Untap && view.activePlayer !== view.self.id) {
    const toDiscardEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'start-hazard-sideboard-to-discard');
    if (toDiscardEval) {
      const toDiscardBtn = document.createElement('button');
      toDiscardBtn.className = 'enter-site-btn hazard-sb-btn';
      toDiscardBtn.textContent = 'Hazards to Discard';
      toDiscardBtn.onclick = () => onAction(toDiscardEval.action);
      inPhaseTier?.appendChild(toDiscardBtn);
    }
    const toDeckEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'start-hazard-sideboard-to-deck');
    if (toDeckEval) {
      const toDeckBtn = document.createElement('button');
      toDeckBtn.className = 'enter-site-btn hazard-sb-btn';
      toDeckBtn.textContent = 'Hazard to Deck';
      toDeckBtn.onclick = () => onAction(toDeckEval.action);
      inPhaseTier?.appendChild(toDeckBtn);
    }
  }

  // During signal-end, add a "Call Council" button if available
  if (view.phaseState.phase === Phase.EndOfTurn && view.phaseState.step === 'signal-end') {
    const councilEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'call-free-council');
    if (councilEval) {
      const councilBtn = document.createElement('button');
      councilBtn.id = 'call-council-btn';
      councilBtn.className = 'enter-site-btn';
      councilBtn.textContent = 'Call Council';
      councilBtn.onclick = () => onAction(councilEval.action);
      inPhaseTier?.appendChild(councilBtn);
    }
  }

  // During declare-company-attack, render Attack button(s) for each target.
  // With one target the Attack button becomes primary (most expected action),
  // and Skip CvCC is demoted to a secondary slot. With multiple targets all
  // Attack buttons are added as secondary slots alongside the Skip CvCC primary.
  if (!view.combat && view.phaseState.phase === Phase.Site && view.phaseState.step === 'declare-company-attack') {
    const attackEvals = view.legalActions.filter(
      ea => ea.viable && ea.action.type === 'declare-company-attack',
    );
    if (attackEvals.length === 1) {
      btn.textContent = 'Attack';
      btn.onclick = () => onAction(attackEvals[0].action);

      const skipBtn = document.createElement('button');
      skipBtn.id = 'skip-cvcc-btn';
      skipBtn.className = 'enter-site-btn';
      skipBtn.textContent = 'Skip CvCC';
      skipBtn.onclick = () => onAction(passAction);
      inPhaseTier?.appendChild(skipBtn);
    } else if (attackEvals.length > 1) {
      // Several opponent companies share the site: label each button with the
      // target company's title character so the player can tell them apart.
      for (const atk of attackEvals) {
        const action = atk.action;
        if (action.type !== 'declare-company-attack') continue;
        const target = view.opponent.companies.find(c => c.id === action.targetCompanyId);
        const titleChar = target ? getTitleCharacter(target.characters, view.opponent.characters, cardPool) : undefined;
        const titleName = titleChar ? cardPool[titleChar.definitionId as string]?.name : undefined;
        const attackBtn = document.createElement('button');
        attackBtn.className = 'enter-site-btn cvcc-attack-btn';
        attackBtn.textContent = titleName ? `Attack ${titleName}'s company` : 'Attack';
        attackBtn.onclick = () => onAction(action);
        inPhaseTier?.appendChild(attackBtn);
      }
    }
  }

  // During enter-or-skip, promote "Enter" to the primary pass button slot
  // (bottom-most, triggered by the Enter key) and demote "Skip" to the
  // secondary slot above it. Entering the site is the usual choice, so it
  // should be the default that Enter fires.
  if (view.phaseState.phase === Phase.Site && view.phaseState.step === 'enter-or-skip') {
    const enterEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'enter-site');
    if (enterEval) {
      btn.textContent = 'Enter';
      btn.onclick = () => onAction(enterEval.action);

      const skipBtn = document.createElement('button');
      skipBtn.id = 'enter-site-btn';
      skipBtn.className = 'enter-site-btn';
      skipBtn.textContent = 'Skip';
      skipBtn.onclick = () => onAction(passAction);
      inPhaseTier?.appendChild(skipBtn);
    }
  }
}
