/**
 * @module mail/store
 *
 * File-based mail storage for the internal mailing system. Each message
 * is stored as an individual JSON file in the player's mail directory.
 * The {@link sendMail} function is the single entry point for delivering
 * mail — it writes the inbox file and sends a real-time WebSocket
 * notification to the recipient.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PLAYERS_DIR } from '../config.js';
import { writeJson } from '../json-store.js';
import { notifyPlayer } from '../lobby/lobby.js';
import { toDirName } from '../players/store.js';
import type { MailMessage, MailSender, MailStatus, MailTopic } from './types.js';

/** Path to a player's mail inbox directory. */
function inboxDir(playerName: string): string {
  return path.join(PLAYERS_DIR, toDirName(playerName), 'mail', 'inbox');
}

/**
 * Read and parse a mail JSON file, normalizing `updatedAt` to `timestamp` if
 * absent (older files written before `updatedAt` was introduced).
 */
function loadMail(filePath: string): MailMessage {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MailMessage & { updatedAt?: string };
  return raw.updatedAt ? raw : { ...raw, updatedAt: raw.timestamp };
}

/** Path to a player's deleted mail directory. */
function deletedDir(playerName: string): string {
  return path.join(PLAYERS_DIR, toDirName(playerName), 'mail', 'deleted');
}

/** Path to a player's sent mail directory. */
function sentDir(playerName: string): string {
  return path.join(PLAYERS_DIR, toDirName(playerName), 'mail', 'sent');
}

/** Fields required when composing a new message (id, timestamp, status are generated). */
export interface SendMailOptions {
  /** Human-readable sender name. */
  readonly from: string;
  /** Fixed sender category. */
  readonly sender: MailSender;
  /** Message topic for categorization. */
  readonly topic: MailTopic;
  /** Full message body in Markdown format. */
  readonly body: string;
  /** Human-readable subject line. */
  readonly subject: string;
  /** Named references relevant to this message (e.g. deckId, cardName). */
  readonly keywords: Readonly<Record<string, string>>;
  /** If set, a copy of the message is saved to this player's sent folder. */
  readonly sentBy?: string;
  /** Message ID this is a reply to. */
  readonly replyTo?: string;
}

/**
 * True when `value` is a usable mail recipient list: a non-empty array of
 * non-empty strings. The HTTP routes validate request bodies with this
 * before calling {@link sendMail} — a plain string must be rejected, not
 * iterated: strings pass a bare `.length` truthiness check and spread into
 * single characters, silently creating one inbox per character (a real
 * incident; see the Mail System API note in CLAUDE.md).
 */
export function isRecipientList(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(r => typeof r === 'string' && r.length > 0);
}

/**
 * Single entry point for sending mail. Generates a unique ID, writes an
 * inbox file for each recipient, and pushes a WebSocket notification to
 * online recipients.
 *
 * Throws when `recipients` is not an array — a string would otherwise be
 * spread character-by-character into bogus single-letter inboxes.
 *
 * @returns The generated message ID (shared across all recipients).
 */
export function sendMail(recipients: readonly string[], options: SendMailOptions): string {
  if (!Array.isArray(recipients)) {
    throw new Error('sendMail: recipients must be an array of player names, got ' + typeof recipients);
  }
  const id = crypto.randomBytes(8).toString('hex');
  const timestamp = new Date().toISOString();

  const message: MailMessage = {
    id,
    status: 'new',
    from: options.from,
    sender: options.sender,
    topic: options.topic,
    body: options.body,
    timestamp,
    updatedAt: timestamp,
    subject: options.subject,
    keywords: options.keywords,
    recipients: [...recipients],
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
  };

  for (const recipient of recipients) {
    const dir = inboxDir(recipient);
    writeJson(path.join(dir, `${id}.json`), message);

    const unread = countUnread(recipient);
    notifyPlayer(recipient, { type: 'mail-notification', unreadCount: unread });
  }

  if (options.sentBy) {
    writeSentCopy(options.sentBy, message);
  }

  return id;
}

/** Write a copy of a message to a player's sent folder. */
export function writeSentCopy(playerName: string, message: MailMessage): void {
  const dir = sentDir(playerName);
  writeJson(path.join(dir, `${message.id}.json`), message);
}

/** List all messages in a player's sent folder, sorted by timestamp descending (newest first). */
export function listSent(playerName: string): MailMessage[] {
  const dir = sentDir(playerName);
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const messages = files.map(f => loadMail(path.join(dir, f)));
    return messages.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch {
    return [];
  }
}

/** List all messages in a player's inbox, sorted by timestamp descending (newest first). */
export function listInbox(playerName: string): MailMessage[] {
  const dir = inboxDir(playerName);
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const messages = files.map(f => loadMail(path.join(dir, f)));
    return messages.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch {
    return [];
  }
}

/**
 * Read a message from a player's inbox. If the message has status 'new',
 * it is updated to 'read' on disk.
 *
 * @returns The message, or null if not found.
 */
export function readMessage(playerName: string, msgId: string): MailMessage | null {
  const filePath = path.join(inboxDir(playerName), `${msgId}.json`);
  try {
    const message = loadMail(filePath);
    if (message.status === 'new' && message.topic !== 'review-request' && message.topic !== 'feature-request' && message.topic !== 'bug-report') {
      const updatedAt = new Date().toISOString();
      const updated: MailMessage = { ...message, status: 'read', updatedAt };
      writeJson(filePath, updated);
      updateSentCopies(msgId, 'read', updatedAt);
      return updated;
    }
    return message;
  } catch {
    return null;
  }
}

/**
 * Update a message's status and optionally set the success field.
 *
 * @param keywordsPatch Optional key/value pairs merged onto the message's
 *   existing keywords (existing keys are overwritten, others preserved). Used
 *   to stamp e.g. `prUrl`/`pendingReplyJson` onto a message as it moves to
 *   `processed`, so the run-ai finalize sweep can later resolve its PR.
 * @returns The updated message, or null if not found.
 */
export function updateMessageStatus(
  playerName: string,
  msgId: string,
  status: MailStatus,
  success?: boolean,
  keywordsPatch?: Readonly<Record<string, string>>,
): MailMessage | null {
  const filePath = path.join(inboxDir(playerName), `${msgId}.json`);
  try {
    const message = loadMail(filePath);
    const updatedAt = new Date().toISOString();
    const updated: MailMessage = {
      ...message,
      status,
      updatedAt,
      ...(success !== undefined ? { success } : {}),
      ...(keywordsPatch ? { keywords: { ...message.keywords, ...keywordsPatch } } : {}),
    };
    writeJson(filePath, updated);
    updateSentCopies(msgId, status, updatedAt, success, keywordsPatch);
    notifyPlayer(playerName, { type: 'mail-notification', unreadCount: countUnread(playerName) });
    return updated;
  } catch {
    return null;
  }
}

/** Update all sent-folder copies of a message across all players. */
function updateSentCopies(
  msgId: string,
  status: MailStatus,
  updatedAt: string,
  success?: boolean,
  keywordsPatch?: Readonly<Record<string, string>>,
): void {
  try {
    const entries = fs.readdirSync(PLAYERS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(PLAYERS_DIR, entry.name, 'mail', 'sent', `${msgId}.json`);
      try {
        const message = loadMail(filePath);
        const updated: MailMessage = {
          ...message,
          status,
          updatedAt,
          ...(success !== undefined ? { success } : {}),
          ...(keywordsPatch ? { keywords: { ...message.keywords, ...keywordsPatch } } : {}),
        };
        writeJson(filePath, updated);
      } catch { /* file doesn't exist for this player */ }
    }
  } catch { /* players dir doesn't exist */ }
}

/**
 * Move a message from inbox to the deleted folder, updating its status
 * to 'deleted'.
 *
 * @returns True if the message was found and deleted, false otherwise.
 */
export function deleteMessage(playerName: string, msgId: string): boolean {
  const srcPath = path.join(inboxDir(playerName), `${msgId}.json`);
  try {
    const message = loadMail(srcPath);
    const destDir = deletedDir(playerName);

    const updated: MailMessage = { ...message, status: 'deleted', updatedAt: new Date().toISOString() };
    writeJson(path.join(destDir, `${msgId}.json`), updated);
    fs.unlinkSync(srcPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * A pending request surfaced to the AI worker via the system API. This is
 * the API-side equivalent of what `bin/requests` produces by grepping the
 * on-disk inboxes directly.
 */
export interface UnhandledRequest {
  /** Message ID. */
  readonly id: string;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
  /** Message topic. */
  readonly topic: MailTopic;
  /** Message status (always 'new' here, but surfaced for clarity). */
  readonly status: MailStatus;
  /** Subject line. */
  readonly subject: string;
  /** Sender display name. */
  readonly from: string;
  /** Keywords carried on the message. */
  readonly keywords: Readonly<Record<string, string>>;
  /** Inbox the request was found in (e.g. 'ai' or 'admin'). */
  readonly inbox: string;
}

/**
 * Collect request messages across the given inboxes. A request is any
 * message whose topic ends in '-request' or is exactly 'bug-report'. By
 * default only status='new' (unhandled) requests are returned so that
 * `bin/run-ai` processes the FIFO queue of work still to do. Pass
 * `{ includeAll: true }` to include handled/waiting/processing ones as
 * well — used by administrative listings (`bin/requests --all`). Results
 * are ordered oldest-first.
 */
export function listUnhandledRequests(
  inboxes: readonly string[],
  options: { includeAll?: boolean } = {},
): UnhandledRequest[] {
  const includeAll = options.includeAll === true;
  const out: UnhandledRequest[] = [];
  for (const inbox of inboxes) {
    for (const msg of listInbox(inbox)) {
      if (!includeAll && msg.status !== 'new') continue;
      if (!(msg.topic.endsWith('-request') || msg.topic === 'bug-report')) continue;
      out.push({
        id: msg.id,
        timestamp: msg.timestamp,
        topic: msg.topic,
        status: msg.status,
        subject: msg.subject,
        from: msg.from,
        keywords: msg.keywords,
        inbox,
      });
    }
  }
  out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return out;
}

/**
 * Handling priority of a request topic, lower served first. Mirrors
 * `next_request_id` in `bin/run-ai`: bug reports, then planned feature work,
 * then everything else, with certifications drained last. Keep the two in
 * sync — this is what the lobby shows players as their queue position.
 */
export function requestPriority(topic: MailTopic): number {
  if (topic === 'bug-report') return 0;
  if (topic === 'feature-planning-request' || topic === 'feature-implementation-request') return 1;
  if (topic === 'certification-request') return 3;
  return 2;
}

/** One of the viewing player's open requests, with its queue position. */
export interface OpenRequestInfo {
  /** Message ID. */
  readonly id: string;
  /** Subject line. */
  readonly subject: string;
  /** Message topic. */
  readonly topic: MailTopic;
  /** Current lifecycle status. */
  readonly status: MailStatus;
  /** ISO 8601 timestamp of when the request was filed. */
  readonly timestamp: string;
  /** Number of open requests (any player's) served before this one. */
  readonly ahead: number;
}

/**
 * From the global request listing, pick the viewing player's open requests
 * and record each one's queue position. Pure core of
 * {@link listOpenRequests}, split out for tests. Open means status 'new' —
 * the unhandled queue exactly as `bin/requests` lists it. `ahead` counts
 * every open request served before that one, whoever filed it, in the
 * {@link requestPriority} order `bin/run-ai` drains the queue in — bug
 * reports jump ahead, certifications fall behind, arrival order decides
 * within a tier.
 */
export function annotateOpenRequests(
  all: readonly UnhandledRequest[],
  mineIds: ReadonlySet<string>,
): OpenRequestInfo[] {
  return all
    .filter(r => r.status === 'new')
    .map((r, index) => ({ r, index }))
    .sort((a, b) => (requestPriority(a.r.topic) - requestPriority(b.r.topic)) || (a.index - b.index))
    .map(({ r }, rank) => ({
      id: r.id,
      subject: r.subject,
      topic: r.topic,
      status: r.status,
      timestamp: r.timestamp,
      ahead: rank,
    }))
    .filter(r => mineIds.has(r.id));
}

/**
 * List the viewing player's open requests, oldest first, each with the
 * number of requests queued before it (same order as `bin/requests`).
 * Ownership is derived from the player's sent folder, which holds a copy of
 * every request they filed (see {@link sendMail}).
 */
export function listOpenRequests(playerName: string): OpenRequestInfo[] {
  const mineIds = new Set(listSent(playerName).map(m => m.id));
  return annotateOpenRequests(listUnhandledRequests(['ai', 'admin']), mineIds);
}

/**
 * Count messages in a player's inbox that need attention: status 'new', plus
 * review-requests in 'waiting' state (the reviewer still has to approve/decline).
 */
export function countUnread(playerName: string): number {
  const dir = inboxDir(playerName);
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    let count = 0;
    for (const f of files) {
      try {
        const msg = loadMail(path.join(dir, f));
        if (msg.status === 'new') count++;
        else if (msg.topic === 'review-request' && msg.status === 'waiting') count++;
      } catch {
        // Skip malformed files
      }
    }
    return count;
  } catch {
    return 0;
  }
}
