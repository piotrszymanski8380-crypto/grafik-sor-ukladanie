// domain/importGrafikuExcel.js
//
// Import GOTOWEGO grafiku z realnego arkusza oddziału ("płachta_2026.xlsx" i
// podobne) - w odróżnieniu od importu kadry (admin.js, kolumny elastyczne), ten
// arkusz ma ustalony, "papierowy" układ wypracowany latami ręcznej edycji:
// wiersz "Data" z numerami dni, a pod nim KAŻDA osoba zajmuje DWA wiersze
// (1: kod dyżuru per dzień, 2: wolna notatka administratora - Piotr potwierdził
// 2026-09-05: "notatka - informacja dla mnie, niestety excel tego nie liczył",
// więc wiersz 2 jest ZAWSZE zwykłym tekstem, nigdy drugim kodem/realizacją -
// w odróżnieniu od DWUWIERSZOWEGO układu WŁASNEGO eksportu appki (plan+realizacja,
// patrz arkuszGrupy() w podglad.js/admin.js), to inny, starszy format).
//
// Ten plik CELOWO nie zależy od domain/migracjaId.js ani domain/importDopasowania.js
// przez require() (ten sam powód co w warstwaZgodnosci.js - kruche pod Vitest/
// ładowanie <script> - patrz komentarz tam) - ma własną, lokalną kopię
// Levenshteina do dopasowania nazwiska po myślniku (zamiana), a dopasowanie
// GŁÓWNYCH właścicieli wierszy (kto to za osoba) świadomie zostawia wywołującemu
// (panel admina), przez domain/importDopasowania.js - identycznie jak przy imporcie
// kadry: moduł NICZEGO nie zgaduje sam, tylko przygotowuje dane do ekranu decyzji.
//
// Ustalenia z Piotrem (2026-09-05, na podstawie realnego pliku "płachta_2026 -
// testy.xlsx"), wdrożone w iwzNormalizujKod() niżej:
//   D*, N*, d*, n*  -> D/N, ale liczySieDoObsady=false (dyżur osoby wprowadzanej/
//                      szkolonej - Piotr: "nie są brani pod uwagę w ilości osób
//                      na dyżurze").
//   D?, N?, W?      -> D/N/W, ale doSprawdzenia=true (Piotr: "dyżury niepewne,
//                      czy będą, lub propozycje do wyboru" - historyczne dane,
//                      ale appka i tak sygnalizuje do ręcznego potwierdzenia).
//   d, n, w (mała litera, sam znak) -> D/N/W, ale doSprawdzenia=true (Piotr:
//                      "traktowane jak D,N,W oraz jako dodatkowe dyżury u
//                      kontraktów/zleceń lub zamienione dyżury" - znaczenie
//                      zależy od kontekstu, appka nie zgaduje które).
//   D-ch/N-ch/dch/nch/Dch/Nch (dowolna wielkość liter) -> DCH/NCH; samo ch/CH/Ch -> CH.
//   SZKOL/Szkol/szkol/SZKOLE (dowolna wielkość liter, prefiks "szkol") -> S.
//   reh (dowolna wielkość liter) -> PUSTY kod + notatka "rehabilitacja" (Piotr:
//                      "pracownik miał rehabilitację - notatka informacyjna dla
//                      mnie", NIE osobny kod dyżuru/nieobecności).
//   OJCO (dowolna wielkość liter) -> nowy kod OJCO (urlop ojcowski, potwierdzone
//                      przez Piotra) - patrz GRF_KODY_WG_STAWKI_OSOBY w domain/grafik.js.
//   D-Nazwisko/N-Nazwisko (z myślnikiem/spacją i nazwiskiem po nim) -> D/N +
//                      zamianaSurowa = nazwisko do dopasowania (iwzDopasujZamiane
//                      niżej, w drugim etapie, po ustaleniu pełnej listy pracowników).
//   D-/N-/d-/n- (myślnik/spacja BEZ nazwiska po nim) -> D/N, doSprawdzenia=true
//                      ("w oryginale zamiana z kimś, ale brak nazwiska po myślniku").
//   DW/WD/NW/D/N (dwa kody naraz w jednej komórce) -> doSprawdzenia=true, kod=null,
//                      surowy tekst zachowany w notatce - appka NIE zgaduje, który
//                      z dwóch wygrywa.
//   literówki w nazwiskach po myślniku (np. "N-Wójtowiz") -> obsługiwane przez
//                      dopasowanie przybliżone w iwzDopasujZamiane (Piotr: "literówki
//                      zdarzają się"), próg 0.8, w przeciwnym razie do ręcznego
//                      sprawdzenia.
//   wiersz osoby, w którym komórki dni to LICZBY 0-1 (ułamek doby - czas typu
//      "7:35" zapisany jako wartość Excela) zamiast kodów tekstowych -> CAŁA
//      osoba pomijana przy imporcie (Piotr: "Szymański to ja, oddziałowy, pracuję
//      7:00-14:35, to nie dyżury D/N/DOBA") - patrz iwzWykryjWierszGodzinowy.

// ---------- krok 1: znalezienie wiersza "Data" i kolumn dni ----------

/** Wiersz (indeks 0-based w `grid`), w którego kolumnie A jest dosłownie "Data". */
function iwzZnajdzWierszDanych(grid) {
  for (var r = 0; r < grid.length; r++) {
    var wiersz = grid[r];
    if (wiersz && String(wiersz[0] == null ? '' : wiersz[0]).trim() === 'Data') return r;
  }
  return -1;
}

/**
 * iwzKolumnyDni(grid, wierszDanych) -> number[] (indeksy kolumn 0-based, w kolejności
 * dzień 1, 2, 3, ... N) - szuka pierwszej "1" w wierszu "Data" i bierze kolejne
 * kolumny tak długo, jak liczby rosną o 1 (dni 29/30 poprzedniego miesiąca,
 * widoczne w realnym arkuszu PRZED kolumną dnia 1, są w ten sposób pomijane;
 * kolumny podsumowań PO ostatnim dniu miesiąca kończą sekwencję i też odpadają).
 */
function iwzKolumnyDni(grid, wierszDanych) {
  var wiersz = grid[wierszDanych] || [];
  var kolumny = [];
  var oczekiwana = null;
  for (var c = 0; c < wiersz.length; c++) {
    var v = wiersz[c];
    if (typeof v === 'number' && Number.isFinite(v) && Math.floor(v) === v) {
      if (oczekiwana === null) {
        if (v === 1) { kolumny.push(c); oczekiwana = 2; }
        // inaczej: prawdopodobnie dni "29"/"30" poprzedniego miesiąca - pomiń, szukaj dalej "1"
      } else if (v === oczekiwana) {
        kolumny.push(c);
        oczekiwana++;
      } else {
        break;
      }
    } else if (oczekiwana !== null) {
      break; // sekwencja dni przerwana czymś innym niż liczbą - koniec zakresu dni
    }
  }
  return kolumny;
}

// ---------- krok 2: wykrycie wiersza "godzinowego" (osoba spoza D/N/DOBA) ----------

/**
 * iwzWykryjWierszGodzinowy(wartosciDni) -> boolean
 * `wartosciDni` to surowe wartości komórek dnia (row1) tej osoby, w kolejności dni.
 * Jeśli choć jedna komórka to ułamek doby (liczba w (0,1), np. 7:35 zapisane jako
 * czas Excela) I ŻADNA komórka nie jest rozpoznawalnym tekstowym kodem - to nie
 * jest osoba na grafiku D/N/DOBA (patrz komentarz nagłówkowy, "Szymański Piotr").
 */
function iwzWykryjWierszGodzinowy(wartosciDni) {
  var maUlamekGodziny = false;
  var maKodTekstowy = false;
  wartosciDni.forEach(function (v) {
    if (v == null || v === '') return;
    if (typeof v === 'number') {
      if (v > 0 && v < 1) maUlamekGodziny = true;
      return;
    }
    if (typeof v === 'string' && v.trim() !== '' && v.trim() !== '0') maKodTekstowy = true;
  });
  return maUlamekGodziny && !maKodTekstowy;
}

// ---------- krok 3: normalizacja pojedynczej komórki kodu (row1) ----------

/**
 * iwzNormalizujKod(surowy) -> null | { kod, liczySieDoObsady, doSprawdzenia, powod?, zamianaSurowa? }
 * `null` = komórka pusta/bez wpisu (w tym dosłowne "0", obserwowane w realnym
 * arkuszu jako placeholder pustej komórki - patrz KOD (row1) w analizie pliku).
 * Zasady wdrożone dokładnie wg ustaleń z Piotrem - patrz komentarz nagłówkowy pliku.
 */
function iwzNormalizujKod(surowy) {
  if (surowy == null) return null;
  if (typeof surowy === 'number') {
    if (surowy === 0) return null;
    // liczba w komórce dnia poza "0" i poza ułamkiem doby (obsłużonym osobno przez
    // iwzWykryjWierszGodzinowy na poziomie całego wiersza) - appka nie zgaduje co to.
    return { kod: null, liczySieDoObsady: true, doSprawdzenia: true, powod: 'liczbowa wartość w komórce dnia (' + surowy + ') - nierozpoznana' };
  }
  var s = String(surowy).trim();
  if (s === '' || s === '0') return null;

  // CH family - sprawdzane PRZED "zamiana z nazwiskiem", żeby "D-ch"/"N-ch" nie
  // trafiły błędnie do gałęzi zamiany (nazwisko "ch" by nigdy nie zaistniało, ale
  // dla pewności kolejność jest jawna i udokumentowana).
  var mCh = s.match(/^([dn])?[\s-]*ch$/i);
  if (mCh) {
    var prefiksCh = (mCh[1] || '').toLowerCase();
    if (prefiksCh === 'd') return { kod: 'DCH', liczySieDoObsady: true, doSprawdzenia: false };
    if (prefiksCh === 'n') return { kod: 'NCH', liczySieDoObsady: true, doSprawdzenia: false };
    return { kod: 'CH', liczySieDoObsady: true, doSprawdzenia: false };
  }

  // Szkolenie - dowolny wariant wielkości liter zaczynający się od "szkol".
  if (/^szkol/i.test(s)) {
    return { kod: 'S', liczySieDoObsady: true, doSprawdzenia: false };
  }

  // Rehabilitacja - informacja dla Piotra, NIE osobny kod dyżuru/nieobecności.
  if (/^reh$/i.test(s)) {
    return { kod: '', liczySieDoObsady: true, doSprawdzenia: false, notatkaDodatkowa: 'rehabilitacja (import z Excela)' };
  }

  // Urlop ojcowski.
  if (/^ojco$/i.test(s)) {
    return { kod: 'OJCO', liczySieDoObsady: true, doSprawdzenia: false };
  }

  // Proste D/N/W/UW (dowolna wielkość liter) - najpopularniejszy przypadek.
  var mProsty = s.match(/^(d|n|w|uw)$/i);
  if (mProsty) {
    var podstawowy = mProsty[1].toUpperCase();
    var maleLitery = mProsty[1] === mProsty[1].toLowerCase() && podstawowy !== 'UW';
    if (maleLitery) {
      return {
        kod: podstawowy, liczySieDoObsady: true, doSprawdzenia: true,
        powod: 'małą literą w oryginale - może być dodatkowy dyżur (kontrakt/zlecenie) lub zamieniony dyżur, do weryfikacji',
      };
    }
    return { kod: podstawowy, liczySieDoObsady: true, doSprawdzenia: false };
  }

  // Gwiazdka - dyżur osoby wprowadzanej/szkolonej, nie liczy się do obsady.
  var mGwiazdka = s.match(/^([dn])\*$/i);
  if (mGwiazdka) {
    return { kod: mGwiazdka[1].toUpperCase(), liczySieDoObsady: false, doSprawdzenia: false };
  }

  // Znak zapytania - dyżur niepewny/propozycja w oryginalnym arkuszu.
  var mPytajnik = s.match(/^([dnw])\?$/i);
  if (mPytajnik) {
    return {
      kod: mPytajnik[1].toUpperCase(), liczySieDoObsady: true, doSprawdzenia: true,
      powod: 'niepewny dyżur w oryginalnym arkuszu (znak zapytania)',
    };
  }

  // Zamiana z nazwiskiem: "D-Nazwisko", "D- Nazwisko", "N -Nazwisko" itp.
  var mZamiana = s.match(/^([dn])[\s-]+(.+)$/i);
  if (mZamiana && mZamiana[2].trim() !== '') {
    return {
      kod: mZamiana[1].toUpperCase(), liczySieDoObsady: true, doSprawdzenia: false,
      zamianaSurowa: mZamiana[2].trim(),
    };
  }

  // Myślnik bez nazwiska po nim ("D-", "N -", "d- ").
  var mPustaZamiana = s.match(/^([dn])[\s-]+$/i);
  if (mPustaZamiana) {
    return {
      kod: mPustaZamiana[1].toUpperCase(), liczySieDoObsady: true, doSprawdzenia: true,
      powod: 'w oryginale zamiana z kimś, ale brak nazwiska po myślniku',
    };
  }

  // Kombinacje dwóch kodów naraz (DW/WD/NW/D/N itp.) i wszystko inne nierozpoznane -
  // appka świadomie NIE zgaduje, zostawia do ręcznego rozpisania.
  return { kod: null, liczySieDoObsady: true, doSprawdzenia: true, powod: 'nierozpoznany zapis: "' + s + '"' };
}

// ---------- krok 4: parsowanie CAŁEGO arkusza (bez znajomości listy pracowników) ----------

/**
 * iwzParsujArkusz(grid) -> { nazwiska, wierszeOsob, pominieciOsob }
 * `grid`: tablica wierszy (jak z XLSX.utils.sheet_to_json(ws, {header:1, raw:true})) -
 * grid[r][c], indeksy 0-based.
 *
 * Celowo NIE przyjmuje listy pracowników - dopasowanie "to nazwisko z Excela = ten
 * pracownik w appce" to decyzja człowieka (ekran dopasowania, domain/importDopasowania.js),
 * nie coś, co ten moduł ma zgadywać. Zwraca surowe nazwiska + ich dane dnia po dniu;
 * iwzZbudujWpisy() (niżej) dokańcza po podjęciu tamtej decyzji.
 */
function iwzParsujArkusz(grid) {
  var wierszDanych = iwzZnajdzWierszDanych(grid);
  if (wierszDanych === -1) {
    return { nazwiska: [], wierszeOsob: [], pominieciOsob: [], blad: 'Nie znaleziono wiersza "Data" - to nie wygląda na arkusz płachty.' };
  }
  var kolumnyDni = iwzKolumnyDni(grid, wierszDanych);
  if (kolumnyDni.length === 0) {
    return { nazwiska: [], wierszeOsob: [], pominieciOsob: [], blad: 'Wiersz "Data" nie zawiera rozpoznawalnej sekwencji dni 1..N.' };
  }

  var nazwiska = [];
  var wierszeOsob = [];
  var pominieciOsob = [];

  var r = wierszDanych + 1;
  while (r < grid.length) {
    var etykieta = grid[r] && grid[r][0];
    if (etykieta == null || String(etykieta).trim() === '') { r++; continue; }
    var nazwisko = String(etykieta).trim();
    var wierszKod = grid[r] || [];
    var wierszNotatka = grid[r + 1] || [];

    var wartosciDni = kolumnyDni.map(function (c) { return wierszKod[c]; });
    if (iwzWykryjWierszGodzinowy(wartosciDni)) {
      pominieciOsob.push({ nazwisko: nazwisko, powod: 'wiersz zawiera godziny (np. czas pracy oddziałowej) zamiast kodów D/N/DOBA - pominięto przy imporcie grafiku.' });
      r += 2;
      continue;
    }

    var dni = [];
    kolumnyDni.forEach(function (c, i) {
      var znormalizowany = iwzNormalizujKod(wierszKod[c]);
      var notatkaRaw = wierszNotatka[c];
      var notatka = (notatkaRaw != null && String(notatkaRaw).trim() !== '') ? String(notatkaRaw).trim() : '';
      if (!znormalizowany) {
        if (notatka) dni.push({ dzien: i + 1, kod: '', notatka: notatka, liczySieDoObsady: true, doSprawdzenia: false });
        return;
      }
      var wpisDnia = {
        dzien: i + 1,
        kod: znormalizowany.kod,
        liczySieDoObsady: znormalizowany.liczySieDoObsady,
        doSprawdzenia: !!znormalizowany.doSprawdzenia,
        powod: znormalizowany.powod,
        zamianaSurowa: znormalizowany.zamianaSurowa,
        notatka: [znormalizowany.notatkaDodatkowa, notatka].filter(Boolean).join(' / '),
      };
      dni.push(wpisDnia);
    });

    if (nazwiska.indexOf(nazwisko) === -1) nazwiska.push(nazwisko);
    wierszeOsob.push({ nazwisko: nazwisko, dni: dni });
    r += 2;
  }

  return { nazwiska: nazwiska, wierszeOsob: wierszeOsob, pominieciOsob: pominieciOsob };
}

// ---------- krok 5: dopasowanie nazwiska po myślniku (zamiana) do pracownika ----------
// Lokalna kopia Levenshteina/podobieństwa (patrz komentarz nagłówkowy - celowo bez
// require('./migracjaId.js')) - działa na POJEDYNCZYCH TOKENACH (samo nazwisko po
// myślniku, np. "Żyłowska"), NIE na całych "Imię Nazwisko" jak migracjaId.podobienstwo
// (tamten dopasowuje głównego właściciela wiersza, tu dopasowujemy tylko surowe
// nazwisko partnera zamiany do JEDNEGO z tokenów pełnego imienia i nazwiska).

function iwzNormalizujToken(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function iwzOdlegloscLevenshteina(a, b) {
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
      wiersz[j2] = a[i - 1] === b[j2 - 1] ? poprzedniPrzekatny : 1 + Math.min(poprzedniPrzekatny, wiersz[j2], wiersz[j2 - 1]);
      poprzedniPrzekatny = temp;
    }
  }
  return wiersz[n];
}

function iwzPodobienstwoTokenow(a, b) {
  var ta = iwzNormalizujToken(a), tb = iwzNormalizujToken(b);
  if (ta === tb) return 1;
  var dist = iwzOdlegloscLevenshteina(ta, tb);
  var maxLen = Math.max(ta.length, tb.length) || 1;
  return 1 - dist / maxLen;
}

/**
 * iwzDopasujZamiane(surowyTekst, pracownicy, prog) -> { id, pewne, przyblizone, podobienstwo, kandydaci }
 * `pracownicy`: [{ id, imieNazwisko }] - PEŁNA, już zatwierdzona lista (po ekranie
 * dopasowania głównych właścicieli wierszy). Szuka tokenu (słowa) w imieNazwisko,
 * który dokładnie/w przybliżeniu (>= prog) odpowiada `surowyTekst` (samo nazwisko,
 * bez imienia - tak zapisuje Piotr zamiany w arkuszu).
 */
function iwzDopasujZamiane(surowyTekst, pracownicy, prog) {
  prog = prog == null ? 0.8 : prog;
  var szukany = iwzNormalizujToken(surowyTekst);
  var dokladni = [];
  pracownicy.forEach(function (p) {
    var tokeny = iwzNormalizujToken(p.imieNazwisko).split(/\s+/).filter(Boolean);
    if (tokeny.indexOf(szukany) !== -1) dokladni.push(p);
  });
  if (dokladni.length === 1) {
    return { id: dokladni[0].id, pewne: true, przyblizone: false };
  }
  if (dokladni.length > 1) {
    return { id: null, pewne: false, przyblizone: false, kandydaci: dokladni.map(function (p) { return p.id; }) };
  }

  var najlepszy = null, najlepszePodobienstwo = 0;
  pracownicy.forEach(function (p) {
    iwzNormalizujToken(p.imieNazwisko).split(/\s+/).filter(Boolean).forEach(function (t) {
      var sim = iwzPodobienstwoTokenow(szukany, t);
      if (sim > najlepszePodobienstwo) { najlepszePodobienstwo = sim; najlepszy = p; }
    });
  });
  if (najlepszy && najlepszePodobienstwo >= prog) {
    return { id: najlepszy.id, pewne: true, przyblizone: true, podobienstwo: Math.round(najlepszePodobienstwo * 100) / 100 };
  }
  return { id: null, pewne: false, przyblizone: false };
}

// ---------- krok 6: złożenie finalnych wpisów po dopasowaniu nazwisk ----------

/**
 * iwzZbudujWpisy(wierszeOsob, przypisaniaNazwisk, pracownicy, rok, miesiac) ->
 *   { wpisy, doSprawdzenia }
 *
 * `przypisaniaNazwisk`: { [nazwisko]: pracownikId } - wynik ekranu dopasowania
 * głównych właścicieli wierszy (domain/importDopasowania.js: idZatwierdzDecyzje().przypisania).
 * `pracownicy`: pełna, aktualna lista (do dopasowania PARTNERÓW zamiany, patrz
 * iwzDopasujZamiane wyżej - używa ID z `przypisaniaNazwisk`, żeby zamiana mogła
 * wskazywać też na kogoś dopiero co dodanego przez ten sam import).
 *
 * `wpisy`: [{ pracownikId, data, slot: 1, kod, kodRealizacji?, zamianaZId?, notatka?,
 *   liczySieDoObsady }] - `liczySieDoObsady` NIE jest dziś polem modelu stanGrafiku;
 *   appka (obsadaDnia/obsadaPielegniarekDnia) musi zostać rozszerzona, żeby je
 *   uwzględnić (patrz osobne zadanie) - tu jest już obliczone i gotowe do zapisania.
 * `doSprawdzenia`: [{ pracownikId, nazwisko, data, powod, oryginalnyZapis? }] - do
 *   pokazania administratorowi PO imporcie (appka niczego nie ukrywa/nie blokuje).
 */
function iwzZbudujWpisy(wierszeOsob, przypisaniaNazwisk, pracownicy, rok, miesiac) {
  var wpisy = [];
  var doSprawdzenia = [];

  wierszeOsob.forEach(function (osoba) {
    var pracownikId = przypisaniaNazwisk[osoba.nazwisko];
    if (!pracownikId) {
      doSprawdzenia.push({ pracownikId: null, nazwisko: osoba.nazwisko, data: null, powod: 'brak przypisania do pracownika - pominięto cały wiersz.' });
      return;
    }
    osoba.dni.forEach(function (d) {
      var data = rok + '-' + String(miesiac).padStart(2, '0') + '-' + String(d.dzien).padStart(2, '0');
      if (!d.kod && !d.notatka) return; // pusta komórka i brak notatki - nic do zapisania

      var zamianaZId;
      if (d.zamianaSurowa) {
        var dopasowanie = iwzDopasujZamiane(d.zamianaSurowa, pracownicy);
        if (dopasowanie.id) {
          zamianaZId = dopasowanie.id;
          if (dopasowanie.przyblizone) {
            doSprawdzenia.push({
              pracownikId: pracownikId, nazwisko: osoba.nazwisko, data: data,
              powod: 'zamiana dopasowana PRZYBLIŻONO do "' + d.zamianaSurowa + '" (podobieństwo ' + dopasowanie.podobienstwo + ') - sprawdź czy to właściwa osoba.',
            });
          }
        } else {
          doSprawdzenia.push({
            pracownikId: pracownikId, nazwisko: osoba.nazwisko, data: data,
            powod: (dopasowanie.kandydaci && dopasowanie.kandydaci.length > 1
              ? 'zamiana z "' + d.zamianaSurowa + '" pasuje do KILKU osób naraz - wybierz ręcznie.'
              : 'nie udało się dopasować zamiany z "' + d.zamianaSurowa + '" do żadnego pracownika.'),
          });
        }
      }

      if (d.doSprawdzenia) {
        doSprawdzenia.push({ pracownikId: pracownikId, nazwisko: osoba.nazwisko, data: data, powod: d.powod });
      }

      wpisy.push({
        pracownikId: pracownikId,
        data: data,
        slot: 1,
        kod: d.kod || '',
        zamianaZId: zamianaZId,
        notatka: d.notatka || undefined,
        liczySieDoObsady: d.liczySieDoObsady !== false,
      });
    });
  });

  return { wpisy: wpisy, doSprawdzenia: doSprawdzenia };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    iwzZnajdzWierszDanych: iwzZnajdzWierszDanych,
    iwzKolumnyDni: iwzKolumnyDni,
    iwzWykryjWierszGodzinowy: iwzWykryjWierszGodzinowy,
    iwzNormalizujKod: iwzNormalizujKod,
    iwzParsujArkusz: iwzParsujArkusz,
    iwzPodobienstwoTokenow: iwzPodobienstwoTokenow,
    iwzDopasujZamiane: iwzDopasujZamiane,
    iwzZbudujWpisy: iwzZbudujWpisy,
  };
}
