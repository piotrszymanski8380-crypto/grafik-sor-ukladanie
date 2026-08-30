// api/pracownicy.js — lista pracowników (kadra oddziału).
//
// GET jest PUBLICZNY (bez logowania) — podgląd grafiku musi znać imiona i
// nazwiska, żeby w ogóle pokazać siatkę. POST (dodanie/edycja/usunięcie —
// appka wysyła zawsze całą listę na raz, prostsze niż osobne CRUD-endpointy)
// wymaga zalogowanego admina.
//
// WAŻNE: to jedyne miejsce, gdzie prawdziwe imiona i nazwiska pracowników
// się pojawiają — w danych (Blob/plik), NIGDY w kodzie źródłowym repo.

const { czyAdmin } = require('../lib/auth');
const { mozePodgladac } = require('../lib/bramkaPodgladu');
const { readJSON, writeJSON } = require('../lib/store');

const KLUCZ = 'pracownicy.json';
const DOZWOLONE_FORMY = ['etat', 'kontrakt', 'zlecenie'];
const DOZWOLONE_GRUPY = ['main', 'opie'];

function zwalidujListe(lista) {
  if (!Array.isArray(lista)) return 'Oczekiwano tablicy pracowników.';
  const idy = new Set();
  for (const p of lista) {
    if (!p || typeof p !== 'object') return 'Nieprawidłowy wpis pracownika.';
    if (!p.id || typeof p.id !== 'string') return 'Każdy pracownik wymaga pola "id".';
    if (idy.has(p.id)) return 'Zduplikowane id: ' + p.id;
    idy.add(p.id);
    if (!p.imieNazwisko || typeof p.imieNazwisko !== 'string') return 'Brak imienia i nazwiska dla id=' + p.id;
    if (DOZWOLONE_FORMY.indexOf(p.forma) === -1) return 'Nieprawidłowa forma zatrudnienia dla ' + p.imieNazwisko;
    if (DOZWOLONE_GRUPY.indexOf(p.grupa) === -1) return 'Nieprawidłowa grupa dla ' + p.imieNazwisko;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    if (!(await mozePodgladac(req))) {
      res.status(401).json({ error: 'Wymagane hasło dostępu do podglądu.' });
      return;
    }
    const lista = await readJSON(KLUCZ, []);
    res.status(200).json({ pracownicy: lista });
    return;
  }

  if (req.method === 'POST') {
    if (!czyAdmin(req)) {
      res.status(403).json({ error: 'Tylko administrator może edytować listę pracowników.' });
      return;
    }
    const lista = req.body && req.body.pracownicy;
    const blad = zwalidujListe(lista);
    if (blad) {
      res.status(400).json({ error: blad });
      return;
    }
    await writeJSON(KLUCZ, lista);
    res.status(200).json({ ok: true, pracownicy: lista });
    return;
  }

  res.status(405).json({ error: 'Metoda niedozwolona' });
};
