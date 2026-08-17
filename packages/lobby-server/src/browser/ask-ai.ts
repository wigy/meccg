/**
 * @module ask-ai
 *
 * The Ask AI control (`specs/2026-08-17-ask-ai-observer.md`): a toolbar icon
 * that appears while an observer is attached, and a panel showing what the
 * observer's agent would do in the position on screen, and why.
 *
 * The server pushes an `observer` message whenever one attaches or detaches
 * (and to each client as it is seated), because an observer arriving changes no
 * game state and so never reaches the state broadcast — the same reason the
 * watcher badge has its own message.
 *
 * Asking is a read: it changes nothing, costs nothing, and does not mark the
 * game cheated, so unlike the dev tools it needs no confirmation.
 */

import type { AiExplanationMessage } from '@meccg/shared';

/** Observer presence, as last reported by the server. */
interface ObserverState {
  readonly attached: boolean;
  readonly agent: string | null;
}

let observer: ObserverState = { attached: false, agent: null };

/** Request id of the question in flight, or null when the panel is idle. */
let inFlight: string | null = null;

/** Counter behind the request ids; a monotone number is enough to match answers. */
let requestCounter = 0;

/** Sender for `ask-ai`, injected by the game connection so this module holds no socket. */
let sendAsk: ((requestId: string) => void) | null = null;

/** How the toolbar button should render, or null when it must not be shown. */
export interface AskAiButtonState {
  readonly visible: boolean;
  /** Tooltip text; names the agent, since the answer differs per agent. */
  readonly title: string;
}

/**
 * Whether the Ask AI button shows, and what its tooltip says.
 *
 * Availability is decided by one thing: whether an observer is attached.
 * Spectators get it too — watching an AI game and asking what a different agent
 * would have played is a main use of the feature, not an edge case — and there
 * is no dev-mode gate, because nothing here can alter the game.
 */
export function askAiButtonState(state: ObserverState): AskAiButtonState {
  if (!state.attached) return { visible: false, title: '' };
  return {
    visible: true,
    title: state.agent ? `Ask AI (${state.agent})` : 'Ask AI',
  };
}

/** Heading and body for the panel, given whatever the server said. */
export interface AskAiPanelText {
  readonly heading: string;
  readonly body: string;
}

/** Seconds, rendered for a human: "1.4s" reads better than "1400ms". */
function seconds(ms: number | undefined): string {
  return ms === undefined ? '' : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Turn an answer — or a refusal — into the panel's text.
 *
 * Every non-`ok` status says what to do about it: a panel that reports only
 * that something went wrong sends the reader to the terminal to find out why.
 */
export function formatAskAiPanel(msg: AiExplanationMessage): AskAiPanelText {
  const agent = msg.agent ?? 'the AI';
  switch (msg.status) {
    case 'ok':
      return {
        heading: `${agent} — ${msg.forPlayer ?? 'this seat'}`
          + (msg.elapsedMs === undefined ? '' : ` (${seconds(msg.elapsedMs)})`),
        body: (msg.lines ?? []).join('\n'),
      };
    case 'unavailable':
      return {
        heading: 'No observer attached',
        body: `${msg.message ?? 'Nothing is listening.'}\n\n`
          + 'Start one on the server host:\n\n  bin/observe --agent h2',
      };
    case 'timeout':
      return {
        heading: `${agent} ran out of time`,
        body: `${msg.message ?? 'No answer arrived.'}\n\n`
          + 'A search agent with a long budget can outlast the wait — try a smaller\n'
          + 'one (for example `--agent h2`, or `mc` with a lower `ms=`).',
      };
    default:
      return {
        heading: `${agent} could not answer`,
        body: msg.message ?? 'No reason given.',
      };
  }
}

/** The text shown while the agent is thinking. */
export function askAiPendingText(state: ObserverState): AskAiPanelText {
  return {
    heading: `Asking ${state.agent ?? 'the AI'}…`,
    body: 'Reading the position and ranking the moves.\n\n'
      + 'A search agent takes a few seconds.',
  };
}

// ---- DOM ----

function button(): HTMLButtonElement | null {
  return document.getElementById('ask-ai-btn') as HTMLButtonElement | null;
}

/** Apply the current presence to the toolbar button. */
function render(): void {
  const btn = button();
  if (!btn) return;
  const state = askAiButtonState(observer);
  btn.style.display = state.visible ? '' : 'none';
  btn.title = state.title;
  btn.setAttribute('aria-label', state.title);
  btn.disabled = inFlight !== null;
}

/** Write a heading and body into the panel and show it. */
function showPanel(text: AskAiPanelText): void {
  const modal = document.getElementById('ask-ai-modal');
  const heading = document.getElementById('ask-ai-heading');
  const body = document.getElementById('ask-ai-body');
  if (!modal || !heading || !body) return;
  heading.textContent = text.heading;
  body.textContent = text.body;
  // A fresh answer starts at the top: the header says which seat and position
  // is being explained, and that is the first thing to read.
  body.scrollTop = 0;
  modal.classList.remove('hidden');
}

/** Hide the panel. Safe to call when it is already hidden. */
export function closeAskAiPanel(): void {
  document.getElementById('ask-ai-modal')?.classList.add('hidden');
}

/** Record the observer presence the server pushed, and refresh the button. */
export function setObserver(state: ObserverState): void {
  observer = state;
  if (!state.attached) {
    // Any question in flight is already being failed by the server; drop the
    // local lock so the button is not left disabled forever.
    inFlight = null;
  }
  render();
}

/** Clear observer state. Call when leaving the game screen. */
export function resetObserver(): void {
  inFlight = null;
  closeAskAiPanel();
  setObserver({ attached: false, agent: null });
}

/** Register the sender for `ask-ai` messages (the game connection owns the socket). */
export function setAskAiSender(send: (requestId: string) => void): void {
  sendAsk = send;
}

/** Ask the observer about the current position. */
export function askAi(): void {
  if (!observer.attached || inFlight || !sendAsk) return;
  inFlight = `ask-${++requestCounter}`;
  render();
  showPanel(askAiPendingText(observer));
  sendAsk(inFlight);
}

/** Handle an `ai-explanation` from the server. */
export function handleAiExplanation(msg: AiExplanationMessage): void {
  // A late answer to a question the panel has moved on from is ignored, so a
  // stale explanation cannot replace the one on screen.
  if (inFlight !== null && msg.requestId !== inFlight) return;
  inFlight = null;
  render();
  showPanel(formatAskAiPanel(msg));
}

/** Whether the panel is currently on screen. */
function panelOpen(): boolean {
  return document.getElementById('ask-ai-modal')?.classList.contains('hidden') === false;
}

/** Wire the button, the close affordances, and the copy action. */
export function installAskAi(): void {
  button()?.addEventListener('click', () => askAi());
  document.getElementById('ask-ai-close')?.addEventListener('click', () => closeAskAiPanel());
  document.getElementById('ask-ai-backdrop')?.addEventListener('click', () => closeAskAiPanel());
  // Escape closes, like every other dialog. Handled here rather than in the
  // shared shortcut table because it must only fire while the panel is open —
  // the game's own Escape behaviour has to keep working underneath it.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !panelOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    closeAskAiPanel();
  }, true);
  document.getElementById('ask-ai-copy')?.addEventListener('click', () => {
    const body = document.getElementById('ask-ai-body');
    if (body?.textContent) void navigator.clipboard?.writeText(body.textContent);
  });
  render();
}
