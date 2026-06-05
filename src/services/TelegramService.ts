import { TelegramClient, Api } from 'telegram';
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

interface ChatHistory {
  lastMessageId: number;
  backfillOffsetId: number;
}
type HistoryRecord = Record<string, number | ChatHistory>;

const HISTORY_FILE = './.telegram-history.json';

let client: TelegramClient | null = null;
let isDownloading = false;

// Load or initialize download history
function getHistory(): HistoryRecord {
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveHistory(history: HistoryRecord) {
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

async function processMessageBatch(
  messages: Api.Message[],
  chat: string,
  activeHistory: ChatHistory,
  history: HistoryRecord,
  ctx: { limitLeft: number; downloadedInChat: number }
): Promise<void> {
  const addLog = useStore.getState().addLog;
  for (const msg of messages) {
    if (ctx.limitLeft <= 0) break;

    const updateAndSaveHistory = () => {
      activeHistory.lastMessageId = Math.max(activeHistory.lastMessageId, msg.id);
      history[chat] = activeHistory;
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
      updateAndSaveHistory();
      continue;
    }

    // Download
    addLog('SYSTEM', `Downloading from Telegram: ${filename}...`);
    let lastProgressPercent = 0;
    const buffer = await client!.downloadMedia(msg, {
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
      ctx.downloadedInChat++;
      ctx.limitLeft--;
      updateAndSaveHistory();
    }
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

      try {
        await client.getEntity(peer as unknown as string);
      } catch (entityErr) {
        addLog('ERROR', `Failed to resolve Telegram entity for ${chat}: ${entityErr}`);
        continue;
      }

      let limitLeft = calculateRemainingTracks();

      if (limitLeft <= 0) {
        addLog('SYSTEM', 'Daily API limit reached. Stopping Telegram download.');
        break;
      }

      let chatHistory = history[chat];
      if (typeof chatHistory === 'number') {
        chatHistory = { lastMessageId: chatHistory, backfillOffsetId: 0 };
      } else if (!chatHistory) {
        chatHistory = { lastMessageId: 0, backfillOffsetId: 0 };
      }
      const activeHistory: ChatHistory = chatHistory;
      history[chat] = activeHistory;

      const ctx = { limitLeft, downloadedInChat: 0 };

      // --- PHASE 1: Fetch New Messages ---
      if (activeHistory.lastMessageId > 0) {
        addLog(
          'SYSTEM',
          `Telegram: Checking for new messages in ${chat} (since ID ${activeHistory.lastMessageId})...`
        );
        let newOffsetId = 0;
        while (ctx.limitLeft > 0) {
          const messages = await client.getMessages(peer as unknown as string, {
            limit: 100,
            minId: activeHistory.lastMessageId,
            offsetId: newOffsetId
          });

          if (messages.length === 0) {
            break;
          }

          await processMessageBatch(messages, chat, activeHistory, history, ctx);
          newOffsetId = messages[messages.length - 1].id;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      // --- PHASE 2: Backfill Old Messages ---
      if (activeHistory.backfillOffsetId !== -1 && ctx.limitLeft > 0) {
        addLog(
          'SYSTEM',
          `Telegram: Resuming historical backfill in ${chat} (from ID ${activeHistory.backfillOffsetId || 'latest'})...`
        );
        let totalChecked = 0;
        while (ctx.limitLeft > 0) {
          const messages = await client.getMessages(peer as unknown as string, {
            limit: 100,
            offsetId: activeHistory.backfillOffsetId || 0
          });

          if (messages.length === 0) {
            addLog('SYSTEM', `Reached the end of history for ${chat}. Backfill complete.`);
            activeHistory.backfillOffsetId = -1;
            saveHistory(history);
            break;
          }

          totalChecked += messages.length;
          addLog(
            'SYSTEM',
            `Telegram: Backfilling... Checked ${totalChecked} older messages (current offset: ${messages[messages.length - 1].id}).`
          );

          await processMessageBatch(messages, chat, activeHistory, history, ctx);

          activeHistory.backfillOffsetId = messages[messages.length - 1].id;
          saveHistory(history);

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      limitLeft = ctx.limitLeft;

      addLog('SYSTEM', `Finished ${chat}. Downloaded: ${ctx.downloadedInChat} tracks.`);
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
