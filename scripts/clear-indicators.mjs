import http from 'node:http';
import net from 'node:net';
import process from 'node:process';
import { spawn } from 'node:child_process';

const DEFAULT_PORT = 5173;
const PORT_SCAN_LIMIT = 10;
const TEMP_PATH = '/__clear-indicators__';
const STORAGE_KEY = 'clipvis.info.data.orbs';

const checkOnly = process.argv.includes('--check');
const targetOrigin = await detectClipVisOrigin();
const targetUrl = `${targetOrigin}/?clearIndicators=1`;

if (checkOnly) {
  console.log(`[clear:indicators] target ${targetUrl}`);
  process.exit(0);
}

if (await isClipVisServer(new URL(targetOrigin).port || String(DEFAULT_PORT))) {
  console.log(`[clear:indicators] Opening ${targetUrl}`);
  openUrl(targetUrl);
  process.exit(0);
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Clear ClipVIS indicators</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #020617;
        color: #e2e8f0;
        font-family: ui-sans-serif, system-ui, sans-serif;
      }
      main {
        max-width: 560px;
        padding: 24px;
        text-align: center;
      }
      a {
        color: #67e8f9;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Indicators cleared</h1>
      <p>Saved orbs were removed from browser storage for <strong>${targetOrigin}</strong>.</p>
      <p>You can close this tab and run ClipVIS again.</p>
    </main>
    <script>
      localStorage.removeItem(${JSON.stringify(STORAGE_KEY)});
      fetch('/done', { method: 'POST' }).catch(() => {});
    </script>
  </body>
</html>`;

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400).end('Missing URL');
    return;
  }
  if (req.method === 'GET' && (req.url === '/' || req.url === TEMP_PATH)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (req.method === 'POST' && req.url === '/done') {
    res.writeHead(204).end();
    setTimeout(() => server.close(), 250);
    return;
  }
  res.writeHead(404).end('Not found');
});

server.listen(DEFAULT_PORT, '127.0.0.1', () => {
  const tempUrl = `http://localhost:${DEFAULT_PORT}${TEMP_PATH}`;
  console.log(`[clear:indicators] Temporary reset server ready at ${tempUrl}`);
  openUrl(tempUrl);
});

server.on('close', () => {
  console.log('[clear:indicators] Done');
  process.exit(0);
});

server.on('error', (error) => {
  console.error('[clear:indicators] Failed to start reset server', error);
  process.exit(1);
});

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: Number(port), host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function openUrl(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true });
    return;
  }
  if (process.platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true });
    return;
  }
  spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
}

async function detectClipVisOrigin() {
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + PORT_SCAN_LIMIT; port++) {
    if (!(await isPortInUse(port))) continue;
    if (await isClipVisServer(port)) return `http://localhost:${port}`;
  }
  return `http://localhost:${DEFAULT_PORT}`;
}

function isClipVisServer(port) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port: Number(port),
        path: '/',
        timeout: 1000,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 8192) res.destroy();
        });
        res.on('end', () => resolve(looksLikeClipVis(body)));
        res.on('close', () => resolve(looksLikeClipVis(body)));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

function looksLikeClipVis(body) {
  return body.includes('ClipV.I.S.') || body.includes('/src/main.ts') || body.includes('Gesture');
}
