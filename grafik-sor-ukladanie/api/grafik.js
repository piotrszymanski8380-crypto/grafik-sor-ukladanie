// api/grafik.js — jeden grafik (rok+miesiąc): odczyt (admin: pełny roboczy/
// opublikowany; podgląd: tylko opublikowany) i akcje admina (zapisz komórkę,
// publikuj, wznów edycję).
//
// Dane przechowywane PER MIESIĄC ("grafik-<rok>-<miesiac>.json"), ale reguła
// W5 (norma czasu pracy) liczy CAŁY 2-miesięczny okres rozliczeniowy — dlatego
// do blokada()/ostrzezeniaMiesiaca() zawsze przekazujemy wpisy Z OBU miesięcy
// pary (patrz JAK-WDROZYC.md w projekcie grafik-dyzurow-SOR), a zapisujemy
// z powrotem tylko do pliku miesiąca, którego dotyczy edycja.

const { czyAdmin } = require('../lib/auth');
const { mozePodgladac } = require('../lib/bramkaPodgladu');
const { readJSON, writeJSON } = require('../lib/store');
const { grafik, stanGrafiku, liczbaDniMiesiaca, kluczGrafiku, sparowanyMiesiac } = require('../lib/silnik');

async function wczytajStan(rok, miesiac) {
  const zapisany = await readJSON(kluczGrafiku(rok, miesiac), null);
  return zapisany || stanGrafiku.sgNowyGrafik([]);
}

async function wpisyOkresu(rok, miesiac, wpisyBiezace) {
  const inny = await wczytajStan(rok, sparowanyMiesiac(miesiac));
  return wpisyBiezace.concat(inny.wpisy || []);
}

// wpisyRoku(rok) - wpisy z WSZYSTKICH 12 miesięcy danego roku, do reguł liczonych
// rocznie (W9, W16, W17 - patrz komentarz `wpisyRoczne` w domain/grafik.js
// ostrzezeniaMiesiaca()). 12 odczytów z magazynu na wejście do ekranu Grafik -
// żadnego limitu odczytów tu nie ma (Upstash Redis, nie stary limit B2/Airtable
// z paczki Janka - patrz README w Specyfikacja aplikacji.zip, sekcja "Ograniczenia
// platformy" - NIE dotyczy tej appki).
async function wpisyRoku(rok) {
  const miesiace = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const stany = await Promise.all(miesiace.map((m) => wczytajStan(rok, m)));
  return stany.reduce((acc, s) => acc.concat(s.wpisy || []), []);
}

// parametryZUstawien() - DOMYSLNE_PARAMETRY + lista reguł ręcznie wyłączonych w
// panelu Ustawienia -> Reguły (patrz api/reguly.js, ustawienia-reguly.json).
// Używane WSZĘDZIE, gdzie dotąd przekazywano samo grafik.DOMYSLNE_PARAMETRY do
// blokada()/ostrzezeniaMiesiaca()/generujBrakujaceDyzury() - jedno miejsce, żeby
// wyłączenie reguły działało spójnie przy zapisie komórki, liście ostrzeżeń,
// publikacji i generatorze.
async function parametryZUstawien() {
  const wylaczoneReguly = await readJSON('ustawienia-reguly.json', []);
  return Object.assign({}, grafik.DOMYSLNE_PARAMETRY, { wylaczoneReguly });
}

function zbudujObsade(rok, miesiac, wpisy, pracownicy) {
  const dni = liczbaDniMiesiaca(rok, miesiac);
  const wynik = [];
  for (let d = 1; d <= dni; d++) {
    const data = rok + '-' + String(miesiac).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const wiersz = { data, main: {}, opie: {}, minMain: {}, minOpie: {} };
    ['D', 'N'].forEach((typ) => {
      wiersz.main[typ] = grafik.obsadaDnia(wpisy, 'main', typ, data, pracownicy);
      wiersz.opie[typ] = grafik.obsadaDnia(wpisy, 'opie', typ, data, pracownicy);
      wiersz.minMain[typ] = grafik.minimalnaObsada('main', typ, data, grafik.DOMYSLNE_PARAMETRY);
      wiersz.minOpie[typ] = grafik.minimalnaObsada('opie', typ, data, grafik.DOMYSLNE_PARAMETRY);
    });
    wynik.push(wiersz);
  }
  return wynik;
}

module.exports = async function handler(req, res) {
  const rok = Number((req.query && req.query.rok) || (req.body && req.body.rok) || 0);
  const miesiac = Number((req.query && req.query.miesiac) || (req.body && req.body.miesiac) || 0);
  if (!rok || !miesiac || miesiac < 1 || miesiac > 12) {
    res.status(400).json({ error: 'Wymagane parametry: rok, miesiac (1-12).' });
    return;
  }

  if (req.method === 'GET') {
    const stanBiezacy = await wczytajStan(rok, miesiac);
    // widok=podglad - wymuszony przez public/podglad.js (2026-08-30, na życzenie:
    // "dalej w podglad personelu nie widze grafiku"). Bez tego admin przeglądający
    // podglad.html WCIĄŻ ma ciasteczko sesji admina, więc czyAdmin(req) było true
    // i serwer zwracał gałąź "admin" (bez pola opublikowany) - podgląd zawsze
    // pokazywał "nie opublikowano", niezależnie od faktycznego statusu. Panel
    // admina samego siebie o ten parametr nie pyta, więc zachowuje się jak dawniej.
    const wymuszonyPodglad = req.query && (req.query.widok === 'podglad');
    const admin = !wymuszonyPodglad && czyAdmin(req);

    if (!admin) {
      if (!(await mozePodgladac(req))) {
        res.status(401).json({ error: 'Wymagane hasło dostępu do podglądu.' });
        return;
      }
      if (stanBiezacy.status !== 'opublikowany') {
        res.status(200).json({ opublikowany: false });
        return;
      }
      const pracownicy = await readJSON('pracownicy.json', []);
      res.status(200).json({ opublikowany: true, stan: stanBiezacy, pracownicy });
      return;
    }

    const pracownicy = await readJSON('pracownicy.json', []);
    const wpisyPary = await wpisyOkresu(rok, miesiac, stanBiezacy.wpisy);
    const wpisyRoczne = await wpisyRoku(rok);
    const parametry = await parametryZUstawien();
    const ostrzezenia = grafik.ostrzezeniaMiesiaca(wpisyPary, pracownicy, rok, miesiac, parametry, wpisyRoczne);
    const obsada = zbudujObsade(rok, miesiac, stanBiezacy.wpisy, pracownicy);
    res.status(200).json({ stan: stanBiezacy, ostrzezenia, obsada, pracownicy });
    return;
  }

  if (req.method === 'POST') {
    if (!czyAdmin(req)) {
      res.status(403).json({ error: 'Tylko administrator może edytować grafik.' });
      return;
    }
    const akcja = req.body && req.body.akcja;
    const stanBiezacy = await wczytajStan(rok, miesiac);
    const pracownicy = await readJSON('pracownicy.json', []);

    if (akcja === 'zapisz') {
      const { pracownikId, data, slot, kod, kodRealizacji, zamianaZId } = req.body;
      const pracownik = pracownicy.find((p) => p.id === pracownikId);
      if (!pracownik) {
        res.status(404).json({ error: 'Nie znaleziono pracownika o id=' + pracownikId });
        return;
      }
      // zamianaZId to czysta adnotacja (kto z kim się zamienił) - jeśli wskazuje
      // na nieistniejącego pracownika (np. usuniętego z kadry), po prostu ją
      // pomijamy zamiast blokować zapis komórki.
      const zamianaZIdCzysty = zamianaZId && pracownicy.some((p) => p.id === zamianaZId) ? zamianaZId : undefined;
      const wpisyPary = await wpisyOkresu(rok, miesiac, stanBiezacy.wpisy);
      // Godziny/reguły (W1-W15) liczą się WEDŁUG REALIZACJI, jeśli jest ustawiona
      // (patrz grfKodEfektywny() w domain/grafik.js) - więc to właśnie ten kod
      // sprawdzamy regułą blokada(), nie sam plan.
      const kodEfektywny = (kodRealizacji != null && kodRealizacji !== '') ? kodRealizacji : kod;
      const parametry = await parametryZUstawien();
      const powod = grafik.blokada(pracownik, data, kodEfektywny, wpisyPary, parametry);
      if (powod) {
        res.status(200).json({ ok: false, powod });
        return;
      }
      let nowyStan;
      try {
        nowyStan = stanGrafiku.sgZapiszZmiane(
          stanBiezacy,
          { pracownikId, data, slot: slot || 1, kod, kodRealizacji, zamianaZId: zamianaZIdCzysty },
          'admin',
          req.body.kontekst || 'edycja ręczna'
        );
      } catch (e) {
        res.status(409).json({ error: e.message });
        return;
      }
      await writeJSON(kluczGrafiku(rok, miesiac), nowyStan);
      res.status(200).json({ ok: true, stan: nowyStan });
      return;
    }

    if (akcja === 'generuj') {
      // Generator NIE nadpisuje istniejących wpisów - tylko dopisuje brakujące D/N
      // tam, gdzie obsada (W8/W14) jest poniżej minimum, patrz komentarz przy
      // grafik.generujBrakujaceDyzury() w domain/grafik.js. Reguły odpoczynku i
      // 48h/tydz. potrzebują wpisów z OBU miesięcy pary rozliczeniowej, tak samo
      // jak przy zwykłym zapisie komórki (patrz wpisyOkresu wyżej).
      const wpisyPary = await wpisyOkresu(rok, miesiac, stanBiezacy.wpisy);
      const parametry = await parametryZUstawien();
      const { noweWpisy, braki } = grafik.generujBrakujaceDyzury(wpisyPary, pracownicy, rok, miesiac, parametry);
      let nowyStan = stanBiezacy;
      try {
        noweWpisy.forEach((w) => {
          nowyStan = stanGrafiku.sgZapiszZmiane(nowyStan, w, 'admin', 'generator automatyczny (uzupełnienie obsady)');
        });
      } catch (e) {
        res.status(409).json({ error: e.message });
        return;
      }
      await writeJSON(kluczGrafiku(rok, miesiac), nowyStan);
      res.status(200).json({ ok: true, stan: nowyStan, wygenerowano: noweWpisy.length, braki });
      return;
    }

    if (akcja === 'publikuj') {
      const wpisyPary = await wpisyOkresu(rok, miesiac, stanBiezacy.wpisy);
      const wpisyRoczne = await wpisyRoku(rok);
      const parametry = await parametryZUstawien();
      const ostrzezenia = grafik.ostrzezeniaMiesiaca(wpisyPary, pracownicy, rok, miesiac, parametry, wpisyRoczne);
      const wynik = stanGrafiku.sgOpublikuj(stanBiezacy, ostrzezenia, 'admin', {
        mimoOstrzezen: !!req.body.mimoOstrzezen,
      });
      if (!wynik.ok) {
        res.status(200).json({ ok: false, powod: wynik.powod });
        return;
      }
      await writeJSON(kluczGrafiku(rok, miesiac), wynik.stan);
      res.status(200).json({ ok: true, stan: wynik.stan });
      return;
    }

    if (akcja === 'importMasowy') {
      // Import GOTOWEGO grafiku z realnego arkusza Excela (public/admin.js parsuje
      // plik przez XLSX + domain/importGrafikuExcel.js, PO ekranie dopasowania
      // nazwisk) - NADPISUJE cały miesiąc naraz, bez przechodzenia przez blokada()
      // (dane historyczne, patrz komentarz przy sgImportujMiesiac w domain/
      // stanGrafiku.js - appka wychwyci ewentualne złamane reguły jako zwykłe
      // Ostrzeżenia PO imporcie, nie blokuje samego wgrania).
      const { wpisy: noweWpisy, opis } = req.body;
      if (!Array.isArray(noweWpisy)) {
        res.status(400).json({ error: 'Wymagana tablica "wpisy".' });
        return;
      }
      const nieznani = noweWpisy.filter((w) => !pracownicy.some((p) => p.id === w.pracownikId));
      if (nieznani.length > 0) {
        res.status(400).json({ error: 'Import zawiera nieznane id pracownika: ' + nieznani.slice(0, 3).map((w) => w.pracownikId).join(', ') + (nieznani.length > 3 ? '…' : '') });
        return;
      }
      let nowyStan;
      try {
        nowyStan = stanGrafiku.sgImportujMiesiac(stanBiezacy, noweWpisy, 'admin', opis);
      } catch (e) {
        res.status(409).json({ error: e.message });
        return;
      }
      await writeJSON(kluczGrafiku(rok, miesiac), nowyStan);
      res.status(200).json({ ok: true, stan: nowyStan });
      return;
    }

    if (akcja === 'wznowEdycje') {
      const nowyStan = stanGrafiku.sgWznowEdycje(stanBiezacy, 'admin', req.body.kontekst || 'wznowienie edycji');
      await writeJSON(kluczGrafiku(rok, miesiac), nowyStan);
      res.status(200).json({ ok: true, stan: nowyStan });
      return;
    }

    res.status(400).json({ error: 'Nieznana akcja: ' + akcja });
    return;
  }

  res.status(405).json({ error: 'Metoda niedozwolona' });
};
