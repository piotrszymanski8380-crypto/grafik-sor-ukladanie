const { ustawCiastkoAdmina, sprawdzHaslo } = require('../lib/auth');
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
  const haslo = req.body && req.body.haslo;
  if (!sprawdzHaslo(haslo, dostep.adminHaslo)) {
    res.status(401).json({ error: 'Błędne hasło.' });
    return;
  }
  ustawCiastkoAdmina(req, res);
  res.status(200).json({ ok: true });
};
