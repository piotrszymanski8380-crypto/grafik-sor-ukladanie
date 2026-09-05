// api/grafik-import.js — import GOTOWEGO grafiku z realnego arkusza Excela
// ("płachta_2026.xlsx" i podobne), admin-only, DWUETAPOWO:
//
//   akcja='parsuj'   - klient wysyła już wyciągniętą siatkę arkusza (tablicę
//                      wierszy - XLSX.utils.sheet_to_json(ws, {header:1}) po
//                      stronie przeglądarki, patrz public/admin.js; serwer NIE
//                      dostaje binarnego pliku .xlsx, więc appka nie potrzebuje
//                      biblioteki xlsx po stronie serwera). Serwer parsuje przez
//                      domain/importGrafikuExcel.js i od razu próbuje dopasować
//                      nazwiska do istniejącej kadry (domain/importDopasowania.js) -
//                      zwraca wynik do ekranu decyzji administratora.
//   akcja='zatwierdz' - klient odsyła te same wierszeOsob (nie trzyma ich serwer
//                      między żądaniami - appka jest bezstanowa) + decyzje
//                      administratora (przypisania nazwisko->pracownikId) -
//                      serwer buduje finalne wpisy (iwzZbudujWpisy) i ZAPISUJE
//                      przez sgImportujMiesiac (domain/stanGrafiku.js).
//
// WAŻNE: import NIE tworzy nowych pracowników - nazwiska bez jednoznacznego
// dopasowania do istniejącej kadry są pomijane (patrz doSprawdzenia w wyniku;
// administrator może dodać brakującą osobę w Kadrze i wgrać plik ponownie).
//
// WAŻNE (merge z istniejącymi danymi miesiąca): import zastępuje wpisy TYLKO
// tych pracowników, którzy faktycznie wystąpili w przesłanym arkuszu (main i/lub
// opie) - wpisy pozostałych osób (np. drugiej grupy, jeśli wgrano tylko jedną)
// zostają nietknięte. To NIE jest ogólne zachowanie sgImportujMiesiac (który
// zastępuje CAŁĄ listę - patrz jego komentarz) - scalanie liczy się tutaj,
// w warstwie API, przed wywołaniem.

const { czyAdmin } = require('../lib/auth');
const { readJSON, writeJSON } = require('../lib/store');
const { stanGrafiku, importDopasowania, importGrafikuExcel, silnikImportu, kluczGrafiku } = require('../lib/silnik');

async function wczytajStan(rok, miesiac) {
  const zapisany = await readJSON(kluczGrafiku(rok, miesiac), null);
  return zapisany || stanGrafiku.sgNowyGrafik([]);
}

function mapowanieKanoniczne(pracownicy) {
  return pracownicy.map((p) => ({ nazwisko: p.imieNazwisko, id: p.id }));
}

/** Parsuje jedną siatkę (main lub opie) i od razu dopasowuje nazwiska do `pracownicyGrupy`. */
function parsujIDopasuj(grid, pracownicyGrupy) {
  if (!grid) return null;
  const wynik = importGrafikuExcel.iwzParsujArkusz(grid);
  if (wynik.blad) return wynik;
  // silnikImportu (lib/silnik.js) wstrzykuje migracjaId.podobienstwo() - PO STRONIE
  // SERWERA nie ma globalnego `podobienstwo` (to nie przeglądarka), więc bez tego
  // idDopasujListe() rzuca TypeError (idSilnikDomyslny() zwraca null poza przeglądarką) -
  // patrz komentarz w domain/importDopasowania.js.
  const { dopasowania } = importDopasowania.idDopasujListe(wynik.nazwiska, mapowanieKanoniczne(pracownicyGrupy), undefined, silnikImportu);
  return { wierszeOsob: wynik.wierszeOsob, pominieciOsob: wynik.pominieciOsob, dopasowania };
}

module.exports = async function handler(req, res) {
  if (!czyAdmin(req)) {
    res.status(403).json({ error: 'Tylko administrator może importować grafik.' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Metoda niedozwolona' });
    return;
  }

  const akcja = req.body && req.body.akcja;
  const rok = Number(req.body && req.body.rok);
  const miesiac = Number(req.body && req.body.miesiac);
  if (!rok || !miesiac || miesiac < 1 || miesiac > 12) {
    res.status(400).json({ error: 'Wymagane parametry: rok, miesiac (1-12).' });
    return;
  }
  const pracownicy = await readJSON('pracownicy.json', []);

  if (akcja === 'parsuj') {
    const main = parsujIDopasuj(req.body.main, pracownicy.filter((p) => p.grupa === 'main'));
    const opie = parsujIDopasuj(req.body.opie, pracownicy.filter((p) => p.grupa === 'opie'));
    if (!main && !opie) {
      res.status(400).json({ error: 'Nie przesłano żadnego arkusza (main/opie).' });
      return;
    }
    res.status(200).json({ ok: true, main, opie });
    return;
  }

  if (akcja === 'zatwierdz') {
    const czesci = [];
    ['main', 'opie'].forEach((grupa) => {
      const dane = req.body[grupa];
      if (!dane || !Array.isArray(dane.wierszeOsob)) return;
      const przypisania = dane.przypisania || {};
      czesci.push(importGrafikuExcel.iwzZbudujWpisy(dane.wierszeOsob, przypisania, pracownicy, rok, miesiac));
    });
    if (czesci.length === 0) {
      res.status(400).json({ error: 'Brak danych do zatwierdzenia (main/opie).' });
      return;
    }

    const noweWpisy = czesci.reduce((acc, c) => acc.concat(c.wpisy), []);
    const doSprawdzenia = czesci.reduce((acc, c) => acc.concat(c.doSprawdzenia), []);
    const dotknieciPracownicy = new Set(noweWpisy.map((w) => w.pracownikId));

    const stanBiezacy = await wczytajStan(rok, miesiac);
    const zachowaneWpisy = stanBiezacy.wpisy.filter((w) => !dotknieciPracownicy.has(w.pracownikId));
    const finalneWpisy = zachowaneWpisy.concat(noweWpisy);

    const opis = 'import z Excela: ' + noweWpisy.length + ' wpisów, ' + dotknieciPracownicy.size + ' osób' +
      (doSprawdzenia.length ? ', ' + doSprawdzenia.length + ' do sprawdzenia' : '');

    let nowyStan;
    try {
      nowyStan = stanGrafiku.sgImportujMiesiac(stanBiezacy, finalneWpisy, 'admin', opis);
    } catch (e) {
      res.status(409).json({ error: e.message });
      return;
    }
    await writeJSON(kluczGrafiku(rok, miesiac), nowyStan);
    res.status(200).json({ ok: true, stan: nowyStan, liczbaWpisow: noweWpisy.length, doSprawdzenia });
    return;
  }

  res.status(400).json({ error: 'Nieznana akcja: ' + akcja });
};
