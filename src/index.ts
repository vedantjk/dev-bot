import { config } from './config.js';
import { WhatsAppClient } from './whatsapp/client.js';

async function main() {
  const client = new WhatsAppClient(config.AUTHORIZED_CHAT);

  client.onMessage((sender, text, raw) => {
    const isGroup = sender.endsWith('@g.us');
    const participant = raw.key.participant || sender;

    console.log(`\n--- New Message ---`);
    console.log(`Chat:        ${sender}${isGroup ? ' (group)' : ' (DM)'}`);
    if (isGroup) {
      console.log(`Participant: ${participant}`);
    }
    console.log(`Text:        ${text}`);
    console.log(`Time:        ${new Date().toLocaleTimeString()}`);
    console.log(`-------------------\n`);
  });

  console.log('Starting WhatsApp bot...');
  console.log(`Listening to: ${config.AUTHORIZED_CHAT || 'ALL chats (no filter)'}`);
  console.log('Waiting for connection...\n');

  await client.connect();
}

main().catch(console.error);
