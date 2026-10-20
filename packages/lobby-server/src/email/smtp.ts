/**
 * @module email/smtp
 *
 * Outgoing email over SMTP via nodemailer, configured from
 * {@link MAIL_CONFIG}. The transport is created lazily on first send.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { MAIL_CONFIG } from '../config.js';

/** A plain-text email to one recipient. */
export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

let transporter: Transporter | null = null;

/** Whether outgoing email is configured. */
export function isEmailEnabled(): boolean {
  return Boolean(MAIL_CONFIG.service ?? MAIL_CONFIG.host);
}

function getTransporter(): Transporter {
  if (!transporter) {
    const auth = MAIL_CONFIG.user ? { user: MAIL_CONFIG.user, pass: MAIL_CONFIG.pass } : undefined;
    transporter = MAIL_CONFIG.service
      ? nodemailer.createTransport({ service: MAIL_CONFIG.service, auth })
      : nodemailer.createTransport({ host: MAIL_CONFIG.host, port: MAIL_CONFIG.port ?? 587, auth });
  }
  return transporter;
}

/** Send an email. Throws if email is not configured or the SMTP server rejects it. */
export async function sendEmail(email: OutgoingEmail): Promise<void> {
  if (!isEmailEnabled()) throw new Error('Outgoing email is not configured (set MAIL_SERVICE or MAIL_HOST)');
  await getTransporter().sendMail({ from: MAIL_CONFIG.from, ...email });
}
