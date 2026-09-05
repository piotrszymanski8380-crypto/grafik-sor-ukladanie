// lib/silnik.js
//
// Jedno miejsce, które łączy moduły domain/*.js po stronie serwera (Node/
// CommonJS - require() między nimi działa tu bez problemu, w przeciwieństwie
// do przeglądarki/Vitest - patrz komentarze w domain/polautomat.js i
// domain/importDopasowania.js). Reszta kodu backendu importuje TYLKO stąd,
// żeby nie duplikować tego wiązania w każdym pliku api/*.js.

const grafik = require('../domain/grafik.js');
const stanGrafiku = require('../domain/stanGrafiku.js');
const polautomat = require('../domain/polautomat.js');
const migracjaId = require('../domain/migracjaId.js');
const importDopasowania = require('../domain/importDopasowania.js');
const warstwaZgodnosci = require('../domain/warstwaZgodnosci.js');
const importGrafikuExcel = require('../domain/importGrafikuExcel.js');

const silnikGrafiku = {
  blokada: grafik.blokada,
  zbudujIndeks: grafik.zbudujIndeks,
  dodajDni: grafik.dodajDni,
};

const silnikImportu = {
  podobienstwo: migracjaId.podobienstwo,
};

function liczbaDniMiesiaca(rok, miesiac) {
  return new Date(rok, miesiac, 0).getDate();
}

function kluczGrafiku(rok, miesiac) {
  return 'grafik-' + rok + '-' + String(miesiac).padStart(2, '0') + '.json';
}

/** Drugi miesiąc tej samej 2-miesięcznej pary okresu rozliczeniowego (patrz W5). */
function sparowanyMiesiac(miesiac) {
  return miesiac % 2 === 1 ? miesiac + 1 : miesiac - 1;
}

module.exports = {
  grafik,
  stanGrafiku,
  polautomat,
  migracjaId,
  importDopasowania,
  warstwaZgodnosci,
  importGrafikuExcel,
  silnikGrafiku,
  silnikImportu,
  liczbaDniMiesiaca,
  kluczGrafiku,
  sparowanyMiesiac,
};
