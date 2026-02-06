import { config } from './config.js';
import { WhatsAppClient } from './whatsapp/client.js';
import { Orchestrator } from './ai/orchestrator.js';
import { logger } from './logger.js';

let processing = false;

async function main() {
  logger.info('Starting Dev Bot...');
  logger.info(`Listening to: ${config.AUTHORIZED_CHAT || 'ALL chats (no filter)'}`);

  const whatsapp = new WhatsAppClient(config.AUTHORIZED_CHAT);
  let currentSender: string | null = null;

  const orchestrator = new Orchestrator({
    onStatusMessage: async (message) => {
      if (currentSender) {
        try {
          await whatsapp.sendMessage(currentSender, message);
        } catch (err) {
          logger.error({ err }, 'Failed to send status message');
          console.error('Failed to send status message:', err);
        }
      }
    },
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    console.log('\nShutting down...');
    whatsapp.disconnect();
    await orchestrator.shutdown();
    logger.info('Cleanup complete');
    console.log('Cleanup complete.');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  whatsapp.onMessage(async (sender, text) => {
    if (processing) {
      logger.warn({ sender }, 'Request rejected: already processing');
      await whatsapp.sendMessage(sender, 'Already working on a task. Please wait.');
      return;
    }

    processing = true;
    currentSender = sender;

    logger.info({ sender, message: text }, 'New request received');

    try {
      await whatsapp.sendMessage(sender, 'Working on it...');
      const reply = await orchestrator.handleRequest(text);
      await whatsapp.sendMessage(sender, reply);
      logger.info({ sender }, 'Request completed successfully');
    } catch (err: any) {
      logger.error({ err, sender }, 'Request failed');
      console.error('Request failed:', err);
      await whatsapp.sendMessage(sender, `Error: ${err.message}`);
    } finally {
      processing = false;
      currentSender = null;
    }
  });

  // Start MCP servers first (avoids WhatsApp connection race)
  console.log('Starting Dev Bot...');
  console.log(`Listening to: ${config.AUTHORIZED_CHAT || 'ALL chats (no filter)'}`);

  logger.info('Starting MCP servers...');
  console.log('Starting MCP servers...');
  await orchestrator.start();

  logger.info('Connecting WhatsApp...');
  console.log('Connecting WhatsApp...');
  await whatsapp.connect();

  logger.info('Dev Bot ready. Waiting for messages...');
  console.log('Dev Bot ready. Waiting for messages...');
}

main().catch(console.error);
