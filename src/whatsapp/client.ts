import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WAMessage,
} from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { createComponentLogger } from '../logger.js';

export type MessageHandler = (sender: string, text: string, raw: WAMessage) => void;

export class WhatsAppClient {
  private socket: ReturnType<typeof makeWASocket> | null = null;
  private messageHandler: MessageHandler | null = null;
  private authorizedChat: string;
  private logger = createComponentLogger('whatsapp');

  constructor(authorizedChat: string) {
    this.authorizedChat = authorizedChat;
  }

  async connect(): Promise<void> {
    this.logger.info('Connecting to WhatsApp...');

    // Close previous socket to avoid connectionReplaced loops
    if (this.socket) {
      this.logger.info('Closing previous socket');
      this.socket.ev.removeAllListeners('connection.update');
      this.socket.ev.removeAllListeners('messages.upsert');
      this.socket.ev.removeAllListeners('creds.update');
      this.socket.end(undefined);
      this.socket = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

    this.socket = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }) as any,
    });

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.logger.info('QR code generated for authentication');
        console.log('\nScan this QR code with WhatsApp:\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const error = lastDisconnect?.error as Boom | undefined;
        const statusCode = error?.output?.statusCode;
        const shouldReconnect =
          statusCode !== DisconnectReason.loggedOut &&
          statusCode !== DisconnectReason.connectionReplaced;

        const reason = DisconnectReason[statusCode ?? 0] ?? statusCode;
        this.logger.warn({ reason, statusCode }, 'Connection closed');
        console.log(`Connection closed. Reason: ${reason}`);

        if (shouldReconnect) {
          this.logger.info('Attempting to reconnect...');
          console.log('Reconnecting...');
          this.connect();
        } else if (statusCode === DisconnectReason.connectionReplaced) {
          this.logger.warn('Connection replaced by another session');
          console.log('Connection replaced by another session. Not reconnecting.');
        } else {
          this.logger.warn('Logged out - re-authentication required');
          console.log('Logged out. Delete ./auth_info and restart to re-authenticate.');
        }
      }

      if (connection === 'open') {
        this.logger.info('WhatsApp connected successfully');
        console.log('WhatsApp connected!');
      }
    });

    this.socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;

        const sender = msg.key.remoteJid;
        if (!sender) continue;

        // In groups, allow our own messages (we're sending commands to the bot)
        const isGroup = sender.endsWith('@g.us');
        if (!isGroup && msg.key.fromMe) continue;

        // Filter to authorized chat only (skip filter if not configured)
        if (this.authorizedChat && sender !== this.authorizedChat) {
          this.logger.debug({ sender }, 'Message from unauthorized chat - ignored');
          continue;
        }

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          '';

        if (text && this.messageHandler) {
          this.logger.info({ sender, messageLength: text.length }, 'Incoming message');
          this.messageHandler(sender, text, msg);
        }
      }
    });
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.socket) {
      this.logger.error('Cannot send message - WhatsApp not connected');
      throw new Error('WhatsApp not connected');
    }
    this.logger.info({ jid, messageLength: text.length }, 'Sending message');
    await this.socket.sendMessage(jid, { text });
    this.logger.debug({ jid }, 'Message sent successfully');
  }

  disconnect(): void {
    if (this.socket) {
      this.logger.info('Disconnecting from WhatsApp');
      this.socket.ev.removeAllListeners('connection.update');
      this.socket.ev.removeAllListeners('messages.upsert');
      this.socket.ev.removeAllListeners('creds.update');
      this.socket.end(undefined);
      this.socket = null;
      this.logger.info('Disconnected successfully');
    }
  }
}
