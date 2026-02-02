import { config } from './config.js';
import { WhatsAppClient } from './whatsapp/client.js';
import { Orchestrator } from './ai/orchestrator.js';

let processing = false;

async function main() {
  const whatsapp = new WhatsAppClient(config.AUTHORIZED_CHAT);
  let currentSender: string | null = null;

  const orchestrator = new Orchestrator({
    onStatusMessage: async (message) => {
      if (currentSender) {
        try {
          await whatsapp.sendMessage(currentSender, message);
        } catch (err) {
          console.error('Failed to send status message:', err);
        }
      }
    },
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    whatsapp.disconnect();
    await orchestrator.shutdown();
    console.log('Cleanup complete.');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  whatsapp.onMessage(async (sender, text) => {
    if (processing) {
      await whatsapp.sendMessage(sender, 'Already working on a task. Please wait.');
      return;
    }

    processing = true;
    currentSender = sender;

    try {
      await whatsapp.sendMessage(sender, 'Working on it...');
      const reply = await orchestrator.handleRequest(text);
      await whatsapp.sendMessage(sender, reply);
    } catch (err: any) {
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

  console.log('Starting MCP servers...');
  await orchestrator.start();

  console.log('Connecting WhatsApp...');
  await whatsapp.connect();

  console.log('Dev Bot ready. Waiting for messages...');
}

main().catch(console.error);
