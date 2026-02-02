import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WAMessage,
} from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

export type MessageHandler = (sender: string, text: string, raw: WAMessage) => void;

export class WhatsAppClient {
  private socket: ReturnType<typeof makeWASocket> | null = null;
  private messageHandler: MessageHandler | null = null;
  private authorizedChat: string;

  constructor(authorizedChat: string) {
    this.authorizedChat = authorizedChat;
  }

  async connect(): Promise<void> {
    // Close previous socket to avoid connectionReplaced loops
    if (this.socket) {
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
        console.log('\nScan this QR code with WhatsApp:\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const error = lastDisconnect?.error as Boom | undefined;
        const statusCode = error?.output?.statusCode;
        const shouldReconnect =
          statusCode !== DisconnectReason.loggedOut &&
          statusCode !== DisconnectReason.connectionReplaced;

        console.log(
          `Connection closed. Reason: ${DisconnectReason[statusCode ?? 0] ?? statusCode}`,
        );

        if (shouldReconnect) {
          console.log('Reconnecting...');
          this.connect();
        } else if (statusCode === DisconnectReason.connectionReplaced) {
          console.log('Connection replaced by another session. Not reconnecting.');
        } else {
          console.log('Logged out. Delete ./auth_info and restart to re-authenticate.');
        }
      }

      if (connection === 'open') {
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
          continue;
        }

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          '';

        if (text && this.messageHandler) {
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
      throw new Error('WhatsApp not connected');
    }
    await this.socket.sendMessage(jid, { text });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.ev.removeAllListeners('connection.update');
      this.socket.ev.removeAllListeners('messages.upsert');
      this.socket.ev.removeAllListeners('creds.update');
      this.socket.end(undefined);
      this.socket = null;
    }
  }
}
