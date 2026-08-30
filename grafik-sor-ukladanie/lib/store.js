// lib/store.js
//
// Magazyn danych (JSON per klucz - np. "pracownicy.json", "grafik-2026-11.json").
// Tryby, wybierane automatycznie wg tego, co jest ustawione w env (sprawdzane
// w tej kolejności):
//
//  1. UPSTASH REDIS przez REST: gdy ustawione są KV_REST_API_URL +
//     KV_REST_API_TOKEN. Opcjonalne - zostawione jako alternatywa, gdyby
//     appka kiedyś wróciła na platformę bez trwałego dysku.
//  2. VERCEL BLOB: gdy ustawiona jest BLOB_READ_WRITE_TOKEN. Też opcjonalne,
//     zachowane na wypadek migracji.
//  3. LOKALNY DYSK (DOMYŚLNY na Render): zapis do plików w katalogu DATA_DIR
//     (env, domyślnie "./data" względem katalogu appki). Na Render ten
//     katalog MUSI być podpięty jako Persistent Disk (Render → Settings →
//     Disks → mount path = ta sama ścieżka co DATA_DIR), inaczej dane znikną
//     przy każdym restarcie/redeployu - patrz JAK-WDROZYC.md.
//
// WAŻNE: to jedyne miejsce, gdzie appka zapisuje/czyta dane (pracownicy,
// grafiki). Żadne prawdziwe nazwisko nigdy nie trafia do repo (katalog
// danych jest w .gitignore) - dane wpisuje Piotr/administrator w działającej
// appce, nigdy w kodzie źródłowym.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

// Prefiks wszystkich kluczy - CELOWO, na wypadek, gdyby magazyn (Redis/Blob)
// był kiedyś współdzielony z innym projektem (np. sor-app) - z prefiksem
// appka fizycznie nie może nadpisać/przeczytać niczego spoza swojej
// "przestrzeni nazw", nawet przy pomyłce konfiguracji.
const PREFIX = 'grafik-sor-standalone__';

function uzywaUpstash() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function uzywaBlob() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

let upstashClient = null;
function pobierzKlientaUpstash() {
  if (!upstashClient) {
    const { Redis } = require('@upstash/redis');
    upstashClient = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return upstashClient;
}

async function readJSON(key, fallback) {
  const klucz = PREFIX + key;

  if (uzywaUpstash()) {
    const klient = pobierzKlientaUpstash();
    const wartosc = await klient.get(klucz);
    if (wartosc == null) return fallback;
    // @upstash/redis samo parsuje JSON przy get(), jeśli wartość była zapisana
    // jako JSON (co robimy w writeJSON) - ale bywa, że zwraca już obiekt, nie
    // string, więc obsługujemy oba przypadki.
    return typeof wartosc === 'string' ? JSON.parse(wartosc) : wartosc;
  }

  if (uzywaBlob()) {
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: klucz, limit: 10 });
    const found = blobs.find((b) => b.pathname === klucz);
    if (!found) return fallback;
    const res = await fetch(found.url, { cache: 'no-store' });
    if (!res.ok) return fallback;
    return await res.json();
  }

  const plik = path.join(DATA_DIR, key);
  if (!fs.existsSync(plik)) return fallback;
  return JSON.parse(fs.readFileSync(plik, 'utf8'));
}

async function writeJSON(key, value) {
  const tekst = JSON.stringify(value, null, 2);
  const klucz = PREFIX + key;

  if (uzywaUpstash()) {
    const klient = pobierzKlientaUpstash();
    await klient.set(klucz, tekst);
    return;
  }

  if (uzywaBlob()) {
    const { put } = require('@vercel/blob');
    await put(klucz, tekst, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
    return;
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, key), tekst, 'utf8');
}

module.exports = { readJSON, writeJSON, uzywaUpstash, uzywaBlob, DATA_DIR };
