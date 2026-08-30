// lib/bramkaPodgladu.js — wspólna reguła dostępu do publicznych endpointów
// odczytu (api/grafik.js, api/pracownicy.js): admin zawsze wchodzi; gość -
// tylko jeśli hasło podglądu nie jest ustawione ALBO ma ważne ciasteczko
// "sor_podglad" (patrz api/login-podglad.js).

const { czyAdmin, czyPodgladAutoryzowany } = require('./auth');
const { wczytajDostep } = require('./dostep');

async function mozePodgladac(req) {
  if (czyAdmin(req)) return true;
  const dostep = await wczytajDostep();
  if (!dostep.podgladHaslo) return true;
  return czyPodgladAutoryzowany(req);
}

module.exports = { mozePodgladac };
