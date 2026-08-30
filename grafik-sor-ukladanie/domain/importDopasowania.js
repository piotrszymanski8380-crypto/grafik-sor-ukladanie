// domain/importDopasowania.js
//
// F1 Import - "Ekran dopasowania nazwisk do ID" (TASKS.md, sekcja Import) - buduje
// na domain/migracjaId.js (Krok 0): tam nazwiska KANONICZNEJ listy (EMPLOYEES/
// OPIEKUNOWIE) dostają stałe ID (zbudujMapowanieId). Ten moduł rozwiązuje NASTĘPNY
// krok: gdy import z Excela (parseGrafikExcel, entries[].name) natrafi na nazwisko,
// które nie pasuje dokładnie do żadnego ID z tej kanonicznej listy - czy to
// literówka istniejącej osoby (pokaż kandydatów wg podobieństwa), czy naprawdę
// nowa osoba (przydziel nowe ID)? Moduł NICZEGO nie zatwierdza sam - przygotowuje
// dane do ekranu i stosuje DECYZJĘ CZŁOWIEKA (idZatwierdzDecyzje).
//
// Jak domain/polautomat.js, ten plik NIE zależy od domain/migracjaId.js przez
// require/import (zawodne pod Vitest/Vite - patrz komentarz w polautomat.js i
// JAK-WDROZYC.md) - przyjmuje `silnik` (funkcja podobienstwo() z migracjaId.js)
// jako parametr wstrzykiwany. W przeglądarce, przy zachowaniu kolejności
// <script> z JAK-WDROZYC.md, można go pominąć - funkcje same sięgną po
// globale zdefiniowane przez migracjaId.js.

function idSilnikDomyslny() {
  if (typeof podobienstwo !== 'undefined') {
    return { podobienstwo: podobienstwo };
  }
  return null; // w Node/Vitest trzeba podać `silnik` jawnie (patrz testy)
}

/**
 * idDopasujNazwisko(nazwisko, mapowanieKanoniczne, prog, silnik) -> Dopasowanie
 *
 * mapowanieKanoniczne: [{ nazwisko, nazwiskoZnormalizowane, id }] - wynik
 * zbudujMapowanieId() z domain/migracjaId.js, ZATWIERDZONY wcześniej przez
 * administratora (Krok 0, TASKS.md).
 *
 * Dopasowanie:
 *   { nazwisko, wynik: 'dokladne', id }
 *     - nazwisko z importu jest identyczne (po normalizacji) z pozycją kanoniczną,
 *       żadna decyzja człowieka nie jest potrzebna.
 *   { nazwisko, wynik: 'kandydaci', kandydaci: [{ id, nazwisko, podobienstwo }] }
 *     - jest >=1 podobna pozycja kanoniczna (>= prog) - układający musi wybrać
 *       "to ta sama osoba" (któryś z kandydatów) albo "to jednak nowa osoba".
 *   { nazwisko, wynik: 'brak' }
 *     - brak podobnych pozycji - prawdopodobnie naprawdę nowa osoba, ale i tak
 *       wymaga jawnej decyzji człowieka (idZatwierdzDecyzje), moduł nie zgaduje.
 */
function idDopasujNazwisko(nazwisko, mapowanieKanoniczne, prog, silnik) {
  silnik = silnik || idSilnikDomyslny();
  prog = prog == null ? 0.82 : prog;

  // UWAGA: dokładne dopasowanie sprawdzamy przez silnik.podobienstwo(...) === 1,
  // NIE przez porównanie nazwiskoZnormalizowane stringów - podobienstwo() w
  // migracjaId.js liczy identyczność po tokenyPosortowane (sortuje człony
  // nazwiska), co nie jest tym samym co zwykła normalizacja (kolejność
  // imię/nazwisko może się różnić). Używamy tej samej funkcji co
  // zbudujMapowanieId()/znajdzMozliweDuplikaty(), żeby "dokładne" tu miało
  // dokładnie to samo znaczenie co "ta sama osoba" tam.
  var idWidziane = {};
  var dokladneId = null;
  var kandydaci = [];
  mapowanieKanoniczne.forEach(function (m) {
    if (idWidziane[m.id]) return; // jeden kandydat na ID, nawet gdy mapowanie ma >1 wiersz tej samej osoby
    var sim = silnik.podobienstwo(nazwisko, m.nazwisko);
    if (sim === 1) {
      dokladneId = m.id;
      idWidziane[m.id] = true;
      return;
    }
    if (sim >= prog) {
      idWidziane[m.id] = true;
      kandydaci.push({ id: m.id, nazwisko: m.nazwisko, podobienstwo: Math.round(sim * 100) / 100 });
    }
  });

  if (dokladneId) {
    return { nazwisko: nazwisko, wynik: 'dokladne', id: dokladneId };
  }
  if (kandydaci.length > 0) {
    kandydaci.sort(function (a, b) { return b.podobienstwo - a.podobienstwo; });
    return { nazwisko: nazwisko, wynik: 'kandydaci', kandydaci: kandydaci };
  }

  return { nazwisko: nazwisko, wynik: 'brak' };
}

/**
 * idDopasujListe(nazwiska, mapowanieKanoniczne, prog, silnik) -> { dopasowania, podsumowanie }
 * `nazwiska` powinny być już zdeduplikowane przez wywołującego (ekran importu) -
 * ten moduł dopasowuje każde wejście osobno, jedno wejście = jedna pozycja do
 * przejrzenia na ekranie.
 */
function idDopasujListe(nazwiska, mapowanieKanoniczne, prog, silnik) {
  var dopasowania = nazwiska.map(function (n) {
    return idDopasujNazwisko(n, mapowanieKanoniczne, prog, silnik);
  });
  var podsumowanie = { dokladne: 0, kandydaci: 0, brak: 0 };
  dopasowania.forEach(function (d) { podsumowanie[d.wynik] = (podsumowanie[d.wynik] || 0) + 1; });
  return { dopasowania: dopasowania, podsumowanie: podsumowanie };
}

/**
 * idZatwierdzDecyzje(dopasowania, decyzje, prefiksNowyId, licznikStartowy) ->
 *   { mapowanieDopisane, przypisania, brakDecyzji }
 *
 * Stosuje decyzje układającego dla wpisów 'kandydaci'/'brak' z idDopasujListe():
 *   decyzje: { [nazwisko]: { typ: 'istniejacy', id } | { typ: 'nowy' } }
 * 'dokladne' nie wymaga decyzji - ma już id z mapowania kanonicznego.
 *
 * Zwraca:
 *   mapowanieDopisane: nowe wiersze [{ nazwisko, id }] do DOPISANIA do mapowania
 *                       kanonicznego (tylko dla decyzji typ:'nowy') - wywołujący
 *                       decyduje, kiedy i gdzie to trwale zapisać.
 *   przypisania:        { [nazwisko]: id } - kompletna mapa nazwisko->id, dla
 *                       wszystkich wejść z decyzją (+ 'dokladne').
 *   brakDecyzji:        string[] - nazwiska bez podjętej decyzji (ekran powinien
 *                       wymusić decyzję dla KAŻDEJ pozycji przed zatwierdzeniem
 *                       całego importu).
 */
function idZatwierdzDecyzje(dopasowania, decyzje, prefiksNowyId, licznikStartowy) {
  decyzje = decyzje || {};
  prefiksNowyId = prefiksNowyId || 'p';
  var licznik = licznikStartowy || 0;
  var mapowanieDopisane = [];
  var przypisania = {};
  var brakDecyzji = [];

  dopasowania.forEach(function (d) {
    if (d.wynik === 'dokladne') {
      przypisania[d.nazwisko] = d.id;
      return;
    }
    var decyzja = decyzje[d.nazwisko];
    if (!decyzja) {
      brakDecyzji.push(d.nazwisko);
      return;
    }
    if (decyzja.typ === 'istniejacy') {
      przypisania[d.nazwisko] = decyzja.id;
      return;
    }
    if (decyzja.typ === 'nowy') {
      licznik++;
      var noweId = prefiksNowyId + String(licznik).padStart(2, '0');
      mapowanieDopisane.push({ nazwisko: d.nazwisko, id: noweId });
      przypisania[d.nazwisko] = noweId;
    }
  });

  return { mapowanieDopisane: mapowanieDopisane, przypisania: przypisania, brakDecyzji: brakDecyzji };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    idDopasujNazwisko: idDopasujNazwisko,
    idDopasujListe: idDopasujListe,
    idZatwierdzDecyzje: idZatwierdzDecyzje,
  };
}
