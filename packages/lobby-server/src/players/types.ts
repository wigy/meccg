/**
 * @module players/types
 *
 * Data types for player account records stored on disk.
 */

/** A registered player account, serialized as JSON in ~/.meccg/players/. */
export interface PlayerRecord {
  /** Display name (unique, used for login and in-game identity). */
  readonly name: string;
  /** Email address. */
  readonly email: string;
  /** bcrypt password hash. */
  readonly passwordHash: string;
  /** ISO 8601 timestamp of account creation. */
  readonly createdAt: string;
  /** ID of the player's currently selected deck, or undefined if none. */
  readonly currentDeck?: string;
  /** Optional cosmetic display name shown in the lobby. Falls back to name if unset. */
  readonly displayName?: string;
  /** ISO 8601 timestamp of when the player last viewed their inbox. */
  readonly lastMailView?: string;
}
