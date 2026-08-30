// api/haslo.js — zmiana haseł, TYLKO admin. Dwie role:
//   { rola: 'admin', obecneHaslo, noweHaslo }  — wymaga podania obecnego hasła
//   { rola: 'podglad', noweHaslo }             — noweHaslo === '' wyłącza wymóg
//                                                 hasła (podgląd wraca do otwartego)

const { czyAdmin, hashHaslo, sprawdzHaslo } = require('../lib/auth');
const { wczytajDostep, zapiszDostep } = require('../lib/dostep');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Metoda niedozwolona' });
    return;
  }
  if (!czyAdmin(req)) {
    res.status(403).json({ error: 'Tylko zalogowany administrator może zmieniać hasła.' });
    return;
  }

  let dostep;
  try {
    dostep = await wczytajDostep();
  } catch (e) {
    res.status(500).json({ error: e.message });
    return;
  }

  const rola = req.body && req.body.rola;
  const noweHaslo = (req.body && req.body.noweHaslo) || '';

  if (rola === 'admin') {
    const obecneHaslo = req.body && req.body.obecneHaslo;
    if (!sprawdzHaslo(obecneHaslo, dostep.adminHaslo)) {
      res.status(401).json({ error: 'Obecne hasło jest nieprawidłowe.' });
      return;
    }
    if (!noweHaslo || noweHaslo.length < 4) {
      res.status(400).json({ error: 'Nowe hasło musi mieć co najmniej 4 znaki.' });
      return;
    }
    dostep.adminHaslo = hashHaslo(noweHaslo);
    await zapiszDostep(dostep);
    res.status(200).json({ ok: true });
    return;
  }

  if (rola === 'podglad') {
    if (noweHaslo && noweHaslo.length < 4) {
      res.status(400).json({ error: 'Hasło podglądu musi mieć co najmniej 4 znaki (albo zostaw puste, żeby wyłączyć).' });
      return;
    }
    dostep.podgladHaslo = noweHaslo ? hashHaslo(noweHaslo) : null;
    await zapiszDostep(dostep);
    res.status(200).json({ ok: true, wymaganeHaslo: !!dostep.podgladHaslo });
    return;
  }

  res.status(400).json({ error: 'Nieznana rola: ' + rola });
};
