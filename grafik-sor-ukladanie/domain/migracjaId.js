// domain/migracjaId.js
//
// Krok 0 (specyfikacja, sekcja 7 - warunek wstępny): dziś pracownik to string z
// imieniem i nazwiskiem w płaskich listach (EMPLOYEES/OPIEKUNOWIE w js/rdzen.js),
// a moduły trzymają dane pod kluczem "grupa::imie" (dokładny string, patrz
// haslaKey w js/rdzen.js i api/settings.js) - BEZ fuzzy matchingu, bo `imie`
// zawsze pochodzi z tej samej listy przez <select>. Rozmyte dopasowanie
// (wnNormName, js/wnioski.js:108) jest używane w JEDNYM miejscu: dopasowanie
// freeform nazwisk z zaimportowanego arkusza Excela (mergeWnioskiToWorkbook,
// js/rdzen.js) do kanonicznej listy wniosków. To jest właściwy odpowiednik
// problemu, który rozwiązuje ten moduł dla edytora grafiku: nazwiska wpisane
// ręcznie w Excelu (parseGrafikExcel) trzeba dopasować do kanonicznej listy
// EMPLOYEES/OPIEKUNOWIE i nadać im stały `id`.
//
// normalizujNazwisko() celowo odtwarza DOKŁADNIE ten sam algorytm co wnNormName
// (lowercase + Unicode NFD + usunięcie znaków diakrytycznych + spacje), żeby
// wynik dopasowania w tym module był spójny z tym, co appka już robi gdzie indziej.
// Różnica: wnNormName NIE radzi sobie z zamienioną kolejnością "Jan Kowalski" vs
// "Kowalski Jan" - tutaj dokładamy DODATKOWĄ warstwę (tokenyPosortowane,
// podobienstwo) tylko do wykrywania podejrzanych duplikatów, nie zamiast
// normalizujNazwisko.
//
// Użycie (poza appką, jednorazowo, Krok 0):
//   1. Wyeksportować z appki listę EMPLOYEES/OPIEKUNOWIE (kanoniczna, źródło
//      prawdy) + wszystkie unikalne nazwiska pojawiające się w zaimportowanych
//      arkuszach Excela (entries[].name z parseGrafikExcel).
//   2. zbudujMapowanieId(EMPLOYEES, 'p') / zbudujMapowanieId(OPIEKUNOWIE, 'o') -
//      przydziela stałe ID kanonicznej liście, w kolejności wejściowej.
//   3. znajdzMozliweDuplikaty(...) - lista par do RĘCZNEGO przejrzenia, zanim
//      mapowanie zostanie zatwierdzone (literówki, warianty zapisu).
//   4. Dla nazwisk z Excela bez dokładnego dopasowania po normalizacji: ekran
//      "dopasuj nazwisko do ID" w edytorze (F1.7 w TASKS.md) - człowiek wybiera
//      z listy kandydatów.

// ---------- normalizacja (zgodna z wnNormName, js/wnioski.js) ----------

function normalizujNazwisko(surowe) {
  return String(surowe || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // zakres znaków diakrytycznych Unicode - to samo co [̀-ͯ] w wnNormName
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokeny posortowane alfabetycznie - wychwytuje zamianę kolejności "Jan Kowalski" vs "Kowalski Jan". Używane TYLKO do wykrywania duplikatów, nie jako klucz podstawowy (wnNormName tego nie robi). */
function tokenyPosortowane(nazwisko) {
  return normalizujNazwisko(nazwisko).split(' ').filter(Boolean).sort().join(' ');
}

// ---------- odległość Levenshteina i podobieństwo 0-1 ----------

function odlegloscLevenshteina(a, b) {
  var m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  var wiersz = new Array(n + 1);
  for (var j = 0; j <= n; j++) wiersz[j] = j;
  for (var i = 1; i <= m; i++) {
    var poprzedniPrzekatny = wiersz[0];
    wiersz[0] = i;
    for (var j2 = 1; j2 <= n; j2++) {
      var temp = wiersz[j2];
      wiersz[j2] = a[i - 1] === b[j2 - 1]
        ? poprzedniPrzekatny
        : 1 + Math.min(poprzedniPrzekatny, wiersz[j2], wiersz[j2 - 1]);
      poprzedniPrzekatny = temp;
    }
  }
  return wiersz[n];
}

/** Podobieństwo dwóch nazwisk w skali 0-1 (1 = identyczne po tokenyPosortowane). */
function podobienstwo(a, b) {
  var ta = tokenyPosortowane(a), tb = tokenyPosortowane(b);
  if (ta === tb) return 1;
  var dist = odlegloscLevenshteina(ta, tb);
  var maxLen = Math.max(ta.length, tb.length) || 1;
  return 1 - dist / maxLen;
}

// ---------- przydzielanie stałych ID ----------

/**
 * zbudujMapowanieId(nazwiska, prefiks) -> [{ nazwisko, nazwiskoZnormalizowane, id }]
 * Deduplikuje po tokenyPosortowane (identyczne po normalizacji = ta sama osoba,
 * jedno ID), przydziela ID w kolejności pierwszego wystąpienia - stabilnie między
 * uruchomieniami dla tej samej kolejności wejścia (np. kolejność z EMPLOYEES).
 */
function zbudujMapowanieId(nazwiska, prefiks) {
  prefiks = prefiks || 'p';
  var widziane = {}; // znormalizowane -> id
  var licznik = 0;
  var wynik = [];
  nazwiska.forEach(function (nazwisko) {
    var klucz = tokenyPosortowane(nazwisko);
    if (Object.prototype.hasOwnProperty.call(widziane, klucz)) {
      wynik.push({ nazwisko: nazwisko, nazwiskoZnormalizowane: klucz, id: widziane[klucz] });
      return;
    }
    licznik++;
    var id = prefiks + String(licznik).padStart(2, '0');
    widziane[klucz] = id;
    wynik.push({ nazwisko: nazwisko, nazwiskoZnormalizowane: klucz, id: id });
  });
  return wynik;
}

// ---------- wykrywanie potencjalnych duplikatów (RÓŻNE zapisy, PODOBNE, nie identyczne) ----------

/**
 * znajdzMozliweDuplikaty(nazwiska, prog) -> [{ a, b, podobienstwo }]
 * Pary nazwisk, które NIE są identyczne po normalizacji, ale są do siebie na tyle
 * podobne (>= prog), że mogą być tą samą osobą zapisaną z literówką/inaczej.
 * Lista do RĘCZNEJ decyzji - moduł niczego nie scala sam.
 */
function znajdzMozliweDuplikaty(nazwiska, prog) {
  prog = prog == null ? 0.82 : prog;
  var unikalne = [];
  nazwiska.forEach(function (n) {
    var t = String(n).trim();
    if (unikalne.indexOf(t) === -1) unikalne.push(t);
  });
  var pary = [];
  for (var i = 0; i < unikalne.length; i++) {
    for (var j = i + 1; j < unikalne.length; j++) {
      var a = unikalne[i], b = unikalne[j];
      if (tokenyPosortowane(a) === tokenyPosortowane(b)) continue; // to już ta sama osoba wg zbudujMapowanieId
      var sim = podobienstwo(a, b);
      if (sim >= prog) pary.push({ a: a, b: b, podobienstwo: Math.round(sim * 100) / 100 });
    }
  }
  return pary.sort(function (x, y) { return y.podobienstwo - x.podobienstwo; });
}

// ---------- raport źródeł wystąpień (grafik / wnioski / urlopy / zamiany) ----------

/**
 * zrodlaWystapien(zrodla) -> { [nazwiskoZnormalizowane]: string[] modułów }
 * zrodla: { grafik: ['Kowalczyk Marta', ...], wnioski: [...], urlopy: [...], zamiany: [...] }
 * Pomocne przy kontroli: osoba widoczna tylko w jednym module (np. tylko w
 * arkuszu Excela, nigdy w EMPLOYEES) może być literówką, nie realnym pracownikiem.
 */
function zrodlaWystapien(zrodla) {
  var mapa = {};
  Object.keys(zrodla).forEach(function (modul) {
    zrodla[modul].forEach(function (nazwisko) {
      var klucz = tokenyPosortowane(nazwisko);
      mapa[klucz] = mapa[klucz] || [];
      if (mapa[klucz].indexOf(modul) === -1) mapa[klucz].push(modul);
    });
  });
  return mapa;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizujNazwisko: normalizujNazwisko,
    podobienstwo: podobienstwo,
    zbudujMapowanieId: zbudujMapowanieId,
    znajdzMozliweDuplikaty: znajdzMozliweDuplikaty,
    zrodlaWystapien: zrodlaWystapien,
  };
}
