// domain/warstwaZgodnosci.js
//
// Warstwa zgodności (F1.8, specyfikacja sekcja 7): tłumaczy nowy model rekordowy
// {pracownikId, data, slot, kod, notatka} na format, w jakim NAPRAWDĘ zapisany
// jest `grafik/data.json` - potwierdzone czytaniem js/grafik.js (parseGrafikExcel,
// hgParsujArkusz), NIE zgadywane:
//
//   payload zapisywany przez api/grafik.js = { data: {...}, meta: {...} }
//   data = {
//     "<miesiąc, np. 'listopad'>": { entries: [
//        {type:'employee', name:'Kowalczyk Marta', row1:{"1":"D","2":"N",...},
//         row2:{...}, c1?:{"5":"komentarz z Excela"}, c2?:{...}},
//        {type:'gap'},   // pusty wiersz separujący grupy w arkuszu Excela
//        ...
//     ]},
//     "Opie-<miesiąc>": { entries: [...] }   // grupa opiekunów, osobny "arkusz"
//   }
//
// UWAGA: "entries" to TABLICA w kolejności z arkusza Excela (z {type:'gap'} jako
// separatorami), NIE obiekt keyowany nazwiskiem. Klucze dni w row1/row2/c1/c2 to
// stringi BEZ zera wiodącego ("5", nie "05") - dokładnie jak buduje je hgParsujArkusz.
//
// Ten plik CELOWO nie zależy od domain/grafik.js (nawet od jego drobnego dodajDni) -
// próba dzielenia się funkcją między dwoma plikami domain/*.js ładowanymi jako
// osobne <script> okazała się kruncha przy testowaniu (Vitest/Vite nie robi
// spójnego CJS-interop dla require() jednego pliku domain/*.js z drugiego, mimo
// że dokładnie ten sam mechanizm działa dla `import` w pliku testowym - sprawdzone
// empirycznie). Zamiast tego: mała, w pełni lokalna kopia dodajDni (6 linii) -
// prostsze i pewniejsze niż próba współdzielenia kodu między klasycznymi <script>.
function wzDodajDni(data, n) {
  var czesci = data.split('-').map(Number);
  var d = new Date(Date.UTC(czesci[0], czesci[1] - 1, czesci[2]));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Nazwy miesięcy jak w js/grafik.js (HG_ARKUSZE_GLOWNE) - MUSI zostać z nim zgodne.
// Nie można stamtąd zaimportować: domain/*.js ładuje się PRZED js/grafik.js w
// index.html (patrz kolejność <script>), więc duplikujemy tę małą stałą świadomie
// i pilnujemy zgodności ręcznie przy zmianach.
const WZ_MIESIACE = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

function wzKluczArkusza(miesiac, grupa) {
  var nazwa = WZ_MIESIACE[miesiac - 1];
  return grupa === 'opie' ? 'Opie-' + nazwa : nazwa;
}

/**
 * rekordyDoHarmonogramu(wpisy, pracownicy, rok, miesiac) -> obiekt jak pole "data"
 * w grafik/data.json. `pracownicy` musi mieć `imieNazwisko` i `grupa` ('main'/'opie') -
 * kolejność listy `pracownicy` ustala kolejność wierszy w wynikowych entries (tak jak
 * kolejność wierszy w oryginalnym arkuszu Excela).
 */
function rekordyDoHarmonogramu(wpisy, pracownicy, rok, miesiac) {
  var prefiks = rok + '-' + String(miesiac).padStart(2, '0') + '-';
  var perGrupa = { main: [], opie: [] };

  pracownicy.forEach(function (p) {
    var grupa = p.grupa === 'opie' ? 'opie' : 'main';
    var entry = { type: 'employee', name: p.imieNazwisko, row1: {}, row2: {} };
    var c1 = {}, c2 = {}, maC1 = false, maC2 = false;

    wpisy.forEach(function (w) {
      if (w.pracownikId !== p.id) return;
      if (w.data.indexOf(prefiks) !== 0) return; // spoza podanego miesiąca
      var dzien = String(Number(w.data.slice(8, 10)));
      var pole = w.slot === 2 ? 'row2' : 'row1';
      entry[pole][dzien] = w.kod;
      if (w.notatka) {
        if (w.slot === 2) { c2[dzien] = w.notatka; maC2 = true; }
        else { c1[dzien] = w.notatka; maC1 = true; }
      }
    });

    if (maC1) entry.c1 = c1;
    if (maC2) entry.c2 = c2;
    perGrupa[grupa].push(entry);
  });

  var dokument = {};
  if (perGrupa.main.length) dokument[wzKluczArkusza(miesiac, 'main')] = { entries: perGrupa.main };
  if (perGrupa.opie.length) dokument[wzKluczArkusza(miesiac, 'opie')] = { entries: perGrupa.opie };
  return dokument;
}

/**
 * harmonogramDoRekordow(dokument, pracownicy, rok, miesiac) -> wpisy[]
 * Odwrotność - do testów round-trip i jako punkt wyjścia Kroku 0 (wczytanie
 * istniejącego grafik/data.json do nowego modelu rekordowego, jednorazowo).
 * `pracownicy` musi mieć `imieNazwisko`/`grupa` uzupełnione (po dopasowaniu ID -
 * patrz domain/migracjaId.js); wpisy dla nazwisk bez dopasowania są POMIJANE
 * (do rozstrzygnięcia ręcznie w ekranie dopasowania, nie cichym utratą danych -
 * ale trzeba mieć świadomość, że tu faktycznie znikają z wyniku).
 */
function harmonogramDoRekordow(dokument, pracownicy, rok, miesiac) {
  var prefiks = rok + '-' + String(miesiac).padStart(2, '0') + '-';
  var wpisy = [];

  ['main', 'opie'].forEach(function (grupa) {
    var klucz = wzKluczArkusza(miesiac, grupa);
    var sekcja = dokument[klucz];
    if (!sekcja || !Array.isArray(sekcja.entries)) return;

    sekcja.entries.forEach(function (entry) {
      if (entry.type !== 'employee') return;
      var p = pracownicy.filter(function (x) {
        return x.imieNazwisko === entry.name && (x.grupa || 'main') === grupa;
      })[0];
      if (!p) return;

      [['row1', 1, 'c1'], ['row2', 2, 'c2']].forEach(function (t) {
        var pole = t[0], slot = t[1], poleKomentarz = t[2];
        var dni = entry[pole] || {};
        var komentarze = entry[poleKomentarz] || {};
        Object.keys(dni).forEach(function (dzien) {
          var kod = dni[dzien];
          if (!kod) return;
          var data = prefiks + String(dzien).padStart(2, '0');
          var wpis = { pracownikId: p.id, data: data, slot: slot, kod: kod };
          if (komentarze[dzien]) wpis.notatka = komentarze[dzien];
          wpisy.push(wpis);
        });
      });
    });
  });

  return wpisy;
}

/**
 * graniczneDniPoprzedniegoMiesiaca(rok, miesiac, iloscDni) - pomocnicze przy
 * sprawdzaniu W3 na styku miesięcy (ostatni dzień poprzedniego miesiąca wpływa
 * na 1. dzień bieżącego, a wpisy z osobnych publikacji miesięcznych domyślnie
 * o tym "nie wiedzą" - warto podać je razem przy walidacji 1. dnia miesiąca).
 */
function graniczneDniPoprzedniegoMiesiaca(rok, miesiac, iloscDni) {
  iloscDni = iloscDni || 1;
  var pierwszyDzien = rok + '-' + String(miesiac).padStart(2, '0') + '-01';
  var dni = [];
  var d = pierwszyDzien;
  for (var i = 0; i < iloscDni; i++) {
    d = wzDodajDni(d, -1);
    dni.unshift(d);
  }
  return dni;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WZ_MIESIACE: WZ_MIESIACE,
    wzKluczArkusza: wzKluczArkusza,
    rekordyDoHarmonogramu: rekordyDoHarmonogramu,
    harmonogramDoRekordow: harmonogramDoRekordow,
    graniczneDniPoprzedniegoMiesiaca: graniczneDniPoprzedniegoMiesiaca,
  };
}
