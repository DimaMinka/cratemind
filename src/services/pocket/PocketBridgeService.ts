import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { URL } from 'node:url';
import { INCOMING_DIR, SORTED_DIR } from '../../config.js';
import { useStore } from '../UIService.js';
import { getRagTotalExamples } from './pocketDbQueries.js';
import { buildBatchManifest } from './pocketManifestBuilder.js';
import { processCommit, CommitError } from './pocketCommitProcessor.js';
import { streamAudioResponse } from './pocketAudioPreview.js';

export interface PocketBridgeOptions {
  port?: number;
  host?: string;
  incomingDir?: string;
  sortedDir?: string;
  staticDir?: string;
  cacheDir?: string;
  enableHttps?: boolean;
}

export interface PocketBridgeResolvedOptions extends Required<
  Omit<PocketBridgeOptions, 'enableHttps'>
> {
  enableHttps: boolean;
}

const STATIC_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

export class PocketBridgeService {
  private server: http.Server | https.Server | null = null;
  private connections = new Set<net.Socket>();
  private options: PocketBridgeResolvedOptions;
  private port = 0;
  private host = '';
  private isHttps = false;

  constructor(options?: PocketBridgeOptions) {
    this.options = {
      port:
        options?.port ?? (process.env.POCKET_PORT ? parseInt(process.env.POCKET_PORT, 10) : 8080),
      host: options?.host ?? '0.0.0.0',
      incomingDir: options?.incomingDir ?? path.resolve(INCOMING_DIR),
      sortedDir: options?.sortedDir ?? path.resolve(SORTED_DIR),
      staticDir: options?.staticDir ?? path.resolve('dist/pocket-web'),
      cacheDir: options?.cacheDir ?? path.resolve('.pocket-cache/previews'),
      enableHttps: options?.enableHttps ?? process.env.NODE_ENV !== 'test'
    };
  }

  public getPort(): number {
    return this.port;
  }

  public getHost(): string {
    return this.host;
  }

  public getServer(): http.Server | https.Server | null {
    return this.server;
  }

  public getIsHttps(): boolean {
    return this.isHttps;
  }

  public async start(
    port?: number,
    host?: string
  ): Promise<{ server: http.Server | https.Server; port: number; host: string; isHttps: boolean }> {
    if (this.server) {
      return { server: this.server, port: this.port, host: this.host, isHttps: this.isHttps };
    }

    const targetPort = port ?? this.options.port;
    const targetHost = host ?? this.options.host;

    // Check for SSL certificates if enabled
    let sslOptions: { key: Buffer; cert: Buffer } | null = null;
    if (this.options.enableHttps) {
      const envKey = process.env.POCKET_SSL_KEY;
      const envCert = process.env.POCKET_SSL_CERT;
      const localKey = path.resolve('.pocket-certs/key.pem');
      const localCert = path.resolve('.pocket-certs/cert.pem');

      if (envKey && envCert && fs.existsSync(envKey) && fs.existsSync(envCert)) {
        sslOptions = {
          key: fs.readFileSync(envKey),
          cert: fs.readFileSync(envCert)
        };
      } else if (fs.existsSync(localKey) && fs.existsSync(localCert)) {
        sslOptions = {
          key: fs.readFileSync(localKey),
          cert: fs.readFileSync(localCert)
        };
      }
    }

    const requestListener: http.RequestListener = (req, res) => {
      this.handleRequest(req, res).catch((err) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Internal server error',
              message: err instanceof Error ? err.message : String(err)
            })
          );
        }
      });
    };

    if (sslOptions) {
      this.server = https.createServer(sslOptions, requestListener);
      this.isHttps = true;
    } else {
      this.server = http.createServer(requestListener);
      this.isHttps = false;
    }

    this.server.on('connection', (socket) => {
      this.connections.add(socket);
      socket.on('close', () => this.connections.delete(socket));
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(targetPort, targetHost, () => {
        const addr = this.server!.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : targetPort;
        this.port = actualPort;
        this.host = targetHost;
        resolve({
          server: this.server!,
          port: actualPort,
          host: targetHost,
          isHttps: this.isHttps
        });
      });
      this.server!.once('error', reject);
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = null;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Universal CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    if (pathname === '/api/health' && method === 'GET') {
      await this.handleHealth(res);
    } else if (pathname === '/api/cert-ca' && method === 'GET') {
      await this.handleCertCa(res);
    } else if (pathname === '/api/batch' && method === 'GET') {
      await this.handleBatch(res, url);
    } else if (pathname.startsWith('/api/audio/') && method === 'GET') {
      const rawId = pathname.slice('/api/audio/'.length);
      await this.handleAudio(req, res, rawId);
    } else if (pathname === '/api/commit' && method === 'POST') {
      await this.handleCommit(req, res);
    } else if (pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    } else {
      await this.handleStatic(res, pathname);
    }
  }

  private async handleCertCa(res: http.ServerResponse): Promise<void> {
    const rootCaPath = path.resolve('.pocket-certs/rootCA.pem');
    if (fs.existsSync(rootCaPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': 'attachment; filename="cratemind-rootCA.pem"'
      });
      fs.createReadStream(rootCaPath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Root CA not found' }));
    }
  }

  private async handleHealth(res: http.ServerResponse): Promise<void> {
    const state = useStore.getState();
    const isBusy = Boolean(
      state.isTelegramDownloading ||
      state.isIndexingVibes ||
      state.driveSyncProgress?.isActive ||
      state.isLLMAnalyzing
    );
    let activeTask: string | null = null;
    if (state.isTelegramDownloading) activeTask = 'Telegram downloading';
    else if (state.isIndexingVibes) activeTask = 'Vibes indexing';
    else if (state.driveSyncProgress?.isActive) activeTask = 'Drive syncing';
    else if (state.isLLMAnalyzing) activeTask = 'LLM analyzing';

    let incomingCount = 0;
    try {
      if (fs.existsSync(this.options.incomingDir)) {
        const files = await fs.promises.readdir(this.options.incomingDir);
        incomingCount = files.length;
      }
    } catch {
      incomingCount = state.incomingCount;
    }

    const ragCount = getRagTotalExamples();

    let version: string | undefined;
    let buildHash: string | undefined;
    try {
      const versionPath = path.join(this.options.staticDir, 'version.json');
      if (fs.existsSync(versionPath)) {
        const raw = JSON.parse(fs.readFileSync(versionPath, 'utf8')) as {
          version?: string;
          buildHash?: string;
        };
        version = raw.version;
        buildHash = raw.buildHash;
      }
    } catch {
      // Ignore missing or unreadable version.json
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(
      JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        incomingCount,
        ragCount,
        isBusy,
        activeTask,
        ...(version ? { version } : {}),
        ...(buildHash ? { buildHash } : {})
      })
    );
  }

  private async handleBatch(res: http.ServerResponse, url: URL): Promise<void> {
    const limitParam = parseInt(url.searchParams.get('limit') || '30', 10);
    const limit = isNaN(limitParam) ? 30 : Math.min(Math.max(1, limitParam), 30);
    const excludeParam = url.searchParams.get('exclude');
    const excludeList = url.searchParams.getAll('exclude');
    const excludeFilenames =
      excludeParam && excludeParam.includes(',')
        ? excludeParam.split(',').map((s) => s.trim())
        : excludeList.length > 0
          ? excludeList
          : undefined;

    const manifest = await buildBatchManifest({
      incomingDir: this.options.incomingDir,
      sortedDir: this.options.sortedDir,
      limit,
      excludeFilenames
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(manifest));
  }

  private async handleAudio(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    rawId: string
  ): Promise<void> {
    let filename: string;
    try {
      const buffer = Buffer.from(rawId, 'base64url');
      const utf8 = buffer.toString('utf8');
      filename = utf8.length > 0 && !utf8.includes('\0') ? utf8 : decodeURIComponent(rawId);
    } catch {
      filename = decodeURIComponent(rawId);
    }

    if (
      !filename ||
      filename.includes('..') ||
      filename.includes('/') ||
      filename.includes('\\') ||
      filename.includes('\0')
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Invalid audio filename or path traversal detected'
        })
      );
      return;
    }

    const fullPath = path.resolve(this.options.incomingDir, filename);
    const incomingBase = path.resolve(this.options.incomingDir);
    if (!fullPath.startsWith(incomingBase + path.sep) || !fs.existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Audio file not found' }));
      return;
    }

    await streamAudioResponse(fullPath, req, res, {
      cacheDir: this.options.cacheDir
    });
  }

  private async handleCommit(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    let bytesReceived = 0;
    const MAX_BODY_BYTES = 2 * 1024 * 1024;

    for await (const chunk of req) {
      bytesReceived += (chunk as Buffer).length;
      if (bytesReceived > MAX_BODY_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload Too Large' }));
        return;
      }
      chunks.push(chunk as Buffer);
    }

    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Malformed JSON payload' }));
      return;
    }

    try {
      const result = await processCommit(body, {
        incomingDir: this.options.incomingDir,
        sortedDir: this.options.sortedDir
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: unknown) {
      const commitErr = err as CommitError;
      const statusCode = commitErr.statusCode ?? 400;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: commitErr.message ?? 'Commit processing failed',
          activeTask: commitErr.activeTask,
          details: commitErr.issues
        })
      );
    }
  }

  private async handleStatic(res: http.ServerResponse, pathname: string): Promise<void> {
    const staticDir = this.options.staticDir;
    const sanitized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    let targetPath = path.join(staticDir, sanitized);

    if (!targetPath.startsWith(path.resolve(staticDir))) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    try {
      const stat = await fs.promises.stat(targetPath);
      if (stat.isDirectory()) {
        targetPath = path.join(targetPath, 'index.html');
      }
    } catch {
      // Trigger SPA fallback
    }

    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
      const ext = path.extname(targetPath).toLowerCase();
      const mimeType = STATIC_MIME_TYPES[ext] || 'application/octet-stream';
      const normalizedRel = path.relative(staticDir, targetPath).replace(/\\/g, '/');
      const isImmutableAsset = normalizedRel.startsWith('assets/');
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Cache-Control': isImmutableAsset
          ? 'public, max-age=31536000, immutable'
          : 'no-cache, no-store, must-revalidate'
      });
      fs.createReadStream(targetPath).pipe(res);
      return;
    }

    // SPA Fallback: serve index.html for client-side routing
    const indexPath = path.join(staticDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }

    // Friendly placeholder when PWA assets have not yet been compiled
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>★ CRATEMIND POCKET BRIDGE</title></head>
  <body style="background:#000;color:#00ff00;font-family:monospace;padding:2rem;">
    <h1>★ CRATEMIND POCKET BRIDGE</h1>
    <p>Backend daemon is active on port ${this.options.port}.</p>
    <p>PWA assets not found in <code>dist/pocket-web/</code>.</p>
    <p>REST API: <a href="/api/health" style="color:#00ffff">/api/health</a></p>
  </body>
</html>`);
  }
}
