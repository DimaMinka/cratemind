import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
// @ts-expect-error: input package lacks TypeScript declaration files
import * as input from 'input';
import * as fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const apiId = parseInt((process.env.TELEGRAM_API_ID || '').replace(/^["']|["']$/g, ''), 10);
const apiHash = (process.env.TELEGRAM_API_HASH || '').replace(/^["']|["']$/g, '');

async function run() {
  if (!apiId || !apiHash) {
    console.error(
      'ERROR: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env before logging in.'
    );
    process.exit(1);
  }

  console.log('Connecting to Telegram for interactive login...');
  const stringSession = new StringSession('');
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5
  });

  await client.start({
    phoneNumber: async () => await input.text('Enter your phone number (e.g. +123456789): '),
    password: async () => await input.text('Enter your 2FA password (if enabled): '),
    phoneCode: async () => await input.text('Enter the code you received from Telegram: '),
    forceSMS: false,
    onError: (err) => console.error('Telegram Login Error:', err)
  });

  const sessionStr = client.session.save() as unknown as string;
  console.log('\n--- LOGIN SUCCESSFUL ---');
  console.log('Generated Session String:\n', sessionStr);
  console.log('------------------------\n');

  // Read .env and update or append TELEGRAM_SESSION_STRING
  let envContent = '';
  if (fs.existsSync('.env')) {
    envContent = fs.readFileSync('.env', 'utf-8');
  }

  const sessionLine = `TELEGRAM_SESSION_STRING="${sessionStr}"`;
  if (envContent.includes('TELEGRAM_SESSION_STRING=')) {
    envContent = envContent.replace(/TELEGRAM_SESSION_STRING=.*/, sessionLine);
  } else {
    envContent += `\n${sessionLine}\n`;
  }

  fs.writeFileSync('.env', envContent, 'utf-8');
  console.log('Updated .env file with the new TELEGRAM_SESSION_STRING.');
  await client.disconnect();
}

run().catch((err) => {
  console.error('Fatal error during interactive login:', err);
  process.exit(1);
});
