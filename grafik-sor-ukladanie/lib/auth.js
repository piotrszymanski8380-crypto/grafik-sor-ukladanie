// lib/auth.js
//
// Prosty mechanizm sesji - BEZ bazy użytkowników, dwie "role" chronione
// wspólnymi hasłami: admin (pełna edycja) i podglad (opcjonalne hasło do
// publicznego widoku - jeśli nieustawione, podgląd jest otwarty). Hasła są
// haszowane (scrypt + sól) i trzymane w magazynie danych (lib/dostep.js),
// NIE w plikach źródłowych - można je zmieniać z panelu admina bez
// redeployu. Sesje to podpisane ciasteczka (HMAC-SHA256, sekret z
// SESSION_SECRET) - serwer nic nie trzyma w pamięci.

const crypto = require('crypto');

const NAZWA_CIASTKA_ADMIN = 'sor_admin';
const NAZWA_CIASTKA_PODGLAD = 'sor_podglad';
const WAZNOSC_MS = 30 * 24 * 60 * 60 * 1000; // 30 dni

function sekret() {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    // Dev fallback - w produkcji (Render) USTAW SESSION_SECRET w env,
    // inaczej sesje przestaną działać przy każdym redeployu.
    return 'dev-only-insecure-secret-ustaw-SESSION_SECRET-w-produkcji';
  }
  return s;
}

// ---------- hasła (scrypt + sól, bez zależności zewnętrznych) ----------
function hashHaslo(haslo) {
  const sol = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(haslo), sol, 64).toString('hex');
  return sol + ':' + hash;
}

function sprawdzHaslo(haslo, zapisanyHash) {
  if (!zapisanyHash || typeof zapisanyHash !== 'string' || zapisanyHash.indexOf(':') === -1) return false;
  const [sol, hash] = zapisanyHash.split(':');
  const proba = crypto.scryptSync(String(haslo || ''), sol, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(proba, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------- sesje (ciasteczka) ----------
function podpisz(payload) {
  const dane = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', sekret()).update(dane).digest('base64url');
  return dane + '.' + hmac;
}

function zweryfikuj(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const [dane, hmac] = token.split('.');
  const oczekiwany = crypto.createHmac('sha256', sekret()).update(dane).digest('base64url');
  if (hmac !== oczekiwany) return null;
  try {
    const payload = JSON.parse(Buffer.from(dane, 'base64url').toString('utf8'));
    if (payload.wygasa && Date.now() > payload.wygasa) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function parsujCiastka(req) {
  const naglowek = req.headers && req.headers.cookie;
  const wynik = {};
  if (!naglowek) return wynik;
  naglowek.split(';').forEach((para) => {
    const idx = para.indexOf('=');
    if (idx === -1) return;
    const klucz = para.slice(0, idx).trim();
    const wartosc = para.slice(idx + 1).trim();
    wynik[klucz] = decodeURIComponent(wartosc);
  });
  return wynik;
}

function czyRola(req, nazwaCiastka, rola) {
  const ciastka = parsujCiastka(req);
  const payload = zweryfikuj(ciastka[nazwaCiastka]);
  return !!(payload && payload.rola === rola);
}

function czyAdmin(req) {
  return czyRola(req, NAZWA_CIASTKA_ADMIN, 'admin');
}

function czyPodgladAutoryzowany(req) {
  return czyRola(req, NAZWA_CIASTKA_PODGLAD, 'podglad');
}

// Render (i inne PaaS za proxy) terminują HTTPS na load balancerze i
// przekazują ruch do appki po zwykłym HTTP - stąd sprawdzamy nagłówek
// X-Forwarded-Proto zamiast req.secure/process.env.VERCEL. Lokalnie
// (bez proxy, http://localhost) nagłówka nie ma, więc Secure zostaje
// wyłączone - ciasteczko i tak działa na http.
function jestHttps(req) {
  const naglowek = req.headers && req.headers['x-forwarded-proto'];
  return naglowek === 'https' || (req.socket && req.socket.encrypted);
}

function ustawCiastko(req, res, nazwaCiastka, rola) {
  const token = podpisz({ rola, wygasa: Date.now() + WAZNOSC_MS });
  const bezpieczne = jestHttps(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    nazwaCiastka + '=' + encodeURIComponent(token) +
      '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(WAZNOSC_MS / 1000) + bezpieczne
  );
}

function wyczyscCiastko(res, nazwaCiastka) {
  res.setHeader('Set-Cookie', nazwaCiastka + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function ustawCiastkoAdmina(req, res) { ustawCiastko(req, res, NAZWA_CIASTKA_ADMIN, 'admin'); }
function wyczyscCiastkoAdmina(res) { wyczyscCiastko(res, NAZWA_CIASTKA_ADMIN); }
function ustawCiastkoPodgladu(req, res) { ustawCiastko(req, res, NAZWA_CIASTKA_PODGLAD, 'podglad'); }
function wyczyscCiastkoPodgladu(res) { wyczyscCiastko(res, NAZWA_CIASTKA_PODGLAD); }

module.exports = {
  czyAdmin,
  czyPodgladAutoryzowany,
  ustawCiastkoAdmina,
  wyczyscCiastkoAdmina,
  ustawCiastkoPodgladu,
  wyczyscCiastkoPodgladu,
  parsujCiastka,
  hashHaslo,
  sprawdzHaslo,
};
