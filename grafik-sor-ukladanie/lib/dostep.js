// lib/dostep.js
//
// Przechowuje hasła (zahaszowane) dla dwóch ról: admin i podglad. Przy
// pierwszym uruchomieniu (brak jeszcze zapisanego "dostep.json" w magazynie)
// hasło admina jest "zasiane" z ADMIN_PASSWORD (env) - OD TEJ CHWILI źródłem
// prawdy jest zapisany hash, nie env (żeby zmiana hasła z panelu admina
// działała bez potrzeby redeployu). Hasło podglądu domyślnie nie jest
// ustawione (podglad === null) = podgląd otwarty, bez logowania.

const { readJSON, writeJSON } = require('./store');
const { hashHaslo } = require('./auth');

const KLUCZ = 'dostep.json';

async function wczytajDostep() {
  let dostep = await readJSON(KLUCZ, null);
  if (!dostep) {
    const poczatkoweHaslo = process.env.ADMIN_PASSWORD;
    if (!poczatkoweHaslo) {
      throw new Error(
        'Brak zapisanego hasła administratora i brak ADMIN_PASSWORD w zmiennych środowiskowych - ustaw ADMIN_PASSWORD przy pierwszym uruchomieniu.'
      );
    }
    dostep = { adminHaslo: hashHaslo(poczatkoweHaslo), podgladHaslo: null };
    await writeJSON(KLUCZ, dostep);
  }
  return dostep;
}

async function zapiszDostep(dostep) {
  await writeJSON(KLUCZ, dostep);
}

module.exports = { wczytajDostep, zapiszDostep };
