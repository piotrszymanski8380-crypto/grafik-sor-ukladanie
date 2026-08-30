// server.js — pojedynczy, cały czas działający proces Node (Render Web
// Service), zastępujący routing funkcji serverless z poprzedniej wersji
// appki (Vercel). Sam parsuje żądania HTTP, więc pliki w api/*.js działają
// BEZ ZMIAN - jedyna różnica względem Vercela: appka to teraz jeden proces,
// który cały czas trzyma jeden, spójny widok danych (co samo w sobie
// eliminuje bug z niespójnymi odczytami między "instancjami", na jaki
// trafiliśmy na Vercelu bez poprawnie skonfigurowanego trwałego magazynu).
//
// Uruchomienie lokalnie: `npm run dev` (alias na `node server.js`), potem
// http://localhost:3000 - ADMIN_PASSWORD musi być ustawiony w env.
// Na Render: Start Command = `node server.js`, PORT ustawia Render sam.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const API_DIR = path.join(__dirname, 'api');
const PROD = process.env.NODE_ENV === 'production';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function parsujCiastka(req) {
  const wynik = {};
  const naglowek = req.headers.cookie;
  if (!naglowek) return wynik;
  naglowek.split(';').forEach((para) => {
    const i = para.indexOf('=');
    if (i === -1) return;
    wynik[para.slice(0, i).trim()] = decodeURIComponent(para.slice(i + 1).trim());
  });
  return wynik;
}

function augmentuj(req, res, url) {
  req.query = Object.fromEntries(url.searchParams.entries());
  req.cookies = parsujCiastka(req);
  res.status = function (kod) {
    res.statusCode = kod;
    return res;
  };
  res.json = function (obiekt) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obiekt));
  };
}

function wczytajBody(req) {
  return new Promise((resolve) => {
    let dane = '';
    req.on('data', (chunk) => (dane += chunk));
    req.on('end', () => {
      if (!dane) return resolve(undefined);
      try {
        resolve(JSON.parse(dane));
      } catch (e) {
        resolve(undefined);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  augmentuj(req, res, url);

  if (url.pathname.startsWith('/api/')) {
    const nazwa = url.pathname.slice('/api/'.length).split('/')[0];
    const plikHandlera = path.join(API_DIR, nazwa + '.js');
    if (!fs.existsSync(plikHandlera)) {
      res.status(404).json({ error: 'Brak endpointu: ' + url.pathname });
      return;
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      req.body = await wczytajBody(req);
    }
    // W dev czyścimy cache require() na każde żądanie (hot-reload bez
    // restartu serwera); w produkcji zbędne, więc pomijamy dla wydajności.
    if (!PROD) delete require.cache[require.resolve(plikHandlera)];
    try {
      const handler = require(plikHandlera);
      await handler(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).json({ error: 'Błąd serwera: ' + e.message });
    }
    return;
  }

  let sciezka = url.pathname === '/' ? '/index.html' : url.pathname;
  let plik = path.join(PUBLIC_DIR, sciezka);
  if (!plik.startsWith(PUBLIC_DIR)) {
    res.status(403).end('Zabronione');
    return;
  }
  if (!fs.existsSync(plik) || fs.statSync(plik).isDirectory()) {
    res.status(404).end('Nie znaleziono: ' + sciezka);
    return;
  }
  const ext = path.extname(plik);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  fs.createReadStream(plik).pipe(res);
});

server.listen(PORT, () => {
  console.log('Grafik SOR działa na porcie ' + PORT);
  if (!process.env.ADMIN_PASSWORD) {
    console.log('UWAGA: ADMIN_PASSWORD nie jest ustawione — logowanie do panelu admina nie zadziała przy pierwszym starcie.');
  }
  if (!process.env.SESSION_SECRET) {
    console.log('UWAGA: SESSION_SECRET nie jest ustawione — sesje wylogują wszystkich przy każdym redeployu (ustaw stały sekret w env).');
  }
});
