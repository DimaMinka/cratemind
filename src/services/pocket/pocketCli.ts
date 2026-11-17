import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PocketBridgeService } from './PocketBridgeService.js';

/**
 * Discovers the local Wi-Fi or primary Ethernet IPv4 address from network interfaces.
 */
export function getLocalNetworkIp(): string {
  const interfaces = os.networkInterfaces();

  // Priority check for common macOS/Linux physical network interfaces
  const preferredInterfaces = ['en0', 'en1', 'eth0', 'wlan0'];
  for (const name of preferredInterfaces) {
    const ifaceList = interfaces[name];
    if (ifaceList) {
      for (const iface of ifaceList) {
        if (!iface.internal && iface.family === 'IPv4') {
          return iface.address;
        }
      }
    }
  }

  // General check across all active interfaces
  for (const [name, ifaceList] of Object.entries(interfaces)) {
    if (
      !ifaceList ||
      name.startsWith('awdl') ||
      name.startsWith('llw') ||
      name.startsWith('utun')
    ) {
      continue;
    }
    for (const iface of ifaceList) {
      if (!iface.internal && iface.family === 'IPv4') {
        return iface.address;
      }
    }
  }

  return '127.0.0.1';
}

/**
 * Renders the 65-character wide ASCII box terminal banner.
 */
export function renderBanner(localUrl: string, networkUrl: string): void {
  const width = 63;
  const top = '╔' + '═'.repeat(width) + '╗';
  const mid = '╠' + '═'.repeat(width) + '╣';
  const bot = '╚' + '═'.repeat(width) + '╝';

  function row(text = ''): string {
    const pad = Math.max(0, width - text.length - 2);
    return '║  ' + text + ' '.repeat(pad) + '║';
  }

  function centerRow(text = ''): string {
    const totalPad = Math.max(0, width - text.length);
    const leftPad = Math.floor(totalPad / 2);
    const rightPad = totalPad - leftPad;
    return '║' + ' '.repeat(leftPad) + text + ' '.repeat(rightPad) + '║';
  }

  console.log(top);
  console.log(centerRow('★ CRATEMIND POCKET BRIDGE'));
  console.log(mid);
  console.log(row(`Local URL:    ${localUrl}`));
  console.log(row(`Network URL:  ${networkUrl}`));
  console.log(row(''));
  console.log(row('Open the Network URL in Safari on your iPhone to sort.'));
  console.log(row('Press Ctrl+C to terminate the bridge.'));
  console.log(bot);
}

/**
 * Standalone CLI runner entrypoint.
 */
export async function runPocketCli(): Promise<void> {
  const port = process.env.POCKET_PORT ? parseInt(process.env.POCKET_PORT, 10) : 8080;
  const host = '0.0.0.0';
  const lanIp = getLocalNetworkIp();

  const bridge = new PocketBridgeService({ port, host });
  const { port: actualPort } = await bridge.start();

  const localUrl = `http://localhost:${actualPort}`;
  const networkUrl = `http://${lanIp}:${actualPort}`;

  renderBanner(localUrl, networkUrl);

  const shutdown = async () => {
    console.log('\nStopping CrateMind Pocket Bridge...');
    await bridge.stop();
    console.log('Bridge stopped cleanly. Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runPocketCli().catch((err) => {
    console.error('Failed to start CrateMind Pocket Bridge:', err);
    process.exit(1);
  });
}
