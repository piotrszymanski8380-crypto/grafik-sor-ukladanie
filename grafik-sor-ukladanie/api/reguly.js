// api/reguly.js — panel Ustawienia -> Reguły: lista wszystkich reguł W1-W17
// (katalog na stałe w domain/grafik.js, jedno źródło prawdy) + które z nich
// administrator ręcznie wyłączył (persystencja: ustawienia-reguly.json).
//
// GET jest PUBLICZNY (jak pracownicy.json) - katalog reguł to nie tajemnica,
// a podgląd/generator mogą kiedyś chcieć wiedzieć, które reguły są aktywne.
// POST (zmiana listy wyłączonych) wymaga zalogowanego admina.

const { czyAdmin } = require('../lib/auth');
const { readJSON, writeJSON } = require('../lib/store');
const { grafik } = require('../lib/silnik');

const KLUCZ = 'ustawienia-reguly.json';
const DOZWOLONE_ID = grafik.GRF_KATALOG_REGUL.map((r) => r.id);

function zwalidujListe(lista) {
  if (!Array.isArray(lista)) return 'Oczekiwano tablicy id-ków reguł.';
  for (const id of lista) {
    if (DOZWOLONE_ID.indexOf(id) === -1) return 'Nieznana reguła: ' + id;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const wylaczone = await readJSON(KLUCZ, []);
    res.status(200).json({ katalog: grafik.GRF_KATALOG_REGUL, wylaczoneReguly: wylaczone });
    return;
  }

  if (req.method === 'POST') {
    if (!czyAdmin(req)) {
      res.status(403).json({ error: 'Tylko administrator może zmieniać ustawienia reguł.' });
      return;
    }
    const lista = req.body && req.body.wylaczoneReguly;
    const blad = zwalidujListe(lista);
    if (blad) {
      res.status(400).json({ error: blad });
      return;
    }
    await writeJSON(KLUCZ, lista);
    res.status(200).json({ ok: true, wylaczoneReguly: lista });
    return;
  }

  res.status(405).json({ error: 'Metoda niedozwolona' });
};
