const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 4173;
const SRC_DIR = path.join(__dirname, 'src');
const DATA_FILE = path.join(__dirname, 'omnispell_local_db.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/speak' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { text, rate = 0 } = JSON.parse(body || '{}');
        const safeText = String(text || '').replace(/'/g, "''");
        const psScript = `Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Rate = ${Number(rate) || 0}; $synth.Speak('${safeText}');`;
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { windowsHide: true }, () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/db') {
    if (req.method === 'GET') {
      if (fs.existsSync(DATA_FILE)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(fs.readFileSync(DATA_FILE, 'utf-8'));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('null');
      }
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        fs.writeFileSync(DATA_FILE, body, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
  }

  let filePath = path.join(SRC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(SRC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`OMNISPELL running at http://localhost:${PORT}`);
});
