import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const certsDir = path.resolve('.pocket-certs');
if (!fs.existsSync(certsDir)) {
  fs.mkdirSync(certsDir, { recursive: true });
}

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '192.168.68.76';
}

const lanIp = getLocalIp();
const keyPath = path.join(certsDir, 'key.pem');
const certPath = path.join(certsDir, 'cert.pem');
const rootCaDest = path.join(certsDir, 'rootCA.pem');

let mkcertSuccess = false;
try {
  execSync(
    `mkcert -key-file "${keyPath}" -cert-file "${certPath}" ${lanIp} localhost 127.0.0.1`,
    { stdio: 'inherit' }
  );
  const caroot = execSync('mkcert -CAROOT', { encoding: 'utf-8' }).trim();
  const carootFile = path.join(caroot, 'rootCA.pem');
  if (fs.existsSync(carootFile)) {
    fs.copyFileSync(carootFile, rootCaDest);
    console.log(`[pocket:certs] Copied rootCA.pem to ${rootCaDest}`);
  }
  mkcertSuccess = true;
  console.log(`[pocket:certs] Successfully generated trusted certificates for ${lanIp}`);
} catch (e) {
  console.warn('[pocket:certs] mkcert is not available or failed, falling back to openssl...');
}

if (!mkcertSuccess) {
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj "/CN=localhost" -keyout "${keyPath}" -out "${certPath}" -days 365`,
      { stdio: 'inherit' }
    );
    console.log(`[pocket:certs] Generated self-signed certificates with openssl`);
  } catch (err) {
    console.error('[pocket:certs] Failed to generate certificates:', err);
    process.exit(1);
  }
}
