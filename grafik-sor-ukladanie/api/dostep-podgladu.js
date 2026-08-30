// api/dostep-podgladu.js — publiczny GET: czy podgląd wymaga hasła? (bez
// ujawniania samego hasła/hashu). Używane przez podglad.js (czy pokazać
// formularz logowania) i admin.js (status w panelu Bezpieczeństwo).

const { wczytajDostep } = require('../lib/dostep');

module.exports = async function handler(req, res) {
  let dostep;
  try {
    dostep = await wczytajDostep();
  } catch (e) {
    res.status(500).json({ error: e.message });
    return;
  }
  res.status(200).json({ wymaganeHaslo: !!dostep.podgladHaslo });
};
