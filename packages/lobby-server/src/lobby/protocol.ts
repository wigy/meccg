/**
 * @module lobby/protocol
 *
 * WebSocket message types for the lobby server. The lobby WS connection
 * is separate from the game server WS — it handles player presence,
 * game challenges, and game-start signaling.
 */

// ---- Client → Lobby ----

/** Challenge an online player to a game. */
export interface ChallengeMessage {
  readonly type: 'challenge';
  readonly opponentName: string;
}

/** Accept a pending challenge. */
export interface AcceptChallengeMessage {
  readonly type: 'accept-challenge';
  readonly from: string;
}

/** Decline a pending challenge. */
export interface DeclineChallengeMessage {
  readonly type: 'decline-challenge';
  readonly from: string;
}

/** Withdraw a challenge you previously sent to another player. */
export interface CancelChallengeMessage {
  readonly type: 'cancel-challenge';
  readonly opponentName: string;
}

/** Start a game against the Heuristic-AI (rule-based strategy). */
export interface PlayHeuristicAiMessage {
  readonly type: 'play-heuristic-ai';
  /** Catalog deck ID for the AI opponent to use. */
  readonly deckId: string;
}

/**
 * Start a game against the flat Monte-Carlo search agent
 * (`specs/2026-07-27-monte-carlo-rollout-agent.md`), the strongest
 * opponent available. Carries no agent spec: the spec is a server-side
 * constant, because it becomes argv of a spawned process and a
 * client-supplied one could name an arbitrary weights file.
 */
export interface PlayMcAiMessage {
  readonly type: 'play-mc-ai';
  /** Catalog deck ID for the AI opponent to use. */
  readonly deckId: string;
}

/**
 * Start a game against a Real-AI: a trained model from the server's
 * `~/.meccg/models` directory (see GET /api/models). The `model` field is
 * the bare file name from that listing — never a path.
 */
export interface PlayRealAiMessage {
  readonly type: 'play-real-ai';
  /** Catalog deck ID for the AI opponent to use. */
  readonly deckId: string;
  /** Model file name from /api/models (e.g. "gen2-it3-promoted-2026-07-25.json"). */
  readonly model: string;
}

/**
 * Start a game against the Modular AI — Heuristics 2
 * (`specs/2026-07-27-heuristics-2-ai.md`).
 *
 * Like {@link PlayMcAiMessage} this carries no agent spec: the spec becomes
 * argv of a spawned process, and a client-supplied one could name an arbitrary
 * weights file.
 */
export interface PlayModularAiMessage {
  readonly type: 'play-modular-ai';
  /** Catalog deck ID for the AI opponent to use. */
  readonly deckId: string;
}

/**
 * Start the guided tutorial (specs/2026-07-30-tutorial-plan.md): a scripted
 * teaching game against the server-driven "Mentor". Carries no deck — both
 * decks are fixed by the shared tutorial module.
 */
export interface PlayTutorialMessage {
  readonly type: 'play-tutorial';
  /**
   * Which tutorial chapter to play. Only chapter 1 ("Starting the journey")
   * exists today; the field readies the protocol for future chapters.
   * Absent (old clients) means chapter 1.
   */
  readonly chapter?: number;
}

/** Start a game against the pseudo-AI (human controls both sides). */
export interface PlayPseudoAiMessage {
  readonly type: 'play-pseudo-ai';
  /** Catalog deck ID for the pseudo-AI opponent to use. */
  readonly deckId: string;
}

/** Forward the human's chosen action to the pseudo-AI client. */
export interface PseudoAiPickMessage {
  readonly type: 'pseudo-ai-pick';
  /** The action chosen by the human for the AI player. */
  readonly action: import('@meccg/shared').GameAction;
}

/**
 * Kill your own lingering game server on demand. Lets a player clear a
 * stuck "You are already in a game" state (crashed tab, network blip)
 * without waiting out the idle-exit grace period. No fields needed — the
 * server already knows the caller's own active game from the online-player
 * map.
 */
export interface StopGameMessage {
  readonly type: 'stop-game';
}

/** Request the lobby to relaunch a game server after the previous one died. */
export interface RejoinGameMessage {
  readonly type: 'rejoin-game';
  /** Name of the opponent from the previous game session. */
  readonly opponent: string;
}

/**
 * Ask to watch an ongoing game as a spectator. The port
 * identifies the game (from the {@link OngoingGameEntry} list); the lobby
 * mints a short-lived spectator token and replies with {@link GameWatchingMessage}.
 */
export interface WatchGameMessage {
  readonly type: 'watch-game';
  /** Port of the game to watch, taken from the broadcast game list. */
  readonly port: number;
}

/** Union of all client → lobby messages. */
export type LobbyClientMessage =
  | ChallengeMessage
  | AcceptChallengeMessage
  | DeclineChallengeMessage
  | CancelChallengeMessage
  | PlayHeuristicAiMessage
  | PlayTutorialMessage
  | PlayMcAiMessage
  | PlayModularAiMessage
  | PlayRealAiMessage
  | PlayPseudoAiMessage
  | PseudoAiPickMessage
  | RejoinGameMessage
  | WatchGameMessage
  | StopGameMessage;

// ---- Lobby → Client ----

/** An online player entry with identity, display name, and credits. */
export interface OnlinePlayerEntry {
  readonly name: string;
  readonly displayName: string;
  readonly credits: number;
  /** Whether this player is currently in a game (so no Challenge is offered). */
  readonly inGame: boolean;
}

/**
 * An ongoing game that other players can watch. AI games are included:
 * the AI seat appears as its player name (`AI-Heuristic`, `AI-MC`, ...),
 * so the row itself tells what the busy player is up against.
 */
export interface OngoingGameEntry {
  /** Port of the game server, used to request watching. */
  readonly port: number;
  readonly player1: string;
  readonly player1DisplayName: string;
  readonly player2: string;
  readonly player2DisplayName: string;
}

/** Broadcast of all currently online players and the games in progress. */
export interface OnlinePlayersMessage {
  readonly type: 'online-players';
  readonly players: readonly OnlinePlayerEntry[];
  /** Games currently in progress (including AI games) that can be watched. */
  readonly games: readonly OngoingGameEntry[];
}

/** Incoming challenge from another player. */
export interface ChallengeReceivedMessage {
  readonly type: 'challenge-received';
  readonly from: string;
  readonly fromDisplayName: string;
}

/** A challenge you sent was declined. */
export interface ChallengeDeclinedMessage {
  readonly type: 'challenge-declined';
  readonly by: string;
  readonly byDisplayName: string;
}

/**
 * A pending challenge you received is no longer valid — the challenger has
 * entered a game. The client dismisses the incoming-challenge prompt if it is
 * showing this challenger.
 */
export interface ChallengeCancelledMessage {
  readonly type: 'challenge-cancelled';
  /** Name of the challenger whose challenge is being withdrawn. */
  readonly from: string;
}

/** A game is starting — connect to the game server. */
export interface GameStartingMessage {
  readonly type: 'game-starting';
  readonly port: number;
  readonly token: string;
  readonly opponent: string;
  readonly opponentDisplayName: string;
  /** True when the opponent is a pseudo-AI controlled by the human player. */
  readonly pseudoAi?: boolean;
  /** Game token for the AI player (pseudo-AI mode only — human controls both sides). */
  readonly aiToken?: string;
}

/** A game is ready to watch — connect to the game server as a spectator. */
export interface GameWatchingMessage {
  readonly type: 'game-watching';
  readonly port: number;
  /** Spectator join token, signed for the watcher's own name. */
  readonly token: string;
  readonly player1DisplayName: string;
  readonly player2DisplayName: string;
}

/** Error message from the lobby. */
export interface LobbyErrorMessage {
  readonly type: 'error';
  readonly message: string;
}

/** System notification broadcast to all online players. */
export interface SystemNotificationMessage {
  readonly type: 'system-notification';
  readonly message: string;
}

/** Force all connected clients to reload the page (sent during controlled reboot). */
export interface ForceReloadMessage {
  readonly type: 'force-reload';
}

/** Notification that the player has new mail. Sent when mail arrives. */
export interface MailNotificationMessage {
  readonly type: 'mail-notification';
  /** Number of unread messages in the player's inbox. */
  readonly unreadCount: number;
}

/** Pseudo-AI legal actions forwarded to the human player for decision. */
export interface PseudoAiActionsMessage {
  readonly type: 'pseudo-ai-actions';
  /** The AI player's evaluated legal actions. */
  readonly actions: readonly import('@meccg/shared').EvaluatedAction[];
  /** Current game phase name. */
  readonly phase: string;
}

/** Union of all lobby → client messages. */
export type LobbyServerMessage =
  | OnlinePlayersMessage
  | ChallengeReceivedMessage
  | ChallengeDeclinedMessage
  | ChallengeCancelledMessage
  | GameStartingMessage
  | GameWatchingMessage
  | LobbyErrorMessage
  | SystemNotificationMessage
  | ForceReloadMessage
  | MailNotificationMessage
  | PseudoAiActionsMessage;
