// domain/grafik.js
//
// Silnik reguł walidacji grafiku dyżurów SOR (W1-W15) - czysta logika, bez DOM/
// fetch, zgodnie z konwencją repo (patrz AGENTS.md sekcja "Testy" i istniejące
// domain/urlopy.js, domain/wnioski.js). Ładowany w index.html jako zwykły
// <script src="domain/grafik.js"> PRZED głównym inline scriptem - deklaracje
// poniżej stają się zwykłymi globalami dla reszty appki. Ten sam plik wczytuje
// też Vitest przez import (interop z module.exports na dole pliku).
//
// Bazuje na SPECYFIKACJA-grafik-dyzurow-SOR.md (sekcja 6: reguły, sekcja 7:
// model danych) i Grafik-SOR-prototyp.html (blokada()/ostrzezeniaLista() -
// prototyp pokrywał tylko W1, W3, W12 twardo i W3/W5/W8/W10 miękko; ten moduł
// dokłada W2, W4, W6, W7, W9, W11, których prototyp świadomie nie pokazywał).
// W13/W14 dopisane 2026-08-13 na podstawie realnych wymogów oddziału od Piotra
// (starszy asystent pielęgniarstwa na dyżurze / minimalna liczba pielęgniarek
// w obsadzie) - patrz komentarze przy tych regułach niżej.
// W15 dopisane 2026-08-18: zakres godzin (min/max łącznie) dla osób na zlecenie/
// kontrakt, wg indywidualnie wynegocjowanej umowy z importu kadry (kolumny "min
// łącznie"/"max łącznie") - sprawdzane w cyklu MIESIĘCZNYM (nie 2-miesięcznym jak
// W5 dla etatu, zlecenie/kontrakt mają okres rozliczeniowy 1-miesięczny, potwierdzone
// przez Piotra 2026-08-18) - patrz komentarz przy regule niżej.
//
// Model danych wejściowych:
//   pracownik: { id, forma: 'etat'|'kontrakt'|'zlecenie', etat?: number (0-1,
//                domyślnie 1 - w appce NIE MA dziś pola ułamka etatu, patrz
//                OTWARTE-PYTANIA.md), flagi?: string[] (np. 'bez_nocek',
//                'starszy_asystent' - patrz W13 niżej; KONKRETNE osoby z tą flagą
//                to dane appki/oddziału, NIGDY nie na sztywno w tym pliku),
//                optOutZgoda?: boolean, pulaUrlopuDni?: number, grupa: 'main'|'opie',
//                stanowisko?: 'pielegniarka'|'ratownik' (grupa='main', do reguły W14)
//                          |  'opiekun_medyczny'|'opiekun_pacjenta' (grupa='opie',
//                             podgrupa do ewentualnego różnicowania układania grafiku
//                             w przyszłości - dziś appka tylko przechowuje wartość),
//                zlecenieMinGodzin?: number, zlecenieMaxGodzin?: number (forma=
//                          'zlecenie'|'kontrakt', do reguły W15 - suma godzin W
//                          POJEDYNCZYM MIESIĄCU, okres rozliczeniowy zlecenia/
//                          kontraktu jest 1-miesięczny, w odróżnieniu od etatu) }
//   wpis:      { pracownikId, data: 'YYYY-MM-DD', slot: 1|2, kod, kodRealizacji?,
//                zamianaZId?, notatka? } - kod to PLAN; kodRealizacji (opcjonalny)
//                to co FAKTYCZNIE się odbyło, jeśli inne niż plan (np. po zamianie
//                dyżurów) - patrz grfKodEfektywny() niżej. zamianaZId to id
//                pracownika, z którym nastąpiła zamiana (czysta adnotacja/komentarz,
//                nie wpływa na reguły) - wzorem realnego arkusza "płachta_2026.xlsx",
//                gdzie każda osoba ma dwa wiersze (plan + realizacja) i adnotację typu
//                "D-Żyłowska" przy zmienionej komórce. Potwierdzone z Piotrem
//                2026-08-30: godziny i reguły (W1-W15) liczą się WEDŁUG REALIZACJI,
//                nie planu, jeśli realizacja jest ustawiona.
//   parametry: patrz DOMYSLNE_PARAMETRY niżej - wartości domyślne z prototypu,
//              PARAMETR KONFIGUROWALNY oddziału (patrz OTWARTE-PYTANIA.md #1-3).
//
// UWAGA PRAWNA: reguły W3-W9 wg stanu prawnego na 2026-08-08 (Ustawa o działalności
// leczniczej art. 93-99, KP art. 167(2), art. 178). Każdą regułę potwierdzić z
// kadrami przed wdrożeniem produkcyjnym.

// ---------- słownik kodów ----------
// UWAGA: to NIE jest to samo co WN_GODZINY_KOD w domain/wnioski.js (tamten liczy
// godziny do faktury zlecenie/kontrakt, gdzie UW liczy się inaczej per forma - patrz
// wnPoliczGodziny). Tu GODZ_KOD liczy godziny "zaplanowane" do normy czasu pracy (W5).
//
// UW i CH liczą się WG INDYWIDUALNEJ STAWKI OSOBY (normaDobowaH x etat), nie sztywną
// wartością - potwierdzone na realnym arkuszu kadrowym (formuła AZ w arkuszu "maj":
// (...+COUNTIF(...,"op")+COUNTIF(...,"uw")+COUNTIF(...,"ch")+COUNTIF(...,"zr"))*$D6,
// gdzie $D6 to "godzinowy wymiar etatu" tej konkretnej osoby). Patrz godzinyKodu()
// niżej i ANALIZA-arkuszy-Excel-realnych.md, sekcja 6 - to poprawka względem
// wcześniejszej wersji tego pliku, która liczyła CH jako 0h (błąd).
// S (szkolenie) = 0h - POTWIERDZONE przez Piotra 2026-08-13: godziny szkolenia są
// ZAWSZE wpisywane ręcznie przez układającego (różne szkolenia mają różny czas
// trwania, appka tego nie zgadnie z samego kodu) - zgodne też z realną formułą
// arkusza kadrowego, która w ogóle NIE wlicza S do grupy "godziny zaplanowane/
// wypracowane" (patrz ANALIZA-arkuszy-Excel-realnych.md, sekcja 6). Silnik
// świadomie NIE dolicza S do wymiaru (W5) - to poprawka względem wcześniejszej
// wersji tego pliku, która liczyła S jako sztywne 7,583h dla każdego.
const GRF_GODZ_KOD = {
  D: 12, N: 12, DOBA: 24, S: 0,
  W: 0, Nz: 0, '': 0,
  // Wn/Ws - odbiór dnia wolnego za pracę w niedzielę/święto (Wn) lub w sobotę (Ws) -
  // dopisane 2026-08-30 wg legendy z arkuszy "maj-czerwiec ... 2026.xlsx" (zakładka
  // "dane") - jak W (0h, nie blokuje, wolno nadpisać) - patrz W17 niżej, która
  // PILNUJE czy taki dzień w ogóle się pojawił, a nie ile ma godzin.
  Wn: 0, Ws: 0,
  // Nn - nieobecność NIEusprawiedliwiona - też 0h, ale W ODRÓŻNIENIU od pozostałych
  // nieobecności (patrz GRF_KODY_WG_STAWKI_OSOBY niżej) NIE zmniejsza wymiaru do
  // przepracowania (nie jest usprawiedliwiona - art. 130 §3 KP jej nie dotyczy) -
  // dlatego generuje osobne, twarde do zauważenia ostrzeżenie w ostrzezeniaMiesiaca().
  Nn: 0,
};
// Kody liczone wg indywidualnej stawki dziennej osoby (normaDobowaH x etat), nie
// wartością stałą z GRF_GODZ_KOD - patrz godzinyKodu(kod, etat). To WSZYSTKIE
// „usprawiedliwione nieobecności" w rozumieniu wytyczne_grafik_oddzialowa.docx pkt 6
// (art. 130 §3 KP: wymiar obniża się o godziny zaplanowane na dzień nieobecności,
// niezależnie czy nieobecność jest płatna czy nie) - stąd w tej grupie są też kody
// bezpłatne (Ub) i mniej typowe (SW, Op, Zr) - płatność to sprawa działu kadr/płac,
// nie sposobu liczenia wymiaru w tej appce.
// DCH/NCH (dyżur D/N przerwany chorobowym) dopisane 2026-08-12 po analizie realnego
// arkusza "płachta_2026.xlsx" - Piotr potwierdził: liczą się jak CH, wg stawki osoby,
// nie 0h jak wcześniej (ten sam błąd, który poprawiliśmy dla CH - patrz sekcja 6/7
// ANALIZA-arkuszy-Excel-realnych.md). ~240 realnych wystąpień DCH/NCH (wszystkie
// warianty pisowni) w tym arkuszu - częściej niż sama CH.
// SW/Op/Us/Uo/Ub/Um/Nun/Nup/Zr dopisane 2026-08-30 na podstawie wytyczne_grafik_
// oddzialowa.docx (pkt 6) i legendy z arkuszy "maj-czerwiec ... 2026.xlsx":
//   SW - siła wyższa (art. 148[1] KP, limit roczny 2 dni/16h - patrz W16)
//   Op - opieka nad dzieckiem do lat 14 (art. 188 KP, limit roczny 2 dni/16h - W16,
//        pula ODDZIELNA od SW - "dwa odrębne, niesumujące się uprawnienia")
//   Us - urlop szkoleniowy (płatny, bez sztywnego rocznego limitu w appce)
//   Uo - urlop okolicznościowy (ślub/zgon itd. - limit zależy od zdarzenia, appka
//        go nie automatyzuje, tylko przyjmuje wpis)
//   Ub - urlop bezpłatny
//   Um - urlop macierzyński/rodzicielski
//   Nun - nieobecność usprawiedliwiona niepłatna (ogólna, gdy żaden bardziej
//        konkretny kod nie pasuje)
//   Nup - nieobecność usprawiedliwiona płatna (jw.)
//   Zr - zasiłek rehabilitacyjny
const GRF_KODY_WG_STAWKI_OSOBY = [
  'UW', 'CH', 'DCH', 'NCH',
  'SW', 'Op', 'Us', 'Uo', 'Ub', 'Um', 'Nun', 'Nup', 'Zr',
];

// kody traktowane jako "zmiana robocza" na potrzeby W2/W3/W7/W10
const GRF_KODY_ZMIANY = ['D', 'N', 'DOBA'];
// kody traktowane jako "zatwierdzona nieobecność" na potrzeby W1 (blokują wpisanie
// zmiany roboczej tego samego dnia, dopóki nieobecność nie zostanie zdjęta) - Nn
// (nieusprawiedliwiona) też tu wchodzi, mimo że nie liczy się do wymiaru (patrz
// GRF_GODZ_KOD) - to nadal "coś już tu jest zapisane" z punktu widzenia W1.
const GRF_KODY_NIEOBECNOSC = [
  'UW', 'CH', 'DCH', 'NCH', 'Nz',
  'SW', 'Op', 'Us', 'Uo', 'Ub', 'Um', 'Nn', 'Nun', 'Nup', 'Zr',
];

function grfJestZmiana(kod) { return GRF_KODY_ZMIANY.indexOf(kod) !== -1; }
function grfJestNieobecnoscia(kod) { return GRF_KODY_NIEOBECNOSC.indexOf(kod) !== -1; }

/**
 * grfKodEfektywny(w) -> kod faktycznie liczony do godzin/obsady/reguł: kodRealizacji,
 * jeśli ustawiony (nie null/undefined/pusty string), inaczej kod (plan). Patrz
 * komentarz w modelu danych (nagłówek pliku) - realizacja jest źródłem prawdy dla
 * wszystkiego, co appka LICZY, plan zostaje tylko jako to co było pierwotnie
 * zaplanowane (do wyświetlenia/wydruku obok realizacji).
 */
function grfKodEfektywny(w) {
  return (w.kodRealizacji != null && w.kodRealizacji !== '') ? w.kodRealizacji : w.kod;
}

/**
 * godzinyKodu(kod, etat) - godziny "zaplanowane/wypracowane" dla danego kodu.
 * `etat` to ułamek 0-1 (domyślnie 1, pełny etat) - używany tylko dla UW/CH, które
 * liczą się wg indywidualnej stawki dziennej osoby (normaDobowaH x etat), zgodnie
 * z realną formułą kadrową (patrz komentarz przy GRF_GODZ_KOD wyżej). Dla
 * pozostałych kodów `etat` jest ignorowany.
 */
function godzinyKodu(kod, etat) {
  if (GRF_KODY_WG_STAWKI_OSOBY.indexOf(kod) !== -1) {
    return DOMYSLNE_PARAMETRY.normaDobowaH * (etat == null ? 1 : etat);
  }
  return GRF_GODZ_KOD[kod] || 0;
}

// ---------- kalendarz świąt (do W8/W17/jestWeekendemLubSwietem) ----------

/**
 * grfNiedzielaWielkanocna(rok) -> 'YYYY-MM-DD'
 * Algorytm anonimowy gregoriański (Meeus/Jones/Butcher) - data Niedzieli
 * Wielkanocnej dla danego roku. Boże Ciało i Poniedziałek Wielkanocny liczone
 * względem tej daty (patrz grfSwietaRoku niżej).
 */
function grfNiedzielaWielkanocna(rok) {
  var a = rok % 19;
  var b = Math.floor(rok / 100);
  var c = rok % 100;
  var d = Math.floor(b / 4);
  var e = b % 4;
  var f = Math.floor((b + 8) / 25);
  var g = Math.floor((b - f + 1) / 3);
  var h = (19 * a + b - d - g + 15) % 30;
  var i = Math.floor(c / 4);
  var k = c % 4;
  var l = (32 + 2 * e + 2 * i - h - k) % 7;
  var m = Math.floor((a + 11 * h + 22 * l) / 451);
  var miesiac = Math.floor((h + l - 7 * m + 114) / 31);
  var dzien = ((h + l - 7 * m + 114) % 31) + 1;
  return rok + '-' + String(miesiac).padStart(2, '0') + '-' + String(dzien).padStart(2, '0');
}

/**
 * grfSwietaRoku(rok) -> string[] ('YYYY-MM-DD') - ustawowe święta PL dla danego roku
 * (10 stałych dat + 3 ruchome liczone od Wielkanocy) PLUS 24 grudnia jako dodatkowy
 * dzień wolny oddziału (NIE jest ustawowym świętem w Polsce, ale występuje w
 * kalendarzu świąt z arkuszy "maj-czerwiec ... 2026.xlsx" - Piotr potwierdził
 * 2026-08-30, że ma być traktowany jak święto również w appce).
 */
function grfSwietaRoku(rok) {
  var wielkanoc = grfNiedzielaWielkanocna(rok);
  return [
    rok + '-01-01', // Nowy Rok
    rok + '-01-06', // Trzech Króli
    wielkanoc, // Niedziela Wielkanocna
    dodajDni(wielkanoc, 1), // Poniedziałek Wielkanocny
    rok + '-05-01', // Święto Pracy
    rok + '-05-03', // Konstytucji 3 Maja
    dodajDni(wielkanoc, 60), // Boże Ciało
    rok + '-08-15', // Wniebowzięcie NMP
    rok + '-11-01', // Wszystkich Świętych
    rok + '-11-11', // Niepodległości
    rok + '-12-24', // dzień wolny oddziału (nieustawowy - patrz komentarz wyżej)
    rok + '-12-25', // Boże Narodzenie I dzień
    rok + '-12-26', // Boże Narodzenie II dzień
  ];
}

/** grfSwietaLat(rokOd, rokDo) -> string[] - święta ze wszystkich lat w zakresie (włącznie). */
function grfSwietaLat(rokOd, rokDo) {
  var wynik = [];
  for (var r = rokOd; r <= rokDo; r++) wynik = wynik.concat(grfSwietaRoku(r));
  return wynik;
}

// ---------- parametry domyślne (konfigurowalne per oddział - sekcja 6 spec.) ----------
const DOMYSLNE_PARAMETRY = {
  // Minima obsad - POTWIERDZONE przez Piotra 2026-08-13 (poprzednie wartości D:4/N:3
  // main, D:1/N:1 opie były placeholderami z prototypu, NIGDY nie potwierdzonymi z
  // oddziałem - patrz historia OTWARTE-PYTANIA.md #3). Jednakowe na D i N oraz w dzień
  // powszedni i weekend/święto (Piotr nie rozróżnił tych przypadków - gdyby okazało się,
  // że jednak trzeba różnicować, to tu jest właściwe miejsce do zmiany).
  //   main (pielęgniarki + ratownicy razem): min. 16 osób na dyżurze (reguła W8).
  //   opie: min. 4 osoby na dyżurze (reguła W8).
  obsady: {
    main: { dzienPow: { D: 16, N: 16 }, weekendSwieto: { D: 16, N: 16 } },
    opie: { dzienPow: { D: 4, N: 4 }, weekendSwieto: { D: 4, N: 4 } },
  },
  // W ramach obsady main (16 osób) minimum tylu musi być KONKRETNIE pielęgniarkami
  // (nie ratownikami) - patrz pracownik.stanowisko i reguła W14 niżej. Potwierdzone
  // przez Piotra 2026-08-13.
  minimalnaLiczbaPielegniarekNaDyzurze: 3,
  // Okres rozliczeniowy = 2 miesiące, w PARACH: (1,2)(3,4)(5,6)(7,8)(9,10)(11,12) -
  // potwierdzone przez Piotra dla maj-czerwiec (etykieta "I miesiąc rozliczeniowy
  // maj" w realnym arkuszu kadrowym znaczy "1. miesiąc W RAMACH okresu", nie że
  // okres to 1 miesiąc - patrz ANALIZA-arkuszy-Excel-realnych.md, sekcja 4).
  // Reszta par (styczeń-luty itd.) przez analogię, jeszcze nie potwierdzona wprost.
  okresRozliczeniowyMiesiecy: 2,
  normaDobowaH: 7 + 35 / 60, // 7 h 35 min, art. 93 UoDL
  normaTygodniowaH: 37 + 55 / 60, // 37 h 55 min, art. 93 UoDL
  limit48hTygodniowo: 48, // art. 96 UoDL
  limitNockiZRzedu: 3, // W10 - dobra praktyka, parametr oddziału
  limitZmianZRzedu: 5, // W10 - dobra praktyka, parametr oddziału
  limitNzDniRok: 4, // W9 - art. 167(2) KP, ustawowy, nie zmieniać
  stosujeDobe: true, // OTWARTE-PYTANIA.md #2 - do potwierdzenia
  toleranckaWymiaruH: 12, // tolerancja W5 wg prototypu
  // Kalendarz świąt 2025-2032 (ustawowe + 24 grudnia oddziału) - patrz grfSwietaLat/
  // grfSwietaRoku wyżej. Wygenerowane automatycznie, ale appka pozwala nadpisać
  // przez zmianę parametru (np. gdyby zakres lat trzeba było rozszerzyć).
  swieta: grfSwietaLat(2025, 2032),
  // Reguły ręcznie wyłączone przez administratora (panel Ustawienia -> Reguły) -
  // lista id-ków z GRF_KATALOG_REGUL niżej, np. ['W4','W13']. Domyślnie puste -
  // wszystkie reguły aktywne. Persystencja: api/reguly.js (ustawienia-reguly.json),
  // wczytywana i doklejana do parametrów w każdym wywołaniu blokada()/
  // ostrzezeniaMiesiaca() w api/grafik.js - patrz grfRegulaAktywna() niżej.
  wylaczoneReguly: [],
};

// ---------- katalog reguł (do panelu Ustawienia -> Reguły) ----------
// Jedno źródło prawdy dla nazw/opisów reguł W1-W17 - serwer eksponuje ten katalog
// przez GET /api/reguly, admin.js buduje z niego listę przełączników. `waga` to
// TYPOWA dotkliwość reguły w UI - niektóre reguły (W3, W6) bywają hard/soft
// zależnie od formy zatrudnienia / zgody opt-out, faktyczna dotkliwość per
// przypadek i tak jest ustalana w blokada()/ostrzezeniaMiesiaca() niżej.
const GRF_KATALOG_REGUL = [
  { id: 'W1', waga: 'hard', opis: 'Zmiana niemożliwa w dniu zatwierdzonej nieobecności (i uwaga o Nn - nieobecności nieusprawiedliwionej).' },
  { id: 'W2', waga: 'hard', opis: 'Maksymalnie jedna zmiana dziennie (D+N tego samego dnia tylko jako DOBA).' },
  { id: 'W3', waga: 'hard/soft', opis: 'Odpoczynek dobowy min. 11 h (po nocce, po dobie) - hard dla etatu, soft dla pozostałych form.' },
  { id: 'W4', waga: 'soft', opis: 'Odpoczynek tygodniowy min. 35 h nieprzerwanie (etat).' },
  { id: 'W5', waga: 'soft', opis: 'Norma czasu pracy 2-miesięcznego okresu rozliczeniowego (etat).' },
  { id: 'W6', waga: 'hard/soft', opis: 'Limit 48 h/tydzień - hard bez zgody opt-out, soft ze zgodą.' },
  { id: 'W7', waga: 'hard', opis: 'Zasady dyżurów DOBA (odpoczynek po dobie, tylko kontrakt/zlecenie, tylko jeśli oddział je stosuje).' },
  { id: 'W8', waga: 'hard', opis: 'Minimalna obsada dzienna (main/opie, D/N).' },
  { id: 'W9', waga: 'soft', opis: 'Roczny limit urlopu na żądanie (Nz) - etat.' },
  { id: 'W10', waga: 'soft', opis: 'Limit nocek z rzędu i zmian z rzędu bez dnia wolnego.' },
  { id: 'W11', waga: 'soft', opis: 'Pula urlopu wypoczynkowego (jeśli ustawiona dla pracownika).' },
  { id: 'W12', waga: 'hard', opis: 'Przeciwwskazania indywidualne (flaga „bez nocek").' },
  { id: 'W13', waga: 'soft', opis: 'Minimum 1 starszy asystent pielęgniarstwa na dyżurze D/N.' },
  { id: 'W14', waga: 'hard', opis: 'Minimalna liczba pielęgniarek (nie ratowników) w obsadzie main.' },
  { id: 'W15', waga: 'soft', opis: 'Zakres godzin min/max miesięcznie dla zlecenia/kontraktu.' },
  { id: 'W16', waga: 'soft', opis: 'Roczne limity siły wyższej (SW) i opieki nad dzieckiem (Op).' },
  { id: 'W17', waga: 'soft', opis: 'Pilnowanie odbioru dnia wolnego za pracę w niedzielę/święto/sobotę (Wn/Ws).' },
];

/** Czy dana reguła jest aktywna (brak jej na liście parametry.wylaczoneReguly). */
function grfRegulaAktywna(parametry, id) {
  return !(parametry && parametry.wylaczoneReguly && parametry.wylaczoneReguly.indexOf(id) !== -1);
}

// ---------- pomocnicze: kalendarz ----------
function grfDataDoObiektu(data) {
  var czesci = data.split('-').map(Number);
  return new Date(Date.UTC(czesci[0], czesci[1] - 1, czesci[2]));
}

function jestSwietem(data, swieta) {
  return swieta.indexOf(data) !== -1;
}

function jestWeekendemLubSwietem(data, swieta) {
  var dow = grfDataDoObiektu(data).getUTCDay(); // 0=niedziela, 6=sobota
  return dow === 0 || dow === 6 || jestSwietem(data, swieta);
}

function dodajDni(data, n) {
  var d = grfDataDoObiektu(data);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * grfMiesiacStartuOkresu(miesiac) -> 1-12
 * Okres rozliczeniowy = pary miesięcy (1,2)(3,4)(5,6)(7,8)(9,10)(11,12) - patrz
 * komentarz przy DOMYSLNE_PARAMETRY.okresRozliczeniowyMiesiecy.
 */
function grfMiesiacStartuOkresu(miesiac) {
  return miesiac % 2 === 0 ? miesiac - 1 : miesiac;
}

/** Pierwszy dzień 2-miesięcznego okresu rozliczeniowego, do którego należy `data`. */
function grfPoczatekOkresuRozliczeniowego(data) {
  var rok = Number(data.slice(0, 4));
  var miesiac = Number(data.slice(5, 7));
  var startMiesiac = grfMiesiacStartuOkresu(miesiac);
  return rok + '-' + String(startMiesiac).padStart(2, '0') + '-01';
}

/**
 * grfTydzienRozliczeniowy(data) -> klucz 'YYYY-MM-DD' (data początku danego
 * 7-dniowego bloku), do grupowania W4/W6.
 *
 * WAŻNE: to NIE jest tydzień kalendarzowy (pon-nd/ISO) - Piotr sprecyzował, że
 * "tydzień rozliczeniowy" zaczyna się w dniu tygodnia, w który wypada PIERWSZY
 * DZIEŃ okresu rozliczeniowego (np. maj 2026 zaczyna się w piątek -> kolejne
 * bloki liczone piątek-czwartek, potwierdzone: 7 dni), nie w poniedziałek.
 * Limit 48h/tydz. (W6, art. 96 UoDL) trzeba sprawdzać w TYCH blokach.
 */
function grfTydzienRozliczeniowy(data) {
  var poczatekOkresu = grfPoczatekOkresuRozliczeniowego(data);
  var poczatekMs = grfDataDoObiektu(poczatekOkresu).getTime();
  var dataMs = grfDataDoObiektu(data).getTime();
  var dni = Math.floor((dataMs - poczatekMs) / 86400000);
  var indeksTygodnia = Math.floor(dni / 7);
  var poczatekTygodniaMs = poczatekMs + indeksTygodnia * 7 * 86400000;
  return new Date(poczatekTygodniaMs).toISOString().slice(0, 10);
}

function grfWymiarEtatu(pracownik) {
  return (pracownik.etat == null) ? 1 : pracownik.etat;
}

// ---------- pomocnicze: dostęp do wpisów ----------

/** Buduje indeks {pracownikId: {data: [kod, ...]}} z listy wpisów dla szybkiego odczytu. */
function zbudujIndeks(wpisy) {
  var idx = {};
  for (var i = 0; i < wpisy.length; i++) {
    var w = wpisy[i];
    if (!idx[w.pracownikId]) idx[w.pracownikId] = {};
    if (!idx[w.pracownikId][w.data]) idx[w.pracownikId][w.data] = [];
    idx[w.pracownikId][w.data].push(grfKodEfektywny(w));
  }
  return idx;
}

/** Kody zmiany danej osoby w danym dniu (może być >1 przy dwóch slotach). */
function grfKodyDnia(indeks, pracownikId, data) {
  return (indeks[pracownikId] && indeks[pracownikId][data]) || [];
}

/** Pierwszy "znaczący" kod dnia (do reguł, które operują na jednej wartości: W1/W3/W7/W12). */
function grfGlownyKod(indeks, pracownikId, data) {
  var kody = grfKodyDnia(indeks, pracownikId, data);
  for (var i = 0; i < kody.length; i++) {
    if (kody[i] && kody[i] !== 'W') return kody[i];
  }
  return kody[0] || '';
}

// ---------- W1, W2, W3, W6, W7, W12: reguły TWARDE sprawdzane przed zapisem komórki ----------

/**
 * blokada(pracownik, data, kod, wpisy, parametry) -> string | null
 *
 * Sprawdza, czy wpisanie `kod` dla `pracownik` w dniu `data` jest DOPUSZCZALNE.
 * Zwraca powód (PL, do pokazania w UI) albo null jeśli można zapisać.
 * `wpisy` to pełna lista wpisów grafiku (żeby sprawdzić dzień sąsiedni) - może to
 * być kopia robocza (używane przy nanoszeniu wniosków/zamian, patrz domain/polautomat.js).
 */
function blokada(pracownik, data, kod, wpisy, parametry) {
  parametry = parametry || DOMYSLNE_PARAMETRY;
  if (kod === '' || kod === 'W') return null;

  var indeks = zbudujIndeks(wpisy);
  var dzisiaj = grfGlownyKod(indeks, pracownik.id, data);
  var wczoraj = grfGlownyKod(indeks, pracownik.id, dodajDni(data, -1));
  var jutro = grfGlownyKod(indeks, pracownik.id, dodajDni(data, 1));

  // W1 - zmiana niemożliwa w dniu zatwierdzonej nieobecności
  if (grfRegulaAktywna(parametry, 'W1') && grfJestNieobecnoscia(dzisiaj) && !grfJestNieobecnoscia(kod)) {
    return 'W1 - w tym dniu jest zatwierdzona nieobecność (' + dzisiaj + '). Najpierw ją zdejmij.';
  }

  // W2 - max jedna zmiana dziennie (D+N tego samego dnia tylko jako DOBA)
  if (grfRegulaAktywna(parametry, 'W2') && grfJestZmiana(kod)) {
    var inneZmianyDzis = grfKodyDnia(indeks, pracownik.id, data).filter(grfJestZmiana);
    var wszystkieTakieSame = true;
    for (var i = 0; i < inneZmianyDzis.length; i++) {
      if (inneZmianyDzis[i] !== kod) { wszystkieTakieSame = false; break; }
    }
    if (inneZmianyDzis.length > 0 && !wszystkieTakieSame) {
      return 'W2 - max jedna zmiana dziennie; D+N tego samego dnia tylko jako DOBA.';
    }
  }

  // W3 - odpoczynek dobowy >= 11 h (praktycznie: po N nie D/DOBA tego samego dnia po niej;
  // przed N nie może już stać D następnego dnia). Twarda dla etatu, w innym wypadku
  // sygnalizowana jako miękka w ostrzezeniaMiesiaca().
  if (pracownik.forma === 'etat') {
    if (grfRegulaAktywna(parametry, 'W3') && (kod === 'D' || kod === 'DOBA') && wczoraj === 'N') {
      return 'W3 - po nocce (kończy się 07:00) odpoczynek 11 h; najwcześniej dniówka o 19:00 (art. 97 UoDL).';
    }
    if (grfRegulaAktywna(parametry, 'W3') && kod === 'N' && jutro === 'D') {
      return 'W3 - nazajutrz zaplanowana dniówka; odpoczynek 11 h nie zostanie zachowany (art. 97 UoDL).';
    }
    // W7 - po DOBIE (24 h) odpoczynek: bezpośrednio po niej nie D/DOBA (analogicznie do W3)
    if (grfRegulaAktywna(parametry, 'W7') && (kod === 'D' || kod === 'DOBA') && wczoraj === 'DOBA') {
      return 'W7 - po dyżurze DOBA wymagany odpoczynek co najmniej równy przepracowanym godzinom (art. 95/97 UoDL).';
    }
    if (grfRegulaAktywna(parametry, 'W7') && kod === 'DOBA' && jutro === 'DOBA') {
      return 'W7 - dwie doby z rzędu bez odpoczynku między nimi (art. 95/97 UoDL).';
    }
  }

  // W6 - praca ponad 48 h/tydz. w okresie rozliczeniowym bez odnotowanej zgody opt-out
  // jest TWARDA (bez zgody). Ze zgodą - sprawdzane jako miękkie w ostrzezeniaMiesiaca().
  if (grfRegulaAktywna(parametry, 'W6') && pracownik.forma === 'etat' && grfJestZmiana(kod) && !pracownik.optOutZgoda) {
    var tydz = grfTydzienRozliczeniowy(data);
    var godzinyTygodnia = grfSumaGodzinTygodnia(indeks, pracownik.id, tydz, data, kod, grfWymiarEtatu(pracownik));
    if (godzinyTygodnia > parametry.limit48hTygodniowo) {
      return 'W6 - przekroczone 48 h/tydz. bez odnotowanej zgody opt-out (art. 96 UoDL).';
    }
  }

  // W7 - DOBA dozwolona tylko jeśli oddział ją stosuje
  if (grfRegulaAktywna(parametry, 'W7') && kod === 'DOBA' && !parametry.stosujeDobe) {
    return 'W7 - oddział nie stosuje dyżurów DOBA (parametr oddziału).';
  }

  // W7 - DOBA (24h) tylko dla kontraktu/zlecenia - POTWIERDZONE przez Piotra
  // 2026-08-13: personel etatowy nie może brać dyżurów 24h, kontrakt/zlecenie może.
  if (grfRegulaAktywna(parametry, 'W7') && kod === 'DOBA' && pracownik.forma === 'etat') {
    return 'W7 - dyżury DOBA (24h) dostępne tylko dla kontraktu/zlecenia, nie dla etatu.';
  }

  // W12 - przeciwwskazania indywidualne (np. brak nocek, ciąża - zakaz pracy w nocy)
  if (grfRegulaAktywna(parametry, 'W12') && (kod === 'N' || kod === 'DOBA') && pracownik.flagi && pracownik.flagi.indexOf('bez_nocek') !== -1) {
    return 'W12 - pracownik ma flagę „bez nocek" (orzeczenie/ciąża, art. 178 KP).';
  }

  return null;
}

function grfSumaGodzinTygodnia(indeks, pracownikId, tydzien, dataNowa, kodNowy, etat) {
  var suma = godzinyKodu(kodNowy, etat);
  var dane = indeks[pracownikId] || {};
  for (var data in dane) {
    if (!Object.prototype.hasOwnProperty.call(dane, data)) continue;
    if (data === dataNowa) continue;
    if (grfTydzienRozliczeniowy(data) !== tydzien) continue;
    for (var i = 0; i < dane[data].length; i++) suma += godzinyKodu(dane[data][i], etat);
  }
  return suma;
}

// ---------- W8: obsada dzienna ----------

function minimalnaObsada(grupa, typZmiany, data, parametry) {
  parametry = parametry || DOMYSLNE_PARAMETRY;
  var tabela = parametry.obsady[grupa];
  if (!tabela) return 0;
  var okres = jestWeekendemLubSwietem(data, parametry.swieta) ? 'weekendSwieto' : 'dzienPow';
  return tabela[okres][typZmiany] || 0;
}

function obsadaDnia(wpisy, grupa, typZmiany, data, pracownicy) {
  var grupaId = {};
  pracownicy.filter(function (p) { return p.grupa === grupa; }).forEach(function (p) { grupaId[p.id] = true; });
  var licz = {};
  wpisy.filter(function (w) { return w.data === data && grupaId[w.pracownikId]; }).forEach(function (w) {
    var kodEfekt = grfKodEfektywny(w);
    if (kodEfekt === typZmiany || kodEfekt === 'DOBA') licz[w.pracownikId] = true;
  });
  return Object.keys(licz).length;
}

/**
 * obsadaPielegniarekDnia(wpisy, typZmiany, data, pracownicy) - jak obsadaDnia(), ale
 * liczy TYLKO osoby z grupa='main' i stanowisko='pielegniarka' (nie ratowników) -
 * do reguły W14 (minimalna liczba pielęgniarek W RAMACH obsady main, nie osobny limit).
 */
function obsadaPielegniarekDnia(wpisy, typZmiany, data, pracownicy) {
  var id = {};
  pracownicy
    .filter(function (p) { return p.grupa === 'main' && p.stanowisko === 'pielegniarka'; })
    .forEach(function (p) { id[p.id] = true; });
  var licz = {};
  wpisy.filter(function (w) { return w.data === data && id[w.pracownikId]; }).forEach(function (w) {
    var kodEfekt = grfKodEfektywny(w);
    if (kodEfekt === typZmiany || kodEfekt === 'DOBA') licz[w.pracownikId] = true;
  });
  return Object.keys(licz).length;
}

// ---------- liczniki godzin ----------

/**
 * godzinyPracownika(wpisy, pracownikId, etat) - suma godzin danej osoby wg wpisów.
 * `etat` (ułamek 0-1, domyślnie 1) wpływa tylko na kody liczone wg indywidualnej
 * stawki (UW/CH) - patrz godzinyKodu(). Podawaj `pracownik.etat`, jeśli znany.
 */
function godzinyPracownika(wpisy, pracownikId, etat) {
  return wpisy
    .filter(function (w) { return w.pracownikId === pracownikId; })
    .reduce(function (suma, w) { return suma + godzinyKodu(grfKodEfektywny(w), etat); }, 0);
}

/** Wymiar miesięczny: norma dobowa x dni robocze miesiąca (bez sobót/niedziel/świąt) x etat. */
function wymiarMiesieczny(pracownik, rok, miesiac, parametry) {
  parametry = parametry || DOMYSLNE_PARAMETRY;
  var dniWMiesiacu = new Date(Date.UTC(rok, miesiac, 0)).getUTCDate();
  var dniRobocze = 0;
  for (var d = 1; d <= dniWMiesiacu; d++) {
    var data = rok + '-' + String(miesiac).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    if (!jestWeekendemLubSwietem(data, parametry.swieta)) dniRobocze++;
  }
  return parametry.normaDobowaH * dniRobocze * grfWymiarEtatu(pracownik);
}

/**
 * wymiarOkresuRozliczeniowego(pracownik, rok, miesiac, parametry) - suma wymiaru OBU
 * miesięcy 2-miesięcznego okresu rozliczeniowego, do którego należy `miesiac` (nie
 * tylko wymiar samego `miesiac`). Okres = para miesięcy (1,2)(3,4)...(11,12), patrz
 * DOMYSLNE_PARAMETRY.okresRozliczeniowyMiesiecy i ANALIZA-arkuszy-Excel-realnych.md,
 * sekcja 4. `miesiac` może być pierwszym LUB drugim miesiącem pary - funkcja zawsze
 * liczy dla całej pary.
 */
function wymiarOkresuRozliczeniowego(pracownik, rok, miesiac, parametry) {
  parametry = parametry || DOMYSLNE_PARAMETRY;
  var start = grfMiesiacStartuOkresu(miesiac);
  return wymiarMiesieczny(pracownik, rok, start, parametry) + wymiarMiesieczny(pracownik, rok, start + 1, parametry);
}

/**
 * godzinyOkresuRozliczeniowego(wpisy, pracownikId, etat, rok, miesiac) - suma godzin
 * "zaplanowanych/wypracowanych" pracownika w CAŁYM 2-miesięcznym okresie rozliczeniowym
 * (oba miesiące pary, do której należy `miesiac`), nie tylko w `miesiac` samym. `wpisy`
 * musi obejmować oba miesiące pary (jeśli wywołujący przekaże wpisy tylko z jednego
 * miesiąca, wynik będzie zaniżony - filtrowanie po prefiksie daty i tak jest bezpieczne,
 * po prostu nie znajdzie nic dla brakującego miesiąca).
 */
function godzinyOkresuRozliczeniowego(wpisy, pracownikId, etat, rok, miesiac) {
  var start = grfMiesiacStartuOkresu(miesiac);
  var prefiks1 = rok + '-' + String(start).padStart(2, '0');
  var prefiks2 = rok + '-' + String(start + 1).padStart(2, '0');
  var wpisyOsoby = wpisy.filter(function (w) {
    return w.pracownikId === pracownikId && (w.data.indexOf(prefiks1) === 0 || w.data.indexOf(prefiks2) === 0);
  });
  return godzinyPracownika(wpisyOsoby, pracownikId, etat);
}

/**
 * grfDniIGodzinyKoduWRoku(roczne, pracownikId, kod, rok, etat) -> {dni, godziny}
 * Liczy WYSTĄPIENIA danego kodu (efektywnego - patrz grfKodEfektywny) dla osoby w
 * CAŁYM roku kalendarzowym `rok` - do limitów rocznych (W9/W16), które inaczej niż
 * W5/W15 nie są przywiązane do okresu rozliczeniowego etatu. `roczne` powinno
 * obejmować wpisy z wszystkich 12 miesięcy roku (patrz api/grafik.js: wpisyRoku()) -
 * jeśli appka wywołująca poda tylko część roku, wynik będzie zaniżony (tak samo jak
 * przy niepełnych wpisach w W5 - patrz komentarz przy godzinyOkresuRozliczeniowego).
 */
function grfDniIGodzinyKoduWRoku(roczne, pracownikId, kod, rok, etat) {
  var prefiks = String(rok) + '-';
  var wpisyKodu = roczne.filter(function (w) {
    return w.pracownikId === pracownikId && w.data.indexOf(prefiks) === 0 && grfKodEfektywny(w) === kod;
  });
  return { dni: wpisyKodu.length, godziny: godzinyPracownika(wpisyKodu, pracownikId, etat) };
}

/**
 * grfMaOdbiorWOknie(indeksRoczny, pracownikId, dataBazowa, kodOdbioru, oknoDni) -> boolean
 * Czy w oknie [dataBazowa - oknoDni, dataBazowa + oknoDni] (kalendarzowo, może
 * wykraczać poza granice miesiąca) występuje u danej osoby kod `kodOdbioru` (np. 'Wn'
 * albo 'Ws') - do W17 (pilnowanie odbioru za pracę w niedzielę/święto/sobotę).
 * `indeksRoczny` musi być zbudowany z wpisów obejmujących CAŁY rok (patrz
 * grfDniIGodzinyKoduWRoku wyżej) - inaczej okno przycięte do jednego miesiąca dałoby
 * fałszywe ostrzeżenia przy dniach blisko początku/końca miesiąca.
 */
function grfMaOdbiorWOknie(indeksRoczny, pracownikId, dataBazowa, kodOdbioru, oknoDni) {
  for (var i = -oknoDni; i <= oknoDni; i++) {
    var kodyDnia = grfKodyDnia(indeksRoczny, pracownikId, dodajDni(dataBazowa, i));
    if (kodyDnia.indexOf(kodOdbioru) !== -1) return true;
  }
  return false;
}

// ---------- odmiana liczebników (PL) - przeniesione z prototypu ----------

function odm(n, jeden, kilka, wiele) {
  if (n === 1) return n + ' ' + jeden;
  var ostatniaCyfra = n % 10;
  var ostatnieDwie = n % 100;
  if (ostatniaCyfra >= 2 && ostatniaCyfra <= 4 && !(ostatnieDwie >= 12 && ostatnieDwie <= 14)) {
    return n + ' ' + kilka;
  }
  return n + ' ' + wiele;
}

// ---------- pełny skan miesiąca: reguły MIĘKKIE + twarde już istniejące w danych ----------

/**
 * ostrzezeniaMiesiaca(wpisy, pracownicy, rok, miesiac, parametry) -> Array<Ostrzezenie>
 * Ostrzezenie: { sev: 'hard'|'soft', rule: 'W1'..'W14', pracownikId, data, komunikat }
 *
 * Skanuje CAŁY miesiąc (nie pojedynczą komórkę) - używane do panelu ostrzeżeń i
 * blokady publikacji.
 *
 * UWAGA W5: reguła normy czasu pracy liczy CAŁY 2-miesięczny okres rozliczeniowy, nie
 * tylko `miesiac` - `wpisy` powinny więc obejmować oba miesiące pary, do której należy
 * `miesiac` (np. dla miesiac=6 też maj), inaczej wynik W5 będzie zaniżony. Ostrzeżenie
 * W5 pojawia się tylko przy `miesiac` = drugi (zamykający) miesiąc pary.
 *
 * `wpisyRoczne` (opcjonalny) - wpisy z CAŁEGO roku kalendarzowego `rok` (wszystkie 12
 * miesięcy), do reguł liczonych rocznie, nie w okresie rozliczeniowym: W9 (urlop na
 * żądanie), W16 (siła wyższa / opieka nad dzieckiem) i W17 (odbiór za niedzielę/
 * święto/sobotę, okno ±6 dni może wykraczać poza miesiąc). Jeśli pominięty, appka
 * dla tych trzech reguł używa samego `wpisy` - DZIAŁA, ale może dać wynik zaniżony
 * (nie zobaczy nieobecności/odbiorów z miesięcy spoza `wpisy`) - patrz api/grafik.js
 * wpisyRoku().
 */
function ostrzezeniaMiesiaca(wpisy, pracownicy, rok, miesiac, parametry, wpisyRoczne) {
  parametry = parametry || DOMYSLNE_PARAMETRY;
  var out = [];
  var indeks = zbudujIndeks(wpisy);
  var roczne = wpisyRoczne || wpisy;
  var indeksRoczny = zbudujIndeks(roczne);
  var dniWMiesiacu = new Date(Date.UTC(rok, miesiac, 0)).getUTCDate();
  function dataOf(d) { return rok + '-' + String(miesiac).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }

  pracownicy.forEach(function (p) {
    var nockiZRzedu = 0;
    var zmianZRzedu = 0;

    for (var d = 1; d <= dniWMiesiacu; d++) {
      var data = dataOf(d);
      var kod = grfGlownyKod(indeks, p.id, data);
      var jutro = grfGlownyKod(indeks, p.id, dodajDni(data, 1));

      // W3 wykryte w istniejących danych (np. po imporcie z Excela) - hard dla etatu, soft dla reszty
      if (kod === 'N' && (jutro === 'D' || jutro === 'DOBA')) {
        out.push({
          sev: p.forma === 'etat' ? 'hard' : 'soft', rule: 'W3', pracownikId: p.id, data: dodajDni(data, 1),
          komunikat: 'Dniówka nazajutrz po nocce - odpoczynek dobowy poniżej 11 h.',
        });
      }

      // Nn - nieobecność NIEusprawiedliwiona: zawsze warta zasygnalizowania (do
      // wyjaśnienia z pracownikiem/kadrami) - nie ma osobnego numeru reguły W,
      // traktowana jako "uwaga" w ramach W1 (ta sama rodzina - obecność w grafiku
      // nieuzgodnionej nieobecności).
      if (kod === 'Nn') {
        out.push({
          sev: 'soft', rule: 'W1', pracownikId: p.id, data: data,
          komunikat: 'Nieobecność NIEusprawiedliwiona (Nn) - wymaga wyjaśnienia, nie obniża wymiaru do przepracowania.',
        });
      }

      // W17 - odbiór dnia wolnego za pracę w niedzielę/święto (Wn) w ciągu 6 dni
      // kalendarzowych przed/po (art. 15111/15112 KP, wytyczne_grafik_oddzialowa.docx
      // pkt 9), albo za pracę w sobotę (Ws) - to drugie to zwyczaj oddziału (nie ma
      // wprost w KP), ale Piotr poprosił o pilnowanie tak samo jak Wn. MIĘKKA.
      if (grfJestZmiana(kod)) {
        var dzienTyg = grfDataDoObiektu(data).getUTCDay();
        if (dzienTyg === 0 || jestSwietem(data, parametry.swieta)) {
          if (!grfMaOdbiorWOknie(indeksRoczny, p.id, data, 'Wn', 6)) {
            out.push({
              sev: 'soft', rule: 'W17', pracownikId: p.id, data: data,
              komunikat: 'Praca w ' + (dzienTyg === 0 ? 'niedzielę' : 'święto') + ' bez odnotowanego odbioru (Wn) w oknie ±6 dni.',
            });
          }
        } else if (dzienTyg === 6) {
          if (!grfMaOdbiorWOknie(indeksRoczny, p.id, data, 'Ws', 6)) {
            out.push({
              sev: 'soft', rule: 'W17', pracownikId: p.id, data: data,
              komunikat: 'Praca w sobotę bez odnotowanego odbioru (Ws) w oknie ±6 dni.',
            });
          }
        }
      }

      // W10 - limit nocek z rzędu i zmian z rzędu
      nockiZRzedu = kod === 'N' ? nockiZRzedu + 1 : 0;
      if (nockiZRzedu === parametry.limitNockiZRzedu + 1) {
        out.push({
          sev: 'soft', rule: 'W10', pracownikId: p.id, data: data,
          komunikat: (parametry.limitNockiZRzedu + 1) + '. nocka z rzędu, limit oddziału to ' + parametry.limitNockiZRzedu + '.',
        });
      }
      var jestPraca = kod && kod !== 'W' && !grfJestNieobecnoscia(kod);
      zmianZRzedu = jestPraca ? zmianZRzedu + 1 : 0;
      if (zmianZRzedu === parametry.limitZmianZRzedu + 1) {
        out.push({
          sev: 'soft', rule: 'W10', pracownikId: p.id, data: data,
          komunikat: (parametry.limitZmianZRzedu + 1) + ' zmian z rzędu bez dnia wolnego (limit ' + parametry.limitZmianZRzedu + ').',
        });
      }
    }

    if (p.forma === 'etat') {
      var tygodnie = {};
      for (var d2 = 1; d2 <= dniWMiesiacu; d2++) {
        var data2 = dataOf(d2);
        var tydz = grfTydzienRozliczeniowy(data2);
        (tygodnie[tydz] = tygodnie[tydz] || []).push(data2);
      }

      // W4 - odpoczynek tygodniowy >= 35 h nieprzerwanie (etat) - PRZYBLIŻENIE: każdy
      // tydzień kalendarza miesiąca musi zawierać dwa kolejne dni bez zmiany (przybliżenie
      // odpoczynku 35 h; dokładne liczenie godzina-po-godzinie wymaga czasów startu/końca
      // zmian - do doprecyzowania w implementacji, oznaczyć jako "sprawdzić ręcznie").
      Object.keys(tygodnie).forEach(function (tydz) {
        var dni = tygodnie[tydz];
        var maOdpoczynek = dni.some(function (data3) {
          var k = grfGlownyKod(indeks, p.id, data3);
          var j = grfGlownyKod(indeks, p.id, dodajDni(data3, 1));
          var wolnyDzis = !k || k === 'W';
          var wolnyJutro = !j || j === 'W';
          return wolnyDzis && wolnyJutro;
        });
        if (!maOdpoczynek && dni.length >= 5) {
          out.push({
            sev: 'soft', rule: 'W4', pracownikId: p.id, data: dni[0],
            komunikat: 'Brak wykrytego odpoczynku >=35 h nieprzerwanie w tygodniu ' + tydz + ' (art. 97 ust. 2 UoDL) - sprawdzić ręcznie.',
          });
        }
      });

      // W6 - przeciętnie <=48 h/tydz.; ze zgodą opt-out to ostrzeżenie miękkie (bez zgody:
      // hard - sygnalizowane już w blokada() przy zapisie; tu wychwytujemy dane wczytane
      // spoza edytora, np. z importu Excela)
      Object.keys(tygodnie).forEach(function (tydz) {
        var dni = tygodnie[tydz];
        var godz = dni.reduce(function (s, data4) {
          return s + grfKodyDnia(indeks, p.id, data4).reduce(function (a, k) { return a + godzinyKodu(k, grfWymiarEtatu(p)); }, 0);
        }, 0);
        if (godz > parametry.limit48hTygodniowo) {
          out.push({
            sev: p.optOutZgoda ? 'soft' : 'hard', rule: 'W6', pracownikId: p.id, data: dni[0],
            komunikat: 'Tydzień ' + tydz + ': ' + grfHm(godz) + ' - ponad 48 h ' + (p.optOutZgoda ? '(z odnotowaną zgodą opt-out).' : '(BRAK zgody opt-out, art. 96 UoDL).'),
          });
        }
      });
    }

    // W5 - norma CAŁEGO 2-miesięcznego okresu rozliczeniowego (+/- tolerancja), nie
    // pojedynczego miesiąca - potwierdzone przez Piotra (ANALIZA-arkuszy-Excel-realnych.md,
    // sekcja 4: kolumna "Limit do wypracowania z poprzedniego miesiąca" w realnym arkuszu
    // to właśnie przenoszenie salda WEWNĄTRZ okresu). Zgłaszane TYLKO przy przeglądzie
    // DRUGIEGO (zamykającego) miesiąca pary - w pierwszym miesiącu bilans może się jeszcze
    // wyrównać w drugim, więc ostrzeżenie o odchyleniu byłoby przedwczesne/mylące.
    // WAŻNE: `wpisy` przekazane do ostrzezeniaMiesiaca() muszą obejmować OBA miesiące
    // pary (nie tylko przeglądany `miesiac`), inaczej suma godzin będzie zaniżona.
    if (p.forma === 'etat') {
      var startOkresu = grfMiesiacStartuOkresu(miesiac);
      var koniecOkresu = startOkresu + 1;
      if (miesiac === koniecOkresu) {
        var hOkresu = godzinyOkresuRozliczeniowego(wpisy, p.id, grfWymiarEtatu(p), rok, miesiac);
        var wymOkresu = wymiarOkresuRozliczeniowego(p, rok, miesiac, parametry);
        var etykietaOkresu = String(startOkresu).padStart(2, '0') + '-' + String(koniecOkresu).padStart(2, '0') + '.' + rok;
        if (hOkresu > wymOkresu + parametry.toleranckaWymiaruH) {
          out.push({ sev: 'soft', rule: 'W5', pracownikId: p.id, data: dataOf(1), komunikat: 'Przekroczony wymiar okresu rozliczeniowego ' + etykietaOkresu + ': ' + grfHm(hOkresu) + ' wobec ' + grfHm(wymOkresu) + '.' });
        }
        if (hOkresu < wymOkresu - parametry.toleranckaWymiaruH) {
          out.push({ sev: 'soft', rule: 'W5', pracownikId: p.id, data: dataOf(1), komunikat: 'Niedobór do wymiaru okresu rozliczeniowego ' + etykietaOkresu + ': ' + grfHm(hOkresu) + ' wobec ' + grfHm(wymOkresu) + '.' });
        }
      }
    }

    // W15 - zakres godzin (min/max łącznie) dla osób NA ZLECENIE/KONTRAKT, wg
    // indywidualnie wynegocjowanej umowy (kolumny "min łącznie"/"max łącznie" z
    // importu kadry, patrz admin.js wgrajPracownikowZWierszy()). W ODRÓŻNIENIU od
    // W5 (etat, okres 2-miesięczny) - zlecenie i kontrakt mają okres rozliczeniowy
    // 1-MIESIĘCZNY (potwierdzone przez Piotra 2026-08-18), więc sprawdzane CO
    // MIESIĄC, na podstawie wpisów z samego przeglądanego `miesiac` (nie pary
    // miesięcy jak w W5). Miękkie (soft) - to umowa cywilnoprawna, nie przepis
    // prawa pracy jak W5/W6, więc nie blokuje publikacji domyślnie.
    if ((p.forma === 'zlecenie' || p.forma === 'kontrakt') && (typeof p.zlecenieMinGodzin === 'number' || typeof p.zlecenieMaxGodzin === 'number')) {
      var prefiksMiesiaca15 = rok + '-' + String(miesiac).padStart(2, '0');
      var wpisyMiesiaca15 = wpisy.filter(function (w) { return w.pracownikId === p.id && w.data.indexOf(prefiksMiesiaca15) === 0; });
      var hMiesiaca15 = godzinyPracownika(wpisyMiesiaca15, p.id, grfWymiarEtatu(p));
      var etykietaMiesiaca15 = String(miesiac).padStart(2, '0') + '.' + rok;
      if (typeof p.zlecenieMaxGodzin === 'number' && hMiesiaca15 > p.zlecenieMaxGodzin) {
        out.push({
          sev: 'soft', rule: 'W15', pracownikId: p.id, data: dataOf(1),
          komunikat: 'Przekroczony maksymalny zakres godzin miesiąca ' + etykietaMiesiaca15 + ': ' + grfHm(hMiesiaca15) + ' wobec max ' + grfHm(p.zlecenieMaxGodzin) + ' z umowy.',
        });
      }
      if (typeof p.zlecenieMinGodzin === 'number' && hMiesiaca15 < p.zlecenieMinGodzin) {
        out.push({
          sev: 'soft', rule: 'W15', pracownikId: p.id, data: dataOf(1),
          komunikat: 'Niedobór do minimalnego zakresu godzin miesiąca ' + etykietaMiesiaca15 + ': ' + grfHm(hMiesiaca15) + ' wobec min ' + grfHm(p.zlecenieMinGodzin) + ' z umowy.',
        });
      }
    }

    // W9 - urlop na żądanie, limit ROCZNY (nie miesięczny) - poprawione 2026-08-30,
    // wcześniej liczone tylko w obrębie przeglądanego miesiąca (zaniżało wynik) -
    // patrz grfDniIGodzinyKoduWRoku i komentarz `wpisyRoczne` w nagłówku funkcji.
    // Tylko etat (Nż to uprawnienie KP - patrz domain/urlopy.js).
    if (p.forma === 'etat') {
      var nzRoku = grfDniIGodzinyKoduWRoku(roczne, p.id, 'Nz', rok, grfWymiarEtatu(p)).dni;
      if (nzRoku > parametry.limitNzDniRok) {
        out.push({
          sev: 'soft', rule: 'W9', pracownikId: p.id, data: dataOf(1),
          komunikat: 'Wykorzystano ' + nzRoku + ' dni urlopu na żądanie w ' + rok + ' r., limit to ' + parametry.limitNzDniRok + ' (art. 167(2) KP).',
        });
      }
    }

    // W16 - roczne limity siły wyższej (SW) i opieki nad dzieckiem do lat 14 (Op) -
    // KAŻDE osobno 2 dni LUB 16 godzin w roku kalendarzowym, jednostkę wybiera
    // pracownik na cały rok (p.silaWyzszaJednostka / p.opiekaJednostka, domyślnie
    // 'dni') - "dwa odrębne, niesumujące się uprawnienia" (wytyczne_grafik_
    // oddzialowa.docx, pkt 6 i 15). MIĘKKA - appka sygnalizuje, kadry weryfikują.
    var limityRoczneW16 = [
      { kod: 'SW', pole: 'silaWyzszaJednostka', etykieta: 'siły wyższej (art. 148(1) KP)' },
      { kod: 'Op', pole: 'opiekaJednostka', etykieta: 'opieki nad dzieckiem do lat 14 (art. 188 KP)' },
    ];
    for (var liW16 = 0; liW16 < limityRoczneW16.length; liW16++) {
      var limW16 = limityRoczneW16[liW16];
      var wynikW16 = grfDniIGodzinyKoduWRoku(roczne, p.id, limW16.kod, rok, grfWymiarEtatu(p));
      var jednostkaW16 = p[limW16.pole] === 'godziny' ? 'godziny' : 'dni';
      if (jednostkaW16 === 'dni' && wynikW16.dni > 2) {
        out.push({
          sev: 'soft', rule: 'W16', pracownikId: p.id, data: dataOf(1),
          komunikat: 'Przekroczony roczny limit ' + limW16.etykieta + ': ' + wynikW16.dni + ' dni wobec limitu 2 dni/rok.',
        });
      }
      if (jednostkaW16 === 'godziny' && wynikW16.godziny > 16) {
        out.push({
          sev: 'soft', rule: 'W16', pracownikId: p.id, data: dataOf(1),
          komunikat: 'Przekroczony roczny limit ' + limW16.etykieta + ': ' + grfHm(wynikW16.godziny) + ' wobec limitu 16:00 godz./rok.',
        });
      }
    }

    // W11 - wymiar urlopu nie przekroczony (pula z modułu urlopy, jeśli podana - etat i
    // kontrakt mają różne pule, patrz domain/urlopy.js: kontrakt 26 dni/rok, etat wg KP)
    if (typeof p.pulaUrlopuDni === 'number') {
      var dniUW = 0;
      var poDacie = indeks[p.id] || {};
      Object.keys(poDacie).forEach(function (data5) {
        poDacie[data5].forEach(function (k) { if (k === 'UW') dniUW++; });
      });
      if (dniUW > p.pulaUrlopuDni) {
        out.push({
          sev: 'soft', rule: 'W11', pracownikId: p.id, data: dataOf(1),
          komunikat: 'Wykorzystano ' + dniUW + ' dni UW, pula wynosi ' + p.pulaUrlopuDni + '.',
        });
      }
    }
  });

  // W8 - obsada minimalna, per dzień x grupa x typ zmiany. TWARDA - POTWIERDZONE
  // przez Piotra 2026-08-13: to nie miękki cel tylko wymagane minimum bezpieczeństwa
  // (16 main / 4 opie na dyżurze) - wcześniej ta reguła była zawsze miękka (soft).
  var grupy = [];
  pracownicy.forEach(function (p) { if (grupy.indexOf(p.grupa) === -1) grupy.push(p.grupa); });
  for (var d3 = 1; d3 <= dniWMiesiacu; d3++) {
    var data6 = dataOf(d3);
    grupy.forEach(function (grupa) {
      ['D', 'N'].forEach(function (typ) {
        var ma = obsadaDnia(wpisy, grupa, typ, data6, pracownicy);
        var min = minimalnaObsada(grupa, typ, data6, parametry);
        if (ma < min) {
          out.push({
            sev: 'hard', rule: 'W8', pracownikId: null, data: data6,
            komunikat: 'Obsada ' + grupa + ' ' + typ + ': ' + ma + ' przy wymaganym minimum ' + min + ' - brakuje ' + (min - ma) + '.',
          });
        }

        // W14 - w ramach obsady main, minimalna liczba KONKRETNIE pielęgniarek (nie
        // ratowników) - TWARDA. Potwierdzone przez Piotra 2026-08-13.
        if (grupa === 'main') {
          var maPiel = obsadaPielegniarekDnia(wpisy, typ, data6, pracownicy);
          var minPiel = parametry.minimalnaLiczbaPielegniarekNaDyzurze || 0;
          if (maPiel < minPiel) {
            out.push({
              sev: 'hard', rule: 'W14', pracownikId: null, data: data6,
              komunikat: 'Pielęgniarki na dyżurze ' + typ + ': ' + maPiel + ' przy wymaganym minimum ' + minPiel + ' (w ramach obsady main, min. ' + min + ' osób).',
            });
          }
        }
      });
    });
  }

  // W13 - min. 1 starszy asystent pielęgniarstwa (flaga 'starszy_asystent') na każdym
  // dyżurze D i N, grupa main - MIĘKKA. Potwierdzone przez Piotra 2026-08-13. Konkretne
  // osoby z tą flagą to dane appki/oddziału (pracownik.flagi), nigdy nazwiska na sztywno
  // w tym pliku - patrz nagłówek pliku, sekcja "Model danych wejściowych".
  for (var d5 = 1; d5 <= dniWMiesiacu; d5++) {
    var data8 = dataOf(d5);
    ['D', 'N'].forEach(function (typ3) {
      var jestStarszyAsystent = pracownicy.some(function (p) {
        if (p.grupa !== 'main' || !p.flagi || p.flagi.indexOf('starszy_asystent') === -1) return false;
        var kodyDnia = grfKodyDnia(indeks, p.id, data8);
        return kodyDnia.indexOf(typ3) !== -1 || kodyDnia.indexOf('DOBA') !== -1;
      });
      if (!jestStarszyAsystent) {
        out.push({
          sev: 'soft', rule: 'W13', pracownikId: null, data: data8,
          komunikat: 'Brak starszego asystenta pielęgniarstwa na dyżurze ' + typ3 + ' (wymagane min. 1).',
        });
      }
    });
  }

  // Filtr reguł ręcznie wyłączonych w Ustawieniach (parametry.wylaczoneReguly) -
  // JEDNO miejsce dla wszystkich reguł tej funkcji (W1/Nn, W3-W6, W8-W11, W13-W17),
  // zamiast owijania każdego pojedynczego push() wyżej w warunek - patrz
  // grfRegulaAktywna().
  return out
    .filter(function (o) { return grfRegulaAktywna(parametry, o.rule); })
    .sort(function (a, b) { return (a.sev === b.sev ? 0 : a.sev === 'hard' ? -1 : 1); });
}

function grfHm(h) {
  var m = Math.round(h * 60);
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
}

// ---------- F2.4: podpowiedzi kandydatów na dziurę obsadową ----------

/**
 * kandydaciNaDziure(data, typZmiany, grupa, wpisy, pracownicy, rok, miesiac, parametry)
 * Zwraca pracowników bez wpisu tego dnia, którzy mogą wziąć zmianę bez naruszenia
 * reguł twardych, posortowanych rosnąco po wykorzystaniu wymiaru (nie po godzinach
 * bezwzględnych - etaty cząstkowe zawyżałyby ranking).
 */
function kandydaciNaDziure(data, typZmiany, grupa, wpisy, pracownicy, rok, miesiac, parametry) {
  parametry = parametry || DOMYSLNE_PARAMETRY;
  var indeks = zbudujIndeks(wpisy);
  return pracownicy
    .filter(function (p) { return p.grupa === grupa; })
    .filter(function (p) { return grfKodyDnia(indeks, p.id, data).length === 0; })
    .filter(function (p) { return blokada(p, data, typZmiany, wpisy, parametry) === null; })
    .map(function (p) {
      return { pracownik: p, wykorzystanieWymiaru: godzinyPracownika(wpisy, p.id, grfWymiarEtatu(p)) / (wymiarMiesieczny(p, rok, miesiac, parametry) || 1) };
    })
    .sort(function (a, b) { return a.wykorzystanieWymiaru - b.wykorzystanieWymiaru; })
    .map(function (x) { return x.pracownik; });
}

// ---------- generator: uzupełnianie brakującej obsady (przycisk "Generuj grafik") ----------

/**
 * generujBrakujaceDyzury(wpisy, pracownicy, rok, miesiac, parametry)
 *   -> { noweWpisy: Wpis[], braki: Array<{ data, grupa, typ, brakuje }> }
 *
 * NIE nadpisuje istniejących wpisów (urlopów, chorobowego, ręcznie wstawionych
 * dyżurów, wyników polautomatu) - tylko DOPISUJE zmiany D/N tam, gdzie danego
 * dnia/grupy/typu zmiany brakuje do minimalnej obsady (W8), z priorytetem:
 *  1) main: najpierw dobiera pielęgniarki, jeśli brakuje ich do minimum (W14),
 *  2) opie: jeśli JAKAKOLWIEK osoba w grupie ma wypełnione „typyDyzuru", generator
 *     przy wyborze preferuje kandydatów uprawnionych do danego typu dyżuru (dzień/
 *     noc) - jeśli nikt takich danych nie ma, traktuje to jak brak ograniczenia,
 *  3) reszta miejsc: kandydaci z kandydaciNaDziure() posortowani rosnąco wg
 *     dotychczasowego wykorzystania wymiaru miesięcznego (uczciwy rozkład).
 * Nie dobiera dyżurów DOBA (24h) - to reguła TWARDA blokada() i tak by je odrzuciła
 * dla etatu, a dla kontraktu/zlecenia decyzja "D+N razem jako DOBA" zostawiona
 * układającemu (nie ma jednoznacznej reguły, kiedy generator miałby ją preferować).
 * Przetwarza dni CHRONOLOGICZNIE i na bieżąco dopisuje nowe wpisy do roboczej kopii
 * `wpisy`, dzięki czemu reguły odpoczynku (W3/W7) i limit 48 h/tydz. (W6) - sprawdzane
 * przez blokada() wewnątrz kandydaciNaDziure() - uwzględniają też dyżury dodane
 * chwilę wcześniej w TYM SAMYM przebiegu generatora.
 * `braki` - dni/grupy/typy zmiany, których mimo to nie udało się w pełni obsadzić
 * (brak dostępnych osób bez naruszenia reguł twardych) - do pokazania w UI.
 */
function generujBrakujaceDyzury(wpisy, pracownicy, rok, miesiac, parametry) {
  parametry = parametry || DOMYSLNE_PARAMETRY;
  var dniWMiesiacu = new Date(Date.UTC(rok, miesiac, 0)).getUTCDate();
  var wpisyRobocze = wpisy.slice();
  var noweWpisy = [];
  var braki = [];

  var grupy = [];
  pracownicy.forEach(function (p) { if (grupy.indexOf(p.grupa) === -1) grupy.push(p.grupa); });

  for (var d = 1; d <= dniWMiesiacu; d++) {
    var data = rok + '-' + String(miesiac).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    grupy.forEach(function (grupa) {
      ['D', 'N'].forEach(function (typ) {
        var min = minimalnaObsada(grupa, typ, data, parametry);
        if (min <= 0) return;
        var brakuje = min - obsadaDnia(wpisyRobocze, grupa, typ, data, pracownicy);
        if (brakuje <= 0) return;

        var kandydaci = kandydaciNaDziure(data, typ, grupa, wpisyRobocze, pracownicy, rok, miesiac, parametry);
        var wybrani = [];

        if (grupa === 'main') {
          var minPiel = parametry.minimalnaLiczbaPielegniarekNaDyzurze || 0;
          var brakujePiel = Math.min(brakuje, Math.max(0, minPiel - obsadaPielegniarekDnia(wpisyRobocze, typ, data, pracownicy)));
          if (brakujePiel > 0) {
            wybrani = kandydaci.filter(function (p) { return p.stanowisko === 'pielegniarka'; }).slice(0, brakujePiel);
          }
        }

        var reszta = kandydaci.filter(function (p) { return wybrani.indexOf(p) === -1; });
        if (grupa === 'opie') {
          var kluczTypu = typ === 'D' ? 'dzien' : 'noc';
          var sqKtosMaDane = pracownicy.some(function (p) { return p.grupa === 'opie' && p.typyDyzuru && p.typyDyzuru.length > 0; });
          if (sqKtosMaDane) {
            reszta = reszta.slice().sort(function (a, b) {
              var aOk = (a.typyDyzuru && a.typyDyzuru.indexOf(kluczTypu) !== -1) ? 0 : 1;
              var bOk = (b.typyDyzuru && b.typyDyzuru.indexOf(kluczTypu) !== -1) ? 0 : 1;
              return aOk - bOk;
            });
          }
        }
        wybrani = wybrani.concat(reszta.slice(0, Math.max(0, brakuje - wybrani.length)));

        wybrani.forEach(function (p) {
          var nowyWpis = { pracownikId: p.id, data: data, slot: 1, kod: typ };
          wpisyRobocze.push(nowyWpis);
          noweWpisy.push(nowyWpis);
        });

        var brakujeNadal = min - obsadaDnia(wpisyRobocze, grupa, typ, data, pracownicy);
        if (brakujeNadal > 0) {
          braki.push({ data: data, grupa: grupa, typ: typ, brakuje: brakujeNadal });
        }
      });
    });
  }

  return { noweWpisy: noweWpisy, braki: braki };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GRF_GODZ_KOD: GRF_GODZ_KOD,
    DOMYSLNE_PARAMETRY: DOMYSLNE_PARAMETRY,
    GRF_KATALOG_REGUL: GRF_KATALOG_REGUL,
    grfRegulaAktywna: grfRegulaAktywna,
    godzinyKodu: godzinyKodu,
    grfKodEfektywny: grfKodEfektywny,
    jestSwietem: jestSwietem,
    jestWeekendemLubSwietem: jestWeekendemLubSwietem,
    dodajDni: dodajDni,
    zbudujIndeks: zbudujIndeks,
    blokada: blokada,
    minimalnaObsada: minimalnaObsada,
    obsadaDnia: obsadaDnia,
    obsadaPielegniarekDnia: obsadaPielegniarekDnia,
    godzinyPracownika: godzinyPracownika,
    wymiarMiesieczny: wymiarMiesieczny,
    wymiarOkresuRozliczeniowego: wymiarOkresuRozliczeniowego,
    godzinyOkresuRozliczeniowego: godzinyOkresuRozliczeniowego,
    grfDniIGodzinyKoduWRoku: grfDniIGodzinyKoduWRoku,
    grfMaOdbiorWOknie: grfMaOdbiorWOknie,
    odm: odm,
    ostrzezeniaMiesiaca: ostrzezeniaMiesiaca,
    kandydaciNaDziure: kandydaciNaDziure,
    generujBrakujaceDyzury: generujBrakujaceDyzury,
  };
}
