import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { useStore } from './UIService.js';
import * as EngineDBService from './EngineDBService.js';
import {
  INCOMING_DIR,
  AUDIO_EXTENSIONS,
  MOCK_MODE,
  BATCH_SIZE,
  FOLDERS,
  SORTED_DIR
} from '../config.js';

const apiId = parseInt((process.env.TELEGRAM_API_ID || '0').replace(/^["']|["']$/g, ''), 10);
const apiHash = (process.env.TELEGRAM_API_HASH || '').replace(/^["']|["']$/g, '');
const sessionString = (process.env.TELEGRAM_SESSION_STRING || '').replace(/^["']|["']$/g, '');
const chatsStr = (process.env.TELEGRAM_CHATS || '').replace(/^["']|["']$/g, '');

const HISTORY_FILE = './.telegram-history.json';

let client: TelegramClient | null = null;
let isDownloading = false;

// Load or initialize download history
function getHistory(): Record<string, number> {
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveHistory(history: Record<string, number>) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

function existsInSorted(filename: string): boolean {
  if (fs.existsSync(path.join(SORTED_DIR, 'skipped', filename))) {
    return true;
  }
  for (const folder of FOLDERS) {
    const filePath = path.join(SORTED_DIR, folder, filename);
    if (fs.existsSync(filePath)) {
      return true;
    }
  }
  return false;
}

export async function connect(): Promise<boolean> {
  if (MOCK_MODE) {
    useStore.getState().addLog('SYSTEM', 'MOCK MODE: Skipping real Telegram connection');
    return true;
  }

  if (!apiId || !apiHash || !sessionString) {
    useStore
      .getState()
      .addLog(
        'ERROR',
        'Telegram credentials missing in .env. Please run `npm run telegram-login` to authenticate.'
      );
    return false;
  }

  if (client) return true;

  try {
    const stringSession = new StringSession(sessionString);
    client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5
    });

    useStore.getState().addLog('SYSTEM', 'Connecting to Telegram...');
    await client.connect();
    useStore.getState().addLog('SYSTEM', 'Connected to Telegram successfully.');
    return true;
  } catch (err) {
    useStore.getState().addLog('ERROR', `Failed to connect to Telegram: ${err}`);
    return false;
  }
}

export async function downloadBulk(): Promise<void> {
  const addLog = useStore.getState().addLog;

  if (isDownloading) {
    addLog('SYSTEM', 'Telegram download is already in progress.');
    return;
  }

  if (!chatsStr) {
    addLog('ERROR', 'No Telegram chats configured in .env (TELEGRAM_CHATS)');
    return;
  }

  if (!(await connect()) || !client) return;

  isDownloading = true;
  useStore.getState().setTelegramDownloading(true);
  const history = getHistory();
  const chats = chatsStr
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  try {
    addLog('SYSTEM', 'Resolving Telegram chat details...');
    await client.getDialogs();

    for (const chat of chats) {
      const isNumeric = /^-?\d+$/.test(chat);
      const peer = isNumeric ? BigInt(chat) : chat;

      addLog('SYSTEM', `Scanning Telegram chat: ${chat}...`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let targetEntity: any;
      try {
        targetEntity = await client.getEntity(peer as unknown as string);
      } catch (entityErr) {
        addLog('ERROR', `Failed to resolve Telegram entity for ${chat}: ${entityErr}`);
        continue;
      }

      const lastMessageId = history[chat] || 0;
      let limitLeft = calculateRemainingTracks();

      if (limitLeft <= 0) {
        addLog('SYSTEM', 'Daily API limit reached. Stopping Telegram download.');
        break;
      }

      let offsetId = 0;
      let downloadedInChat = 0;
      let keepFetching = true;

      // We need to fetch messages starting from the latest, until we hit lastMessageId
      // Alternatively, we can use `minId` to only fetch messages newer than `lastMessageId`.
      while (keepFetching && limitLeft > 0) {
        const messages = await client.getMessages(targetEntity, {
          limit: 20,
          minId: lastMessageId, // Only messages newer than this
          offsetId: offsetId // For pagination (starts at 0)
        });

        if (messages.length === 0) {
          addLog('SYSTEM', `No new messages in ${chat}.`);
          break;
        }

        // Process from oldest to newest so history advances logically
        const sortedMessages = messages.sort((a, b) => a.id - b.id);

        for (const msg of sortedMessages) {
          if (limitLeft <= 0) break;

          const updateAndSaveHistory = () => {
            history[chat] = Math.max(history[chat] || 0, msg.id);
            saveHistory(history);
          };

          if (!(msg.media && msg.document)) {
            updateAndSaveHistory();
            continue;
          }

          const getAttr = (className: string) =>
            msg.document?.attributes.find(
              (attr: unknown) => (attr as { className?: string }).className === className
            ) as { fileName?: string; title?: string; performer?: string } | undefined;

          const fileNameAttr = getAttr('DocumentAttributeFilename');
          const audioAttr = getAttr('DocumentAttributeAudio');

          let filename = '';
          if (fileNameAttr) {
            filename = fileNameAttr.fileName || '';
          } else if (audioAttr) {
            const title = audioAttr.title || 'Unknown';
            const performer = audioAttr.performer || 'Unknown';
            filename = `${performer} - ${title}.mp3`;
          }

          if (!filename) {
            updateAndSaveHistory();
            continue;
          }

          // Ensure valid audio extension
          const ext = path.extname(filename).toLowerCase();
          if (!(AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
            updateAndSaveHistory();
            continue;
          }

          // Deduplication checks
          const incomingPath = path.join(INCOMING_DIR, filename);
          const existsInIncoming = fs.existsSync(incomingPath);
          const existsInSortedDir = existsInSorted(filename);
          const existsInDB = EngineDBService.isAvailable()
            ? EngineDBService.getTrackByFilename(filename)
            : null;

          if (existsInIncoming || existsInSortedDir || existsInDB) {
            addLog('SYSTEM', `Telegram: Skipping ${filename} (Already in library/incoming/sorted)`);
            updateAndSaveHistory();
            continue;
          }

          // Download
          addLog('SYSTEM', `Downloading from Telegram: ${filename}...`);
          let lastProgressPercent = 0;
          const buffer = await client.downloadMedia(msg, {
            progressCallback: (downloadedBytes: unknown, totalBytes: unknown) => {
              if (!totalBytes) return;
              const d = Number(downloadedBytes);
              const t = Number(totalBytes);
              const percent = Math.round((d / t) * 100);
              if (percent - lastProgressPercent >= 25 || percent === 100) {
                lastProgressPercent = percent;
                addLog(
                  'SYSTEM',
                  `Downloading ${filename}: ${percent}% (${(d / 1024 / 1024).toFixed(1)} MB / ${(t / 1024 / 1024).toFixed(1)} MB)`
                );
              }
            }
          });
          if (buffer) {
            if (!fs.existsSync(INCOMING_DIR)) {
              fs.mkdirSync(INCOMING_DIR, { recursive: true });
            }
            fs.writeFileSync(incomingPath, buffer);
            downloadedInChat++;
            limitLeft--;
            updateAndSaveHistory();
          }
        }

        // Pagination setup
        offsetId = messages[messages.length - 1].id;
      }

      addLog('SYSTEM', `Finished ${chat}. Downloaded: ${downloadedInChat} tracks.`);
    }
  } catch (err) {
    addLog('ERROR', `Error during Telegram download: ${err}`);
  } finally {
    isDownloading = false;
    useStore.getState().setTelegramDownloading(false);
    saveHistory(history);
  }
}

function calculateRemainingTracks(): number {
  if (MOCK_MODE) return 10;
  const storeState = useStore.getState();
  const limit = storeState.dailyRequestsLimit;
  const used = storeState.dailyRequestsUsed;

  if (used >= limit) return 0;
  return (limit - used) * BATCH_SIZE;
}
