// api/login-podglad.js — logowanie do publicznego podglądu, TYLKO gdy admin
// ustawił hasło dostępu (dostep.podgladHaslo !== null). Jeśli hasło nie jest
// wymagane, zawsze zwraca ok:true (nic do sprawdzenia).

const { ustawCiastkoPodgladu, sprawdzHaslo } = require('../lib/auth');
const { wczytajDostep } = require('../lib/dostep');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Metoda niedozwolona' });
    return;
  }
  let dostep;
  try {
    dostep = await wczytajDostep();
  } catch (e) {
    res.status(500).json({ error: e.message });
    return;
  }
  if (!dostep.podgladHaslo) {
    ustawCiastkoPodgladu(req, res);
    res.status(200).json({ ok: true });
    return;
  }
  const haslo = req.body && req.body.haslo;
  if (!sprawdzHaslo(haslo, dostep.podgladHaslo)) {
    res.status(401).json({ error: 'Błędne hasło.' });
    return;
  }
  ustawCiastkoPodgladu(res);
  res.status(200).json({ ok: true });
};
