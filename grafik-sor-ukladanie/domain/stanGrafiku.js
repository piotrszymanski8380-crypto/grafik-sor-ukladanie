// domain/stanGrafiku.js
//
// Stan grafiku miesiąca: status roboczy/opublikowany + wersja + historia zmian
// (TASKS.md, sekcja F1 "Model danych": "Grafik miesiąca ze statusem
// roboczy/opublikowany, wersją" i "Każda zmiana po publikacji w historii" z
// kryteriów akceptacji F1). Czysta logika (bez DOM/fetch/API), jak pozostałe
// domain/*.js - ładowana jako <script> w index.html, testowana przez Vitest.
//
// Ten moduł NIE zależy od domain/grafik.js przez require/import (patrz
// JAK-WDROZYC.md - cross-file require() zawodne pod Vitest/Vite) - wynik
// ostrzezeniaMiesiaca() jest przekazywany jako argument do sgOpublikuj(),
// nie liczony wewnątrz tego pliku.
//
// Model danych:
//   Wpis:         { pracownikId, data: 'YYYY-MM-DD', slot: 1|2, kod, notatka? } -
//                 ten sam kształt co w domain/grafik.js.
//   WpisHistorii: { kiedy: string (ISO), kto: string, pracownikId, data, slot,
//                   staraWartosc: string|null, nowaWartosc: string|null,
//                   kontekst?: string } - albo dla zdarzeń publikacji/wznowienia:
//                   { kiedy, kto, akcja: 'publikacja'|'wznowienie_edycji', ... }.
//   Stan:         { status: 'roboczy'|'opublikowany', wersja: number, wpisy: Wpis[],
//                   historia: WpisHistorii[] }

/** sgNowyGrafik(wpisyPoczatkowe?) -> Stan - nowy grafik miesiąca w statusie roboczym, wersja 1. */
function sgNowyGrafik(wpisyPoczatkowe) {
  return {
    status: 'roboczy',
    wersja: 1,
    wpisy: (wpisyPoczatkowe || []).slice(),
    historia: [],
  };
}

/**
 * sgZapiszZmiane(stan, zmiana, kto, kontekst) -> Stan (nowy obiekt, nie mutuje `stan`)
 * zmiana: { pracownikId, data, slot, kod, kodRealizacji?, zamianaZId?, notatka?,
 * kiedy? } - nowa wartość komórki; `kod` puste/null usuwa wpis (czyści komórkę,
 * razem z kodRealizacji/zamianaZId). kodRealizacji/zamianaZId puste usuwa TYLKO
 * te pola (zostawia plan) - patrz komentarz w domain/grafik.js przy
 * grfKodEfektywny(). Rzuca błąd, jeśli grafik jest opublikowany - świadoma
 * blokada (patrz sgWznowEdycje, żeby ją jawnie zdjąć).
 */
function sgZapiszZmiane(stan, zmiana, kto, kontekst) {
  if (stan.status === 'opublikowany') {
    throw new Error('SG1 - grafik opublikowany, edycja zablokowana. Użyj sgWznowEdycje(), żeby świadomie wrócić do wersji roboczej.');
  }

  var pasuje = function (w) {
    return w.pracownikId === zmiana.pracownikId && w.data === zmiana.data && w.slot === zmiana.slot;
  };
  var staraWartosc = null;
  stan.wpisy.forEach(function (w) { if (pasuje(w)) staraWartosc = w.kod; });

  var bezStarego = stan.wpisy.filter(function (w) { return !pasuje(w); });
  var noweWpisy = bezStarego;
  if (zmiana.kod) {
    noweWpisy = bezStarego.concat([{
      pracownikId: zmiana.pracownikId, data: zmiana.data, slot: zmiana.slot,
      kod: zmiana.kod,
      kodRealizacji: zmiana.kodRealizacji || undefined,
      zamianaZId: zmiana.zamianaZId || undefined,
      notatka: zmiana.notatka,
    }]);
  }

  var wpisHistorii = {
    kiedy: zmiana.kiedy || new Date().toISOString(),
    kto: kto,
    pracownikId: zmiana.pracownikId, data: zmiana.data, slot: zmiana.slot,
    staraWartosc: staraWartosc, nowaWartosc: zmiana.kod || null,
    kontekst: kontekst || null,
  };

  return {
    status: stan.status,
    wersja: stan.wersja,
    wpisy: noweWpisy,
    historia: stan.historia.concat([wpisHistorii]),
  };
}

/**
 * sgOpublikuj(stan, ostrzezenia, kto, opcje?) -> { ok: boolean, powod?: string, stan?: Stan }
 * `ostrzezenia` to wynik ostrzezeniaMiesiaca() z domain/grafik.js, przekazany z
 * zewnątrz (ten moduł nie liczy reguł sam - patrz nagłówek pliku). Blokuje
 * publikację, jeśli jest choć jedno ostrzeżenie 'hard'. Ostrzeżenia 'soft'
 * wymagają jawnego opcje.mimoOstrzezen=true ("publikuję mimo ostrzeżeń" z UI,
 * kryteria akceptacji F1).
 */
function sgOpublikuj(stan, ostrzezenia, kto, opcje) {
  opcje = opcje || {};
  var lista = ostrzezenia || [];
  var hardy = lista.filter(function (o) { return o.sev === 'hard'; });
  if (hardy.length > 0) {
    return { ok: false, powod: 'SG2 - ' + hardy.length + ' twarde ostrzeżenie(a) blokuje(ą) publikację - napraw je przed publikacją.' };
  }
  var miekkie = lista.filter(function (o) { return o.sev === 'soft'; });
  if (miekkie.length > 0 && !opcje.mimoOstrzezen) {
    return { ok: false, powod: 'SG3 - ' + miekkie.length + ' miękkie ostrzeżenie(a) - potwierdź "publikuję mimo ostrzeżeń", żeby kontynuować.' };
  }

  var nowaWersja = stan.wersja + 1;
  return {
    ok: true,
    stan: {
      status: 'opublikowany',
      wersja: nowaWersja,
      wpisy: stan.wpisy.slice(),
      historia: stan.historia.concat([{
        kiedy: opcje.kiedy || new Date().toISOString(),
        kto: kto,
        akcja: 'publikacja',
        wersja: nowaWersja,
        ostrzezeniaMiekkiePominiete: miekkie.length,
      }]),
    },
  };
}

/**
 * sgWznowEdycje(stan, kto, kontekst?) -> Stan
 * Świadoma akcja administracyjna: cofa opublikowany grafik do statusu roboczego,
 * BEZ cofania wersji (żeby historia nie sugerowała, że publikacji nigdy nie było).
 * Loguje zdarzenie w historii.
 */
function sgWznowEdycje(stan, kto, kontekst) {
  return {
    status: 'roboczy',
    wersja: stan.wersja,
    wpisy: stan.wpisy.slice(),
    historia: stan.historia.concat([{
      kiedy: new Date().toISOString(),
      kto: kto,
      akcja: 'wznowienie_edycji',
      kontekst: kontekst || null,
    }]),
  };
}

/** sgHistoriaKomorki(stan, pracownikId, data, slot) -> WpisHistorii[] - chronologicznie, tylko zmiany tej jednej komórki. */
function sgHistoriaKomorki(stan, pracownikId, data, slot) {
  return stan.historia.filter(function (h) {
    return h.pracownikId === pracownikId && h.data === data && h.slot === slot;
  });
}

/** sgMoznaEdytowac(stan) -> boolean - pomocnicza dla UI (np. wyszarzenie siatki po publikacji). */
function sgMoznaEdytowac(stan) {
  return stan.status === 'roboczy';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sgNowyGrafik: sgNowyGrafik,
    sgZapiszZmiane: sgZapiszZmiane,
    sgOpublikuj: sgOpublikuj,
    sgWznowEdycje: sgWznowEdycje,
    sgHistoriaKomorki: sgHistoriaKomorki,
    sgMoznaEdytowac: sgMoznaEdytowac,
  };
}
