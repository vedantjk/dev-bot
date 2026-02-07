import { config } from './config.js';
import { WhatsAppClient } from './whatsapp/client.js';
import { Orchestrator } from './ai/orchestrator.js';
import { logger } from './logger.js';

let processing = false;
let pendingQuestionId: string | null = null;

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
    onUserQuestion: async (question, questionId) => {
      if (currentSender) {
        pendingQuestionId = questionId;
        try {
          await whatsapp.sendMessage(currentSender, `❓ ${question}`);
          logger.info({ questionId, question }, 'User question sent');
        } catch (err) {
          logger.error({ err, questionId }, 'Failed to send user question');
          console.error('Failed to send user question:', err);
        }
      }
    },
    onUserQuestionAnswered: async (questionId, answer) => {
      logger.info({ questionId, answer }, 'User question answered');
      pendingQuestionId = null;
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
    // If there's a pending question, treat this message as an answer
    if (pendingQuestionId && sender === currentSender) {
      logger.info({ sender, questionId: pendingQuestionId, answer: text }, 'Answering pending question');
      orchestrator.answerQuestion(pendingQuestionId, text);
      return;
    }

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
      pendingQuestionId = null;
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
