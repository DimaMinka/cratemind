import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')) as {
  version?: string;
};
const appVersion = rootPkg.version || '0.1.0';

function resolveBuildHash(): string {
  const stamp = Date.now().toString(36).slice(-4);
  try {
    const gitHash = execSync('git rev-parse --short HEAD', {
      cwd: path.resolve(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString('utf8')
      .trim();
    if (gitHash) return `${gitHash}-${stamp}`;
  } catch {
    // Fallback when git metadata is unavailable
  }
  return `build-${stamp}`;
}

const buildHash = resolveBuildHash();
const outDir = path.resolve(__dirname, '../dist/pocket-web');

function writeVersionJsonPlugin(): Plugin {
  return {
    name: 'cratemind-pocket-version-json',
    closeBundle() {
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(outDir, 'version.json'),
        JSON.stringify(
          {
            version: appVersion,
            buildHash,
            builtAt: new Date().toISOString()
          },
          null,
          2
        )
      );
    }
  };
}

export default defineConfig({
  root: __dirname,
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_HASH__: JSON.stringify(buildHash)
  },
  plugins: [
    react(),
    writeVersionJsonPlugin(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: [
        'favicon.ico',
        'favicon.svg',
        'icons/apple-touch-icon.png',
        'icons/icon-192.png',
        'icons/icon-512.png'
      ],
      manifest: {
        name: 'CrateMind Pocket',
        short_name: 'CrateMind',
        description: 'Offline vibe sorter and audio curation client for CrateMind',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/version\.json$/]
      }
    })
  ],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  }
});
