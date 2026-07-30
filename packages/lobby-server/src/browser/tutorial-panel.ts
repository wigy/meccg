/**
 * @module tutorial-panel
 *
 * The guided tutorial's instruction panel (specs/2026-07-30-tutorial-plan.md).
 *
 * Renders entirely from {@link PlayerView.tutorial}, which the game-server's
 * TutorialController attaches to every state broadcast of a tutorial game —
 * the browser never tracks the script cursor itself. The panel is a managed
 * `#tutorial-panel` element rebuilt on every render (same pattern as the
 * setup banner) and absent outside tutorial games.
 */

import type { PlayerView } from '@meccg/shared';

/**
 * Render (or remove) the tutorial panel for the current view. Shows the
 * active step's title and instruction, overall progress, and — when the
 * script is waiting on the Mentor — a watching note instead of a prompt.
 */
export function renderTutorialPanel(view: PlayerView): void {
  document.getElementById('tutorial-panel')?.remove();
  const progress = view.tutorial;
  if (!progress) return;
  const board = document.getElementById('visual-board');
  if (!board) return;

  const panel = document.createElement('div');
  panel.id = 'tutorial-panel';
  panel.className = progress.done ? 'tutorial-panel tutorial-panel--done' : 'tutorial-panel';

  const header = document.createElement('div');
  header.className = 'tutorial-panel-header';

  const title = document.createElement('span');
  title.className = 'tutorial-panel-title';
  title.textContent = progress.title;
  header.appendChild(title);

  const step = document.createElement('span');
  step.className = 'tutorial-panel-progress';
  step.textContent = progress.done
    ? 'Complete!'
    : `Step ${progress.stepIndex + 1} of ${progress.stepCount}`;
  header.appendChild(step);

  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'tutorial-panel-body';
  body.textContent = progress.body;
  panel.appendChild(body);

  if (!progress.done && !progress.yourTurn) {
    const waiting = document.createElement('div');
    waiting.className = 'tutorial-panel-waiting';
    waiting.textContent = 'Watch — the Mentor is acting…';
    panel.appendChild(waiting);
  }

  board.prepend(panel);
}
