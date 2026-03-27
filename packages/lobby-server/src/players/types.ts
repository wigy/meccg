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
}
