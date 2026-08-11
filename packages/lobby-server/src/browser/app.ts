/**
 * @module app
 *
 * Browser entry point for the MECCG web client. Connects to the
 * client-web server via WebSocket (which proxies to the game server),
 * renders game state, and sends actions on button click.
 *
 * Most logic has been extracted into focused modules:
 * - app-state: shared mutable state and constants
 * - session: game session persistence (save/restore/clear)
 * - pseudo-ai: pseudo-AI panel and second WebSocket
 * - game-connection: game server WebSocket, reconnection, rejoin
 * - deck-browser: deck listing, catalog, compact previews, CRUD
 * - deck-editor: deck editor rendering and card list
 * - inbox: mail inbox/sent UI
 * - lobby-screens: screen management, auth, lobby WS, init
 */

import {
  appState, cardPool, LOBBY_MODE,
  VIEWING_INBOX_KEY, VIEWING_DECKS_KEY, VIEWING_CREDITS_KEY, VIEWING_SCOREBOARD_KEY,
  VIEWING_CHANGELOG_KEY, VIEWING_ADMIN_KEY, EDITING_DECK_KEY, MAIL_TAB_KEY, MAIL_MSG_KEY,
} from './app-state.js';
import { savePlayerName, loadPlayerName } from './session.js';
import { openInbox, openSent } from './inbox.js';
import { setInboxCallbacks } from './inbox.js';
import { openCreditsPage, setCreditsPageCallbacks } from './credits-page.js';
import { openScoreboardPage, setScoreboardPageCallbacks } from './scoreboard-page.js';
import { openChangelogPage, setChangelogPageCallbacks } from './changelog-page.js';
import { openAdminPage, setAdminPageCallbacks } from './admin-page.js';
import { showAlert, showConfirm } from './dialog.js';
import {
  showScreen, showAuthError, applyBackground, selectRandomBackground,
  connectLobbyWs, initLobby, showAuthTab, selectRandomAuthHero,
} from './lobby-screens.js';
import { renderLog, showNotification } from './render-log.js';
import { setupCardPreview } from './render-card-preview.js';
import { loadGameBundle } from './lazy-load.js';
import { apiGet, apiSend } from './api.js';


const versionEl = document.getElementById('lobby-nav-version');
if (versionEl && window.__MECCG_VERSION) {
  versionEl.textContent = `v${window.__MECCG_VERSION}`;
}

// ---- Wire up cross-module callbacks ----

setInboxCallbacks(showScreen);
setCreditsPageCallbacks(showScreen);
setScoreboardPageCallbacks(showScreen);
setChangelogPageCallbacks(showScreen);
setAdminPageCallbacks(showScreen);

// ---- UI Setup ----

document.addEventListener('DOMContentLoaded', () => {
  const nameInput = document.getElementById('name-input') as HTMLInputElement;
  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
  const connectForm = document.getElementById('connect-form') as HTMLElement;

  applyBackground();
  setupCardPreview(cardPool);

  async function startGame(name: string, newBackground = false): Promise<void> {
    if (newBackground) selectRandomBackground();
    savePlayerName(name);
    appState.autoReconnect = true;
    connectForm.style.display = 'none';
    document.getElementById('game')!.classList.remove('hidden');
    await loadGameBundle();
    window.__meccg!.connect!(name);
  }

  connectBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;
    if (!/^[a-zA-Z0-9 _-]+$/.test(name)) {
      renderLog('Invalid name: only letters, numbers, spaces, hyphens, and underscores allowed');
      return;
    }
    void startGame(name, true);
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectBtn.click();
  });

  // ---- Lobby mode event handlers ----
  if (LOBBY_MODE) {
    const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
    const registerBtn = document.getElementById('register-btn') as HTMLButtonElement;
    const authTabLogin = document.getElementById('auth-tab-login') as HTMLButtonElement;
    const authTabRegister = document.getElementById('auth-tab-register') as HTMLButtonElement;
    const acceptChallengeBtn = document.getElementById('accept-challenge-btn') as HTMLButtonElement;
    const declineChallengeBtn = document.getElementById('decline-challenge-btn') as HTMLButtonElement;

    authTabLogin.addEventListener('click', () => showAuthTab('login'));
    authTabRegister.addEventListener('click', () => showAuthTab('register'));

    loginBtn.addEventListener('click', () => { void (async () => {
      const name = (document.getElementById('login-name') as HTMLInputElement).value.trim();
      const password = (document.getElementById('login-password') as HTMLInputElement).value;
      if (!name || !password) { showAuthError('login-error', 'Name and password are required'); return; }
      const r = await apiSend<{ name?: string; isReviewer?: boolean; isAdmin?: boolean; credits?: number }>(
        '/api/login', 'POST', { name, password });
      if (!r.ok) { showAuthError('login-error', r.error ?? 'Login failed'); return; }
      appState.lobbyPlayerName = r.data.name!;
      appState.lobbyPlayerIsReviewer = r.data.isReviewer ?? false;
      appState.lobbyPlayerIsAdmin = r.data.isAdmin ?? false;
      appState.lobbyPlayerCredits = r.data.credits ?? 0;
      showScreen('lobby-screen');
      connectLobbyWs();
    })(); });

    // Enter key on login form
    for (const id of ['login-name', 'login-password']) {
      document.getElementById(id)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginBtn.click(); });
    }

    registerBtn.addEventListener('click', () => { void (async () => {
      const name = (document.getElementById('register-name') as HTMLInputElement).value.trim();
      const displayName = (document.getElementById('register-display-name') as HTMLInputElement).value.trim();
      const email = (document.getElementById('register-email') as HTMLInputElement).value.trim();
      const password = (document.getElementById('register-password') as HTMLInputElement).value;
      if (!name || !email || !password) { showAuthError('register-error', 'All fields are required'); return; }
      const r = await apiSend<{ name?: string; isReviewer?: boolean; isAdmin?: boolean; credits?: number }>(
        '/api/register', 'POST', { name, email, password, ...(displayName ? { displayName } : {}) });
      if (!r.ok) { showAuthError('register-error', r.error ?? 'Registration failed'); return; }
      appState.lobbyPlayerName = r.data.name!;
      appState.lobbyPlayerIsReviewer = r.data.isReviewer ?? false;
      appState.lobbyPlayerIsAdmin = r.data.isAdmin ?? false;
      appState.lobbyPlayerCredits = r.data.credits ?? 0;
      showScreen('lobby-screen');
      connectLobbyWs();
    })(); });

    // Enter key on register form
    for (const id of ['register-name', 'register-display-name', 'register-email', 'register-password']) {
      document.getElementById(id)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') registerBtn.click(); });
    }

    const doLogout = () => { void (async () => {
      await apiSend('/api/logout', 'POST');
      appState.lobbyPlayerName = null;
      appState.lobbyPlayerIsAdmin = false;
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      sessionStorage.removeItem(MAIL_TAB_KEY);
      sessionStorage.removeItem(MAIL_MSG_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_DECKS_KEY);
      sessionStorage.removeItem(VIEWING_CREDITS_KEY);
      sessionStorage.removeItem(VIEWING_SCOREBOARD_KEY);
      sessionStorage.removeItem(VIEWING_CHANGELOG_KEY);
      sessionStorage.removeItem(VIEWING_ADMIN_KEY);
      if (appState.lobbyWs) { appState.lobbyWs.close(); appState.lobbyWs = null; }
      selectRandomAuthHero();
      showAuthTab('login');
      showScreen('auth-screen');
    })(); };
    document.getElementById('logout-btn')!.addEventListener('click', doLogout);

    /**
     * Disable every play button in the lobby while a game launch is in flight.
     * The browser dims disabled buttons via the `.lobby-play-btn:disabled` rule.
     */
    function setLobbyPlayButtonsDisabled(disabled: boolean): void {
      for (const btn of document.querySelectorAll<HTMLButtonElement>('#lobby-screen .lobby-play-btn')) {
        btn.disabled = disabled;
      }
      for (const btn of document.querySelectorAll<HTMLButtonElement>('.lobby-player-item button')) {
        btn.disabled = disabled;
      }
    }

    // ---- Guided tutorial ----
    // The button expands a chapter picker (one chapter today, more planned);
    // Start launches the chosen chapter. No deck selection: tutorial decks
    // are fixed, and an unfinished chapter resumes from its autosave.
    const playTutorialBtn = document.getElementById('play-tutorial-btn') as HTMLButtonElement | null;
    const tutorialOptions = document.getElementById('tutorial-options');
    const startTutorialBtn = document.getElementById('start-tutorial-btn') as HTMLButtonElement | null;
    playTutorialBtn?.addEventListener('click', () => {
      tutorialOptions?.classList.toggle('hidden');
    });
    startTutorialBtn?.addEventListener('click', () => {
      if (appState.lobbyWs && appState.lobbyWs.readyState === WebSocket.OPEN) {
        const chapterSelect = document.getElementById('tutorial-chapter-select') as HTMLSelectElement | null;
        appState.lobbyWs.send(JSON.stringify({ type: 'play-tutorial', chapter: Number(chapterSelect?.value ?? 1) }));
        startTutorialBtn.textContent = 'Starting...';
        setLobbyPlayButtonsDisabled(true);
      }
    });

    // ---- Heuristic-AI ----
    const playHeuristicAiBtn = document.getElementById('play-heuristic-ai-btn') as HTMLButtonElement;

    /** Send the play-heuristic-ai message and disable the UI. */
    function launchHeuristicAiGame(): void {
      if (appState.lobbyWs && appState.lobbyWs.readyState === WebSocket.OPEN) {
        const aiDeckSelect = document.getElementById('ai-deck-select') as HTMLSelectElement;
        appState.lobbyWs.send(JSON.stringify({ type: 'play-heuristic-ai', deckId: aiDeckSelect.value }));
        playHeuristicAiBtn.textContent = 'Starting...';
        setLobbyPlayButtonsDisabled(true);
      }
    }

    playHeuristicAiBtn.addEventListener('click', () => { void (async () => {
      const r = await apiGet<{ hasSave: boolean }>('/api/saves/check?opponent=AI-Heuristic');
      if (r.ok && r.data?.hasSave) {
        const cont = await showConfirm(
          'A saved game exists against Heuristic-AI. Continue the saved game or start a new one?',
          { okLabel: 'Continue', cancelLabel: 'Start New' },
        );
        if (!cont) {
          await apiSend('/api/saves/delete', 'POST', { opponent: 'AI-Heuristic' });
        }
      }
      launchHeuristicAiGame();
    })(); });

    // ---- MC-AI (flat Monte-Carlo search) ----
    const playMcAiBtn = document.getElementById('play-mc-ai-btn') as HTMLButtonElement | null;

    /** Send the play-mc-ai message and disable the UI. */
    function launchMcAiGame(): void {
      if (playMcAiBtn && appState.lobbyWs && appState.lobbyWs.readyState === WebSocket.OPEN) {
        const aiDeckSelect = document.getElementById('ai-deck-select') as HTMLSelectElement;
        appState.lobbyWs.send(JSON.stringify({ type: 'play-mc-ai', deckId: aiDeckSelect.value }));
        playMcAiBtn.textContent = 'Starting...';
        setLobbyPlayButtonsDisabled(true);
      }
    }

    playMcAiBtn?.addEventListener('click', () => { void (async () => {
      const r = await apiGet<{ hasSave: boolean }>('/api/saves/check?opponent=AI-MC');
      if (r.ok && r.data?.hasSave) {
        const cont = await showConfirm(
          'A saved game exists against MC-AI. Continue the saved game or start a new one?',
          { okLabel: 'Continue', cancelLabel: 'Start New' },
        );
        if (!cont) {
          await apiSend('/api/saves/delete', 'POST', { opponent: 'AI-MC' });
        }
      }
      launchMcAiGame();
    })(); });

    // ---- Modular AI (Heuristics 2) ----
    const playModularAiBtn = document.getElementById('play-modular-ai-btn') as HTMLButtonElement | null;

    /** Send the play-modular-ai message and disable the UI. */
    function launchModularAiGame(): void {
      if (playModularAiBtn && appState.lobbyWs && appState.lobbyWs.readyState === WebSocket.OPEN) {
        const aiDeckSelect = document.getElementById('ai-deck-select') as HTMLSelectElement;
        appState.lobbyWs.send(JSON.stringify({ type: 'play-modular-ai', deckId: aiDeckSelect.value }));
        playModularAiBtn.textContent = 'Starting...';
        setLobbyPlayButtonsDisabled(true);
      }
    }

    playModularAiBtn?.addEventListener('click', () => { void (async () => {
      const r = await apiGet<{ hasSave: boolean }>('/api/saves/check?opponent=AI-Modular');
      if (r.ok && r.data?.hasSave) {
        const cont = await showConfirm(
          'A saved game exists against Modular AI. Continue the saved game or start a new one?',
          { okLabel: 'Continue', cancelLabel: 'Start New' },
        );
        if (!cont) {
          await apiSend('/api/saves/delete', 'POST', { opponent: 'AI-Modular' });
        }
      }
      launchModularAiGame();
    })(); });

    // ---- Real-AI (trained model) ----
    const playRealAiBtn = document.getElementById('play-real-ai-btn') as HTMLButtonElement;
    const realAiOptions = document.getElementById('real-ai-options') as HTMLElement;
    const startRealAiBtn = document.getElementById('start-real-ai-btn') as HTMLButtonElement;
    const aiModelSelect = document.getElementById('ai-model-select') as HTMLSelectElement;

    /** Populate the Real-AI model picker; hides the option when none exist. */
    async function loadModelList(): Promise<void> {
      const r = await apiGet<{ file: string; label: string }[]>('/api/models');
      aiModelSelect.innerHTML = '';
      const models = r.ok ? (r.data ?? []) : [];
      for (const model of models) {
        const option = document.createElement('option');
        option.value = model.file;
        option.textContent = model.label;
        aiModelSelect.appendChild(option);
      }
      const usable = models.length > 0;
      playRealAiBtn.disabled = !usable;
      startRealAiBtn.disabled = !usable;
      if (!usable) {
        const option = document.createElement('option');
        option.textContent = 'no models installed';
        aiModelSelect.appendChild(option);
      }
    }
    void loadModelList();

    /** Send the play-real-ai message and disable the UI. */
    function launchRealAiGame(): void {
      if (appState.lobbyWs && appState.lobbyWs.readyState === WebSocket.OPEN) {
        const aiDeckSelect = document.getElementById('ai-deck-select') as HTMLSelectElement;
        appState.lobbyWs.send(JSON.stringify({ type: 'play-real-ai', deckId: aiDeckSelect.value, model: aiModelSelect.value }));
        playRealAiBtn.textContent = 'Starting...';
        setLobbyPlayButtonsDisabled(true);
      }
    }

    // The model picker lives under the button and only appears once the player
    // has asked for a Real-AI game; the reveal replaces the old always-visible
    // select next to the deck pickers.
    playRealAiBtn.addEventListener('click', () => {
      realAiOptions.classList.toggle('hidden');
    });

    startRealAiBtn.addEventListener('click', () => { void (async () => {
      const r = await apiGet<{ hasSave: boolean }>('/api/saves/check?opponent=AI-Real');
      if (r.ok && r.data?.hasSave) {
        const cont = await showConfirm(
          'A saved game exists against Real-AI. Continue the saved game or start a new one?',
          { okLabel: 'Continue', cancelLabel: 'Start New' },
        );
        if (!cont) {
          await apiSend('/api/saves/delete', 'POST', { opponent: 'AI-Real' });
        }
      }
      launchRealAiGame();
    })(); });

    // ---- Pseudo-AI ----
    const playPseudoAiBtn = document.getElementById('play-pseudo-ai-btn') as HTMLButtonElement;

    /** Send the play-pseudo-ai message and disable the UI. */
    function launchPseudoAiGame(): void {
      if (appState.lobbyWs && appState.lobbyWs.readyState === WebSocket.OPEN) {
        const aiDeckSelect = document.getElementById('ai-deck-select') as HTMLSelectElement;
        const deckId = aiDeckSelect.value;
        // Capture the AI deck now, before the lobby screen is hidden
        appState.pendingAiDeck = appState.cachedCatalog.find(d => d.id === deckId) ?? null;
        appState.lobbyWs.send(JSON.stringify({ type: 'play-pseudo-ai', deckId }));
        playPseudoAiBtn.textContent = 'Starting...';
        setLobbyPlayButtonsDisabled(true);
      }
    }

    playPseudoAiBtn.addEventListener('click', () => { void (async () => {
      const r = await apiGet<{ hasSave: boolean }>('/api/saves/check?opponent=AI-Pseudo');
      if (r.ok && r.data?.hasSave) {
        const cont = await showConfirm(
          'A saved game exists against Pseudo-AI. Continue the saved game or start a new one?',
          { okLabel: 'Continue', cancelLabel: 'Start New' },
        );
        if (!cont) {
          await apiSend('/api/saves/delete', 'POST', { opponent: 'AI-Pseudo' });
        }
      }
      launchPseudoAiGame();
    })(); });

    // ---- Stop a lingering game ----
    // Shown only while the lobby still has us marked in-game (see the
    // 'online-players' handler in lobby-screens.ts); lets a player clear a
    // stuck "You are already in a game" block themselves rather than wait
    // out the idle-exit grace period.
    const stopGameBtn = document.getElementById('stop-game-btn') as HTMLButtonElement | null;
    stopGameBtn?.addEventListener('click', () => { void (async () => {
      const ok = await showConfirm(
        'Stop your existing game? Any progress since the last save will be lost, and a human opponent still playing will be disconnected without notice.',
        { okLabel: 'Stop Game', cancelLabel: 'Cancel' },
      );
      if (!ok) return;
      if (appState.lobbyWs && appState.lobbyWs.readyState === WebSocket.OPEN) {
        appState.lobbyWs.send(JSON.stringify({ type: 'stop-game' }));
        stopGameBtn.textContent = 'Stopping...';
        stopGameBtn.disabled = true;
      }
    })(); });

    acceptChallengeBtn.addEventListener('click', () => {
      if (appState.lobbyWs && appState.lobbyWs.readyState === WebSocket.OPEN && appState.challengeFrom) {
        appState.lobbyWs.send(JSON.stringify({ type: 'accept-challenge', from: appState.challengeFrom }));
        document.getElementById('challenge-incoming')!.classList.add('hidden');
        appState.challengeFrom = null;
      }
    });

    declineChallengeBtn.addEventListener('click', () => {
      if (appState.lobbyWs && appState.lobbyWs.readyState === WebSocket.OPEN && appState.challengeFrom) {
        appState.lobbyWs.send(JSON.stringify({ type: 'decline-challenge', from: appState.challengeFrom }));
        document.getElementById('challenge-incoming')!.classList.add('hidden');
        appState.challengeFrom = null;
      }
    });

    // "Choose a deck" link in the no-deck notice
    document.getElementById('no-deck-link')!.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('nav-decks')!.click();
    });

    // Nav bar buttons
    document.getElementById('nav-lobby')!.addEventListener('click', () => {
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      sessionStorage.removeItem(MAIL_TAB_KEY);
      sessionStorage.removeItem(MAIL_MSG_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_DECKS_KEY);
      sessionStorage.removeItem(VIEWING_CREDITS_KEY);
      sessionStorage.removeItem(VIEWING_SCOREBOARD_KEY);
      sessionStorage.removeItem(VIEWING_CHANGELOG_KEY);
      sessionStorage.removeItem(VIEWING_ADMIN_KEY);
      showScreen('lobby-screen');
    });
    document.getElementById('nav-decks')!.addEventListener('click', () => {
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      sessionStorage.removeItem(MAIL_TAB_KEY);
      sessionStorage.removeItem(MAIL_MSG_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_CREDITS_KEY);
      sessionStorage.removeItem(VIEWING_SCOREBOARD_KEY);
      sessionStorage.removeItem(VIEWING_CHANGELOG_KEY);
      sessionStorage.removeItem(VIEWING_ADMIN_KEY);
      sessionStorage.setItem(VIEWING_DECKS_KEY, '1');
      showScreen('decks-screen');
    });
    document.getElementById('nav-mail')!.addEventListener('click', () => {
      sessionStorage.removeItem(VIEWING_DECKS_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_CREDITS_KEY);
      sessionStorage.removeItem(VIEWING_SCOREBOARD_KEY);
      sessionStorage.removeItem(VIEWING_CHANGELOG_KEY);
      sessionStorage.removeItem(VIEWING_ADMIN_KEY);
      void openInbox();
    });
    document.getElementById('lobby-credits-badge')!.addEventListener('click', () => {
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      sessionStorage.removeItem(MAIL_TAB_KEY);
      sessionStorage.removeItem(MAIL_MSG_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_DECKS_KEY);
      sessionStorage.removeItem(VIEWING_SCOREBOARD_KEY);
      sessionStorage.removeItem(VIEWING_CHANGELOG_KEY);
      sessionStorage.removeItem(VIEWING_ADMIN_KEY);
      sessionStorage.setItem(VIEWING_CREDITS_KEY, '1');
      void openCreditsPage();
    });
    document.getElementById('nav-scoreboard')!.addEventListener('click', () => {
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      sessionStorage.removeItem(MAIL_TAB_KEY);
      sessionStorage.removeItem(MAIL_MSG_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_DECKS_KEY);
      sessionStorage.removeItem(VIEWING_CREDITS_KEY);
      sessionStorage.removeItem(VIEWING_CHANGELOG_KEY);
      sessionStorage.removeItem(VIEWING_ADMIN_KEY);
      sessionStorage.setItem(VIEWING_SCOREBOARD_KEY, '1');
      void openScoreboardPage();
    });
    const goToChangelog = () => {
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      sessionStorage.removeItem(MAIL_TAB_KEY);
      sessionStorage.removeItem(MAIL_MSG_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_DECKS_KEY);
      sessionStorage.removeItem(VIEWING_CREDITS_KEY);
      sessionStorage.removeItem(VIEWING_SCOREBOARD_KEY);
      sessionStorage.removeItem(VIEWING_ADMIN_KEY);
      sessionStorage.setItem(VIEWING_CHANGELOG_KEY, '1');
      void openChangelogPage();
    };
    document.getElementById('nav-changelog')!.addEventListener('click', goToChangelog);
    document.getElementById('lobby-nav-version')!.addEventListener('click', goToChangelog);
    document.getElementById('nav-admin')!.addEventListener('click', () => {
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      sessionStorage.removeItem(MAIL_TAB_KEY);
      sessionStorage.removeItem(MAIL_MSG_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_DECKS_KEY);
      sessionStorage.removeItem(VIEWING_CREDITS_KEY);
      sessionStorage.removeItem(VIEWING_SCOREBOARD_KEY);
      sessionStorage.removeItem(VIEWING_CHANGELOG_KEY);
      sessionStorage.setItem(VIEWING_ADMIN_KEY, '1');
      void openAdminPage();
    });

    // Nav bar bug-report / feature-request icon buttons. Each opens the same
    // modal used elsewhere (bug report in-game, feature request on the mail
    // page). Filing is always allowed regardless of credit balance — an
    // out-of-funds request simply waits in the queue until a top-up.
    document.getElementById('nav-bug-report-btn')!.addEventListener('click', () => {
      const modal = document.getElementById('bug-report-modal')!;
      modal.dataset.context = 'lobby';
      const hint = document.getElementById('bug-report-hint');
      if (hint) {
        hint.textContent = 'Describe the bug or problem you ran into. Include what you were doing in the lobby (e.g. deck building, matchmaking, mail) when it happened.';
      }
      const subject = document.getElementById('bug-report-subject') as HTMLInputElement;
      const body = document.getElementById('bug-report-body') as HTMLTextAreaElement;
      subject.value = '';
      body.value = '';
      modal.classList.remove('hidden');
      subject.focus();
    });
    document.getElementById('nav-feature-request-btn')!.addEventListener('click', () => {
      const subject = document.getElementById('feature-request-subject') as HTMLInputElement;
      const body = document.getElementById('feature-request-body') as HTMLTextAreaElement;
      subject.value = '';
      body.value = '';
      document.getElementById('feature-request-modal')!.classList.remove('hidden');
      subject.focus();
    });

    // Feature request modal handlers
    const frModal = document.getElementById('feature-request-modal')!;
    const frSubject = document.getElementById('feature-request-subject') as HTMLInputElement;
    const frBody = document.getElementById('feature-request-body') as HTMLTextAreaElement;
    const closeFeatureModal = () => { frModal.classList.add('hidden'); };
    document.getElementById('feature-request-backdrop')!.addEventListener('click', closeFeatureModal);
    document.getElementById('feature-request-cancel')!.addEventListener('click', closeFeatureModal);
    document.getElementById('feature-request-send')!.addEventListener('click', () => {
      const brief = frSubject.value.trim();
      const text = frBody.value.trim();
      if (!brief || !text) return;
      void (async () => {
        const r = await apiSend('/api/mail/send', 'POST', {
          recipients: ['admin'],
          subject: `Feature Request: ${brief}`,
          topic: 'feature-request',
          body: text,
        });
        if (r.ok) {
          closeFeatureModal();
          showNotification('Request sent!');
          void openSent();
        } else {
          await showAlert(r.error ?? 'Failed to send feature request');
        }
      })();
    });
  }

  // Bug report modal handlers
  const brModal = document.getElementById('bug-report-modal')!;
  const brSubject = document.getElementById('bug-report-subject') as HTMLInputElement;
  const brBody = document.getElementById('bug-report-body') as HTMLTextAreaElement;
  const closeBugModal = () => { brModal.classList.add('hidden'); };
  document.getElementById('bug-report-backdrop')!.addEventListener('click', closeBugModal);
  document.getElementById('bug-report-cancel')!.addEventListener('click', closeBugModal);
  document.getElementById('bug-report-send')!.addEventListener('click', () => {
    const brief = brSubject.value.trim();
    const text = brBody.value.trim();
    if (!brief || !text) return;
    // A report filed from the lobby has no active game, so omit the game
    // reference lines (Game ID / sequence number) — there is no save to point
    // the AI at. In-game reports keep them so the captured state can be found.
    const inGame = brModal.dataset.context !== 'lobby' && appState.currentGameId !== null;
    const tutorialLine = appState.currentTutorialStep !== null
      ? `\nTutorial step: ${appState.currentTutorialStep}`
      : '';
    const turnPhaseLine = appState.currentTurnNumber !== null && appState.currentPhase !== null
      ? `\nTurn: ${appState.currentTurnNumber}\nPhase: ${appState.currentPhase}`
      : '';
    const fullBody = inGame
      ? `Game ID: ${appState.currentGameId ?? 'unknown'}\nSequence number: ${appState.currentStateSeq}${turnPhaseLine}${tutorialLine}\n\n${text}`
      : text;
    void (async () => {
      const r = await apiSend('/api/mail/bug-report', 'POST', {
        subject: `Bug Report: ${brief}`,
        body: fullBody,
        otherPlayer: appState.opponentName,
      });
      if (r.ok) {
        closeBugModal();
        showNotification('Bug report sent!');
      } else {
        await showAlert(r.error ?? 'Failed to send bug report');
      }
    })();
  });
  document.getElementById('bug-report-btn')!.addEventListener('click', () => {
    brModal.dataset.context = 'game';
    const hint = document.getElementById('bug-report-hint');
    if (hint) {
      hint.textContent = 'Describe the bug you encountered. The full game state at this moment is captured automatically, so there is no need to list steps to reproduce — just describe what went wrong.';
    }
    brSubject.value = '';
    brBody.value = '';
    brModal.classList.remove('hidden');
    brSubject.focus();
  });

  // Initial screen
  if (LOBBY_MODE) {
    // In lobby mode: check session, show login or lobby
    void initLobby();
  } else {
    // Standalone mode: show connect form, auto-connect if name saved
    connectForm.style.display = '';
    const savedName = loadPlayerName();
    if (savedName) {
      void startGame(savedName);
    }
  }
});
