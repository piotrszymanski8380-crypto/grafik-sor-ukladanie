import { describe, it, expect } from 'vitest';
import {
  blokada,
  ostrzezeniaMiesiaca,
  minimalnaObsada,
  obsadaDnia,
  obsadaPielegniarekDnia,
  godzinyPracownika,
  wymiarMiesieczny,
  wymiarOkresuRozliczeniowego,
  godzinyOkresuRozliczeniowego,
  kandydaciNaDziure,
  generujBrakujaceDyzury,
  grfKodEfektywny,
  odm,
  DOMYSLNE_PARAMETRY,
  GRF_GODZ_KOD,
} from './grafik.js';

// Fixtures — używamy listopada 2026 (jak w prototypie) dla spójności.
const pEtat = { id: 'p1', forma: 'etat', etat: 1, grupa: 'main' };
const pEtatBezZgodyOptOut = { id: 'p1', forma: 'etat', etat: 1, grupa: 'main', optOutZgoda: false };
const pEtatZgodaOptOut = { id: 'p1', forma: 'etat', etat: 1, grupa: 'main', optOutZgoda: true };
const pKontrakt = { id: 'p2', forma: 'kontrakt', etat: 1, grupa: 'main' };
const pFlaga = { id: 'p3', forma: 'etat', etat: 1, grupa: 'main', flagi: ['bez_nocek'] };

const wpis = (pracownikId, data, kod, slot = 1) => ({ pracownikId, data, slot, kod });

describe('W1 — zmiana niemożliwa w dniu zatwierdzonej nieobecności (twarda)', () => {
  it('blokuje wpisanie D w dniu z UW', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'UW')];
    const powod = blokada(pEtat, '2026-11-05', 'D', wpisy);
    expect(powod).toMatch(/^W1/);
  });
  it('pozwala wpisać D w dniu bez żadnej nieobecności', () => {
    const wpisy = [wpis('p1', '2026-11-04', 'UW')]; // inny dzień
    const powod = blokada(pEtat, '2026-11-05', 'D', wpisy);
    expect(powod).toBeNull();
  });
});

describe('W2 — max jedna zmiana dziennie (D+N tylko jako DOBA)', () => {
  it('blokuje N w drugim slocie, gdy w pierwszym jest już D', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'D', 1)];
    const powod = blokada(pEtat, '2026-11-05', 'N', wpisy);
    expect(powod).toMatch(/^W2/);
  });
  it('nie blokuje wolnego dnia (kod W) mimo istniejącej zmiany', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'D', 1)];
    expect(blokada(pEtat, '2026-11-05', 'W', wpisy)).toBeNull();
  });
});

describe('W3 — odpoczynek dobowy 11 h po nocce (twarda dla etatu, miękka dla reszty)', () => {
  it('blokuje D dzień po N dla etatowca', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'N')];
    expect(blokada(pEtat, '2026-11-06', 'D', wpisy)).toMatch(/^W3/);
  });
  it('blokuje N, gdy nazajutrz jest już zaplanowane D', () => {
    const wpisy = [wpis('p1', '2026-11-06', 'D')];
    expect(blokada(pEtat, '2026-11-05', 'N', wpisy)).toMatch(/^W3/);
  });
  it('NIE blokuje D po N dla kontraktu (tylko reguły "wszyscy" są twarde)', () => {
    const wpisy = [wpis('p2', '2026-11-05', 'N')];
    expect(blokada(pKontrakt, '2026-11-06', 'D', wpisy)).toBeNull();
  });
  it('pozwala na D dzień po D (brak konfliktu odpoczynku)', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'D')];
    expect(blokada(pEtat, '2026-11-06', 'D', wpisy)).toBeNull();
  });
  it('ostrzezeniaMiesiaca wykrywa N→D w istniejących danych: hard dla etatu, soft dla kontraktu', () => {
    const wpisyEtat = [wpis('p1', '2026-11-05', 'N'), wpis('p1', '2026-11-06', 'D')];
    const outEtat = ostrzezeniaMiesiaca(wpisyEtat, [pEtat], 2026, 11);
    expect(outEtat.some(o => o.rule === 'W3' && o.sev === 'hard')).toBe(true);

    const wpisyKontrakt = [wpis('p2', '2026-11-05', 'N'), wpis('p2', '2026-11-06', 'D')];
    const outKontrakt = ostrzezeniaMiesiaca(wpisyKontrakt, [pKontrakt], 2026, 11);
    expect(outKontrakt.some(o => o.rule === 'W3' && o.sev === 'soft')).toBe(true);
  });
});

describe('W6 — przeciętnie ≤48 h/tydz.; twarda bez zgody opt-out', () => {
  // Nov 2–8 2026 to jeden tydzień ISO (Mon–Sun).
  const tydzien = [
    wpis('p1', '2026-11-02', 'D'), // 12h
    wpis('p1', '2026-11-03', 'D'), // 12h
    wpis('p1', '2026-11-04', 'D'), // 12h
    wpis('p1', '2026-11-05', 'D'), // 12h  == 48h razem
  ];
  it('blokuje 5. zmianę w tygodniu (60h) bez odnotowanej zgody opt-out', () => {
    const powod = blokada(pEtatBezZgodyOptOut, '2026-11-06', 'D', tydzien);
    expect(powod).toMatch(/^W6/);
  });
  it('NIE blokuje tej samej sytuacji przy odnotowanej zgodzie opt-out', () => {
    const powod = blokada(pEtatZgodaOptOut, '2026-11-06', 'D', tydzien);
    expect(powod).toBeNull();
  });
  it('nie blokuje, gdy tydzień jeszcze nie przekracza 48 h', () => {
    const trzyDni = tydzien.slice(0, 2); // 24h
    expect(blokada(pEtatBezZgodyOptOut, '2026-11-06', 'D', trzyDni)).toBeNull();
  });

  // Tydzień rozliczeniowy NIE jest tygodniem ISO (pon-nd) - zaczyna się w dniu
  // tygodnia, w który wypada 1. dzień okresu rozliczeniowego (Piotr, 2026-08-12;
  // patrz ANALIZA-arkuszy-Excel-realnych.md, sekcja 4). Maj 2026 zaczyna się w
  // piątek -> blok to piątek(01)-czwartek(07), NIE poniedziałek-niedziela.
  it('maj 2026: blok tygodnia rozliczeniowego to piątek(1)–czwartek(7), potwierdzony przykład Piotra', () => {
    const wpisy = [
      wpis('p1', '2026-05-01', 'D'), // piątek — 1. dzień okresu i 1. dzień bloku
      wpis('p1', '2026-05-02', 'D'), // sobota
      wpis('p1', '2026-05-03', 'D'), // niedziela
      wpis('p1', '2026-05-04', 'D'), // poniedziałek — 48h razem po 4 dniach
    ];
    // czwartek 07.05 to WCIĄŻ ten sam blok (piątek–czwartek) -> 60h -> blokada W6
    expect(blokada(pEtatBezZgodyOptOut, '2026-05-07', 'D', wpisy)).toMatch(/^W6/);
    // piątek 08.05 to już NOWY blok (kolejny tydzień rozliczeniowy) -> nie blokuje
    expect(blokada(pEtatBezZgodyOptOut, '2026-05-08', 'D', wpisy)).toBeNull();
  });

  it('maj 2026: poniedziałek i piątek tego samego tygodnia rozliczeniowego liczą się razem (różni się od ISO, gdzie byłyby w dwóch różnych tygodniach)', () => {
    // ISO: piątek 01.05 (Tydz. 18) vs poniedziałek 04.05 (Tydz. 19) - RÓŻNE tygodnie ISO.
    // Tydzień rozliczeniowy: oba w tym samym bloku piątek(01)-czwartek(07).
    const wpisy = [
      wpis('p1', '2026-05-01', 'D'), wpis('p1', '2026-05-02', 'D'),
      wpis('p1', '2026-05-03', 'D'), wpis('p1', '2026-05-04', 'D'), // 48h, piątek-poniedziałek
    ];
    expect(blokada(pEtatBezZgodyOptOut, '2026-05-05', 'D', wpisy)).toMatch(/^W6/);
  });
});

describe('grfPoczatekOkresuRozliczeniowego / okres = 2 miesiące (pary 1-2,3-4,...,11-12)', () => {
  it('maj i czerwiec należą do tego samego okresu (potwierdzone przez Piotra)', () => {
    // Weryfikacja pośrednia przez blokadę W6 na styku maj/czerwiec: jeśli oba
    // miesiące dzielą ten sam "poczatekOkresu", tydzień na styku 31.05/01.06
    // powinien się liczyć jako jeden blok tam, gdzie wypada.
    const wpisy = [
      wpis('p1', '2026-05-29', 'D'), wpis('p1', '2026-05-30', 'D'),
      wpis('p1', '2026-05-31', 'D'), wpis('p1', '2026-06-01', 'D'), // 48h, piątek 29.05–poniedziałek 01.06
    ];
    // 29.05–01.06 to wciąż ten sam blok (zaczyna się w piątek 29.05) mimo przejścia
    // przez granicę miesięcy — 02.06 dodaje 5. zmianę (60h) -> blokada W6
    expect(blokada(pEtatBezZgodyOptOut, '2026-06-02', 'D', wpisy)).toMatch(/^W6/);
  });
});

describe('W7 — DOBA dozwolona tylko jeśli oddział ją stosuje + odpoczynek po niej', () => {
  it('blokuje DOBA, gdy parametr stosujeDobe=false', () => {
    const parametry = { ...DOMYSLNE_PARAMETRY, stosujeDobe: false };
    expect(blokada(pKontrakt, '2026-11-05', 'DOBA', [], parametry)).toMatch(/^W7/);
  });
  it('pozwala na DOBA kontraktowi, gdy oddział ją stosuje (domyślnie)', () => {
    expect(blokada(pKontrakt, '2026-11-05', 'DOBA', [])).toBeNull();
  });
  it('blokuje D dzień po DOBIE (etat)', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'DOBA')];
    expect(blokada(pEtat, '2026-11-06', 'D', wpisy)).toMatch(/^W7/);
  });
  // UWAGA: ten test używa etatu (pEtat) mimo że etat i tak nie może brać DOBA (patrz
  // test niżej) - sprawdzana tu reguła "dwie doby z rzędu" jest dziś zaszyta w bloku
  // `forma === 'etat'` i wykonuje się PRZED nowym blokiem "DOBA tylko kontrakt/
  // zlecenie" (kolejność sprawdzeń w blokada()), więc nadal jest wykonywalna/testowalna
  // - w praktyce jednak, skoro etat nie może w ogóle wziąć DOBA, ten fragment kodu stał
  // się martwy dla realnego użycia. Zostawione jako regresja algorytmu "dwie doby z
  // rzędu", NIE jako opis realnego scenariusza biznesowego.
  it('blokuje dwie doby z rzędu (test regresyjny algorytmu - w praktyce nieosiągalne, bo etat nie bierze DOBA)', () => {
    const wpisy = [wpis('p1', '2026-11-06', 'DOBA')];
    expect(blokada(pEtat, '2026-11-05', 'DOBA', wpisy)).toMatch(/^W7/);
  });

  // POTWIERDZONE przez Piotra 2026-08-13: DOBA (24h) tylko dla kontraktu/zlecenia,
  // nigdy dla etatu - niezależnie od parametru stosujeDobe oddziału.
  it('blokuje DOBA dla etatu, nawet gdy oddział stosuje DOBA', () => {
    expect(blokada(pEtat, '2026-11-05', 'DOBA', [])).toMatch(/^W7/);
  });
  it('pozwala na DOBA dla zlecenia', () => {
    const pZlecenie = { id: 'p9', forma: 'zlecenie', etat: 1, grupa: 'main' };
    expect(blokada(pZlecenie, '2026-11-05', 'DOBA', [])).toBeNull();
  });
});

describe('W12 — przeciwwskazania indywidualne (flaga „bez nocek")', () => {
  it('blokuje N dla osoby z flagą bez_nocek', () => {
    expect(blokada(pFlaga, '2026-11-05', 'N', [])).toMatch(/^W12/);
  });
  it('blokuje DOBA dla osoby z flagą bez_nocek (kontrakt, żeby odizolować od reguły "DOBA tylko kontrakt/zlecenie")', () => {
    const pFlagaKontrakt = { ...pFlaga, forma: 'kontrakt' };
    expect(blokada(pFlagaKontrakt, '2026-11-05', 'DOBA', [])).toMatch(/^W12/);
  });
  it('pozwala na D dla osoby z flagą bez_nocek', () => {
    expect(blokada(pFlaga, '2026-11-05', 'D', [])).toBeNull();
  });
  it('nie blokuje N dla osoby bez flagi', () => {
    expect(blokada(pEtat, '2026-11-05', 'N', [])).toBeNull();
  });
});

describe('W8 — minimalna obsada dzienna (POTWIERDZONA przez Piotra 2026-08-13: 16 main / 4 opie, TWARDA)', () => {
  const parametry = DOMYSLNE_PARAMETRY;
  it('zwraca minimum main/D - jednakowe w dzień powszedni i weekend (16)', () => {
    expect(minimalnaObsada('main', 'D', '2026-11-04', parametry)).toBe(16); // środa
    expect(minimalnaObsada('main', 'D', '2026-11-07', parametry)).toBe(16); // sobota
  });
  it('zwraca minimum opie/D - jednakowe w dzień powszedni i weekend (4)', () => {
    expect(minimalnaObsada('opie', 'D', '2026-11-04', parametry)).toBe(4);
    expect(minimalnaObsada('opie', 'N', '2026-11-07', parametry)).toBe(4);
  });
  it('obsadaDnia liczy DOBA jako obsadzającą oba typy zmian', () => {
    const pracownicy = [pEtat, { ...pKontrakt, grupa: 'main' }];
    const wpisy = [wpis('p1', '2026-11-04', 'DOBA')];
    expect(obsadaDnia(wpisy, 'main', 'D', '2026-11-04', pracownicy)).toBe(1);
    expect(obsadaDnia(wpisy, 'main', 'N', '2026-11-04', pracownicy)).toBe(1);
  });
  it('ostrzezeniaMiesiaca zgłasza W8 jako TWARDE (hard), gdy obsada poniżej minimum', () => {
    const pracownicy = [pEtat];
    const out = ostrzezeniaMiesiaca([], pracownicy, 2026, 11);
    const w8 = out.filter(o => o.rule === 'W8');
    expect(w8.length).toBeGreaterThan(0);
    expect(w8.every(o => o.sev === 'hard')).toBe(true);
  });
});

describe('W14 — minimalna liczba pielęgniarek w ramach obsady main (POTWIERDZONA przez Piotra 2026-08-13, TWARDA)', () => {
  const pPiel1 = { id: 'pp1', forma: 'etat', etat: 1, grupa: 'main', stanowisko: 'pielegniarka' };
  const pPiel2 = { id: 'pp2', forma: 'etat', etat: 1, grupa: 'main', stanowisko: 'pielegniarka' };
  const pRat1 = { id: 'pr1', forma: 'etat', etat: 1, grupa: 'main', stanowisko: 'ratownik' };

  it('obsadaPielegniarekDnia liczy TYLKO stanowisko=pielegniarka w grupie main', () => {
    const wpisy = [wpis('pp1', '2026-11-05', 'D'), wpis('pr1', '2026-11-05', 'D')];
    expect(obsadaPielegniarekDnia(wpisy, 'D', '2026-11-05', [pPiel1, pRat1])).toBe(1);
  });
  it('ostrzezeniaMiesiaca zgłasza W14 (hard), gdy poniżej minimum 3 pielęgniarek, nawet z wystarczającą łączną obsadą main', () => {
    // 1 pielęgniarka + reszta ratownicy - sama liczba main może być >= 16, ale W14 i tak
    // zgłasza brak pielęgniarek (sprawdzane NIEZALEŻNIE od łącznej liczby W8).
    const wpisy = [wpis('pp1', '2026-11-05', 'D')];
    const out = ostrzezeniaMiesiaca(wpisy, [pPiel1, pRat1], 2026, 11);
    const w14 = out.find(o => o.rule === 'W14' && o.data === '2026-11-05');
    expect(w14).toBeDefined();
    expect(w14.sev).toBe('hard');
  });
  it('W14 nie zgłasza się dla dyżuru D, gdy jest wystarczająco pielęgniarek na D', () => {
    const pPiel3 = { id: 'pp3', forma: 'etat', etat: 1, grupa: 'main', stanowisko: 'pielegniarka' };
    const wpisy = [wpis('pp1', '2026-11-05', 'D'), wpis('pp2', '2026-11-05', 'D'), wpis('pp3', '2026-11-05', 'D')];
    const out = ostrzezeniaMiesiaca(wpisy, [pPiel1, pPiel2, pPiel3], 2026, 11);
    expect(out.some(o => o.rule === 'W14' && o.data === '2026-11-05' && o.komunikat.includes('dyżurze D'))).toBe(false);
  });
});

describe('W13 — min. 1 starszy asystent pielęgniarstwa na dyżurze (POTWIERDZONA przez Piotra 2026-08-13, MIĘKKA)', () => {
  const pSap = { id: 'psap', forma: 'etat', etat: 1, grupa: 'main', flagi: ['starszy_asystent'] };
  const pZwykly = { id: 'pzw', forma: 'etat', etat: 1, grupa: 'main' };

  it('zgłasza W13 (soft), gdy nikt z flagą starszy_asystent nie pracuje danego dnia', () => {
    const wpisy = [wpis('pzw', '2026-11-05', 'D')];
    const out = ostrzezeniaMiesiaca(wpisy, [pZwykly, pSap], 2026, 11);
    const w13 = out.find(o => o.rule === 'W13' && o.data === '2026-11-05' && o.komunikat.includes('dyżurze D'));
    expect(w13).toBeDefined();
    expect(w13.sev).toBe('soft');
  });
  it('NIE zgłasza W13 dla dyżuru D, gdy starszy asystent pracuje tego dnia D', () => {
    const wpisy = [wpis('psap', '2026-11-05', 'D')];
    const out = ostrzezeniaMiesiaca(wpisy, [pZwykly, pSap], 2026, 11);
    expect(out.some(o => o.rule === 'W13' && o.data === '2026-11-05' && o.komunikat.includes('dyżurze D'))).toBe(false);
  });
  it('konkretne osoby z flagą NIE są zaszyte w kodzie silnika - flaga żyje w danych pracownika', () => {
    // Dowód pośredni: silnik nie ma żadnej stałej z nazwiskami/ID - działa wyłącznie
    // przez pracownik.flagi przekazane z zewnątrz.
    expect(GRF_GODZ_KOD).not.toHaveProperty('starszy_asystent');
  });
});

describe('liczniki godzin (F1.5)', () => {
  it('godzinyPracownika sumuje godziny wg słownika kodów', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'D'), wpis('p1', '2026-11-06', 'N'), wpis('p1', '2026-11-07', 'W')];
    expect(godzinyPracownika(wpisy, 'p1')).toBe(24);
  });
  it('wymiarMiesieczny liczy normę × dni robocze × etat (listopad 2026: 21 dni robocze bez świąt)', () => {
    // Świadomie z pustą listą świąt (swieta:[]) - DOMYSLNE_PARAMETRY od 2026-08-30 ma
    // już wygenerowany kalendarz świąt PL (patrz grfSwietaLat), więc "bez świąt" trzeba
    // teraz jawnie wymusić, żeby odizolować sam mechanizm liczenia dni roboczych.
    const parametryBezSwiat = { ...DOMYSLNE_PARAMETRY, swieta: [] };
    const wymiar = wymiarMiesieczny(pEtat, 2026, 11, parametryBezSwiat);
    expect(wymiar).toBeCloseTo((7 + 35 / 60) * 21, 2);
  });
  it('uwzględnia święta z parametrów oddziału (jak w prototypie: 1 i 11 listopada)', () => {
    const parametry = { ...DOMYSLNE_PARAMETRY, swieta: ['2026-11-01', '2026-11-11'] };
    const wymiar = wymiarMiesieczny(pEtat, 2026, 11, parametry);
    expect(wymiar).toBeCloseTo(151.67, 1); // wartość referencyjna z prototypu (WYMIAR)
  });
  it('wymiar skaluje się z etatem cząstkowym', () => {
    const polEtatu = { ...pEtat, etat: 0.5 };
    expect(wymiarMiesieczny(polEtatu, 2026, 11)).toBeCloseTo(wymiarMiesieczny(pEtat, 2026, 11) / 2, 2);
  });

  // Potwierdzone na realnym arkuszu kadrowym (ANALIZA-arkuszy-Excel-realnych.md,
  // sekcja 6): CH (chorobowe) liczy się jako godziny wg stawki osoby, NIE zero -
  // wcześniejsza wersja tego pliku miała tu błąd (CH: 0).
  it('CH (chorobowe) liczy się wg dziennej stawki osoby, nie jako 0h', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'CH')];
    expect(godzinyPracownika(wpisy, 'p1', 1)).toBeCloseTo(7 + 35 / 60, 3);
  });
  it('UW liczy się wg dziennej stawki osoby (skaluje się z etatem cząstkowym)', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'UW')];
    expect(godzinyPracownika(wpisy, 'p1', 0.5)).toBeCloseTo((7 + 35 / 60) * 0.5, 3);
  });
  it('bez podanego etatu CH/UW domyślnie liczą się jak pełny etat (1)', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'CH')];
    expect(godzinyPracownika(wpisy, 'p1')).toBeCloseTo(7 + 35 / 60, 3);
  });

  // Potwierdzone przez Piotra 2026-08-13: godziny S (szkolenie) są ZAWSZE wpisywane
  // ręcznie przez układającego (różne szkolenia = różny czas trwania), więc silnik
  // świadomie NIE dolicza S do wymiaru - zgodne z realną formułą arkusza, która też
  // wyklucza S z grupy "godziny zaplanowane/wypracowane".
  it('S (szkolenie) NIE liczy się do wymiaru (0h) - wpisywane ręcznie poza automatem', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'S')];
    expect(godzinyPracownika(wpisy, 'p1', 1)).toBe(0);
  });

  // Potwierdzone przez Piotra 2026-08-12 (po analizie płachta_2026.xlsx, ~240 realnych
  // wystąpień DCH/NCH): liczą się jak CH, wg indywidualnej stawki osoby, NIE jako 0h -
  // ten sam błąd, który wcześniej poprawiliśmy dla CH.
  it('DCH liczy się wg dziennej stawki osoby (jak CH), nie jako 0h', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'DCH')];
    expect(godzinyPracownika(wpisy, 'p1', 1)).toBeCloseTo(7 + 35 / 60, 3);
  });
  it('NCH liczy się wg dziennej stawki osoby (skaluje się z etatem cząstkowym)', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'NCH')];
    expect(godzinyPracownika(wpisy, 'p1', 0.5)).toBeCloseTo((7 + 35 / 60) * 0.5, 3);
  });
});

// Plan/Realizacja (F: "płachta") — dopisane 2026-08-30, wzorem realnego arkusza
// płachta_2026.xlsx, gdzie po zamianie dyżurów osoba faktycznie pracuje inaczej niż
// w planie (np. plan D, realizacja N po zamianie z kolegą) - Piotr potwierdził, że
// godziny/reguły mają liczyć się WEDŁUG REALIZACJI, plan zostaje tylko jako adnotacja.
describe('grfKodEfektywny / realizacja przesłania plan w godzinach, obsadzie i regułach', () => {
  it('grfKodEfektywny zwraca kodRealizacji, jeśli ustawiony, inaczej kod (plan)', () => {
    expect(grfKodEfektywny({ kod: 'D', kodRealizacji: 'N' })).toBe('N');
    expect(grfKodEfektywny({ kod: 'D', kodRealizacji: '' })).toBe('D');
    expect(grfKodEfektywny({ kod: 'D' })).toBe('D');
    expect(grfKodEfektywny({ kod: 'D', kodRealizacji: null })).toBe('D');
  });

  it('godzinyPracownika liczy wg realizacji, nie planu, gdy realizacja jest inna', () => {
    // plan DOBA (24h), ale realizacja tylko D (12h) - np. skrócono dyżur
    const wpisy = [{ pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'DOBA', kodRealizacji: 'D' }];
    expect(godzinyPracownika(wpisy, 'p1', 1)).toBe(12);
  });

  it('obsadaDnia liczy osobę do obsady N, jeśli realizacja to N, mimo że plan to D (zamiana)', () => {
    const pracownicy = [{ id: 'p1', grupa: 'main' }];
    const wpisy = [{ pracownikId: 'p1', data: '2026-11-04', slot: 1, kod: 'D', kodRealizacji: 'N', zamianaZId: 'p2' }];
    expect(obsadaDnia(wpisy, 'main', 'D', '2026-11-04', pracownicy)).toBe(0);
    expect(obsadaDnia(wpisy, 'main', 'N', '2026-11-04', pracownicy)).toBe(1);
  });

  it('blokada() sprawdzana na kodzie realizacji: bez_nocek blokuje realizację N, mimo że plan (D) byłby dozwolony', () => {
    const wpisy = [];
    // symulujemy to, co api/grafik.js robi przy zapisie: sprawdzamy blokadę na
    // efektywnym (realizacja, jeśli ustawiona) kodzie
    const kodEfektywny = grfKodEfektywny({ kod: 'D', kodRealizacji: 'N' });
    expect(blokada(pFlaga, '2026-11-05', kodEfektywny, wpisy)).toMatch(/W12/);
  });

  it('W3 (odpoczynek po nocce) wykrywany wg realizacji sąsiedniego dnia, nie planu', () => {
    // dzień 5: plan W (wolne), ale realizacja N (ktoś się zamienił i wziął nockę)
    // dzień 6: próba wpisania D powinna być zablokowana tak samo, jakby dzień 5 miał wprost kod N
    const wpisy = [{ pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'W', kodRealizacji: 'N' }];
    expect(blokada(pEtat, '2026-11-06', 'D', wpisy)).toMatch(/W3/);
  });
});

// W9/W16/W17 — reguły ROCZNE, dopisane 2026-08-30 na podstawie wytyczne_grafik_
// oddzialowa.docx i legendy z arkuszy "maj-czerwiec ... 2026.xlsx". Wszystkie
// wymagają `wpisyRoczne` (6. argument ostrzezeniaMiesiaca) - cały rok, nie tylko
// przeglądany miesiąc/parę miesięcy.
describe('W9 — urlop na żądanie, limit ROCZNY (poprawione, wcześniej liczone tylko w miesiącu)', () => {
  it('NIE zgłasza W9, gdy w całym roku jest dokładnie limitNzDniRok (4) dni Nz, nawet jeśli wszystkie w innym miesiącu niż przeglądany', () => {
    const roczne = ['01', '02', '03', '04'].map((m) => wpis('p1', '2026-' + m + '-10', 'Nz'));
    const out = ostrzezeniaMiesiaca([], [pEtat], 2026, 11, DOMYSLNE_PARAMETRY, roczne);
    expect(out.some((o) => o.rule === 'W9')).toBe(false);
  });
  it('zgłasza W9 (soft), gdy w całym roku jest więcej niż limitNzDniRok dni Nz, rozrzuconych po różnych miesiącach', () => {
    const roczne = ['01', '02', '03', '04', '05'].map((m) => wpis('p1', '2026-' + m + '-10', 'Nz'));
    const out = ostrzezeniaMiesiaca([], [pEtat], 2026, 11, DOMYSLNE_PARAMETRY, roczne);
    const w9 = out.find((o) => o.rule === 'W9');
    expect(w9).toBeTruthy();
    expect(w9.sev).toBe('soft');
  });
  it('bez podanego wpisyRoczne używa samego `wpisy` (kompatybilność wstecz)', () => {
    const wpisy5 = ['01', '02', '03', '04', '05'].map((m) => wpis('p1', '2026-' + m + '-10', 'Nz'));
    const out = ostrzezeniaMiesiaca(wpisy5, [pEtat], 2026, 11, DOMYSLNE_PARAMETRY);
    expect(out.some((o) => o.rule === 'W9')).toBe(true);
  });
});

describe('W16 — roczne limity siły wyższej (SW) i opieki nad dzieckiem (Op), 2 dni LUB 16h, pule NIEZALEŻNE', () => {
  it('NIE zgłasza W16 przy dokładnie 2 dniach SW w roku (jednostka domyślna: dni)', () => {
    const roczne = [wpis('p1', '2026-02-01', 'SW'), wpis('p1', '2026-03-01', 'SW')];
    const out = ostrzezeniaMiesiaca([], [pEtat], 2026, 11, DOMYSLNE_PARAMETRY, roczne);
    expect(out.some((o) => o.rule === 'W16')).toBe(false);
  });
  it('zgłasza W16, gdy SW przekracza 2 dni w roku (jednostka: dni)', () => {
    const roczne = [wpis('p1', '2026-02-01', 'SW'), wpis('p1', '2026-03-01', 'SW'), wpis('p1', '2026-04-01', 'SW')];
    const out = ostrzezeniaMiesiaca([], [pEtat], 2026, 11, DOMYSLNE_PARAMETRY, roczne);
    const w16 = out.find((o) => o.rule === 'W16');
    expect(w16).toBeTruthy();
    expect(w16.sev).toBe('soft');
    expect(w16.komunikat).toMatch(/siły wyższej/);
  });
  it('jednostka "godziny" (p.silaWyzszaJednostka) liczy limit w godzinach (16h), nie w dniach', () => {
    const pGodziny = { ...pEtat, silaWyzszaJednostka: 'godziny' };
    // 2 dni SW po 7:35 = 15:10 - poniżej 16h, więc mimo 2 dni (które przy jednostce "dni" byłoby OK i tak) sprawdzamy że liczy godziny
    const roczneOk = [wpis('p1', '2026-02-01', 'SW'), wpis('p1', '2026-03-01', 'SW')];
    expect(ostrzezeniaMiesiaca([], [pGodziny], 2026, 11, DOMYSLNE_PARAMETRY, roczneOk).some((o) => o.rule === 'W16')).toBe(false);
    // 3 dni SW po 7:35 = 22:45 - ponad 16h -> zgłasza
    const rocznePrzekroczone = [wpis('p1', '2026-02-01', 'SW'), wpis('p1', '2026-03-01', 'SW'), wpis('p1', '2026-04-01', 'SW')];
    const out = ostrzezeniaMiesiaca([], [pGodziny], 2026, 11, DOMYSLNE_PARAMETRY, rocznePrzekroczone);
    const w16 = out.find((o) => o.rule === 'W16');
    expect(w16).toBeTruthy();
    expect(w16.komunikat).toMatch(/godz\.\/rok/);
  });
  it('SW i Op to DWIE NIEZALEŻNE pule - 3 dni SW (przekroczone) + 1 dzień Op (w normie) zgłasza W16 tylko dla SW', () => {
    const roczne = [
      wpis('p1', '2026-02-01', 'SW'), wpis('p1', '2026-03-01', 'SW'), wpis('p1', '2026-04-01', 'SW'),
      wpis('p1', '2026-05-01', 'Op'),
    ];
    const out = ostrzezeniaMiesiaca([], [pEtat], 2026, 11, DOMYSLNE_PARAMETRY, roczne).filter((o) => o.rule === 'W16');
    expect(out).toHaveLength(1);
    expect(out[0].komunikat).toMatch(/siły wyższej/);
  });
  it('2 dni SW + 2 dni Op (każde w granicy własnego limitu) NIE zgłasza W16 - pule się nie sumują', () => {
    const roczne = [
      wpis('p1', '2026-02-01', 'SW'), wpis('p1', '2026-03-01', 'SW'),
      wpis('p1', '2026-05-01', 'Op'), wpis('p1', '2026-06-01', 'Op'),
    ];
    const out = ostrzezeniaMiesiaca([], [pEtat], 2026, 11, DOMYSLNE_PARAMETRY, roczne);
    expect(out.some((o) => o.rule === 'W16')).toBe(false);
  });
});

describe('W17 — pilnowanie odbioru za pracę w niedzielę/święto (Wn) lub sobotę (Ws), okno ±6 dni', () => {
  it('zgłasza W17, gdy ktoś pracował w niedzielę i nie ma Wn w oknie ±6 dni', () => {
    // 2026-11-01 to niedziela (i jednocześnie Wszystkich Świętych - podwójnie "świąteczna")
    const roczne = [wpis('p1', '2026-11-01', 'D')];
    const out = ostrzezeniaMiesiaca(roczne, [pEtat], 2026, 11, DOMYSLNE_PARAMETRY, roczne);
    const w17 = out.find((o) => o.rule === 'W17' && o.data === '2026-11-01');
    expect(w17).toBeTruthy();
    expect(w17.sev).toBe('soft');
  });
  it('NIE zgłasza W17, gdy Wn jest w oknie ±6 dni (nawet w innym miesiącu niż przeglądany)', () => {
    const roczne = [wpis('p1', '2026-11-01', 'D'), wpis('p1', '2026-11-05', 'Wn')];
    const wpisyMiesiaca = [wpis('p1', '2026-11-01', 'D'), wpis('p1', '2026-11-05', 'Wn')];
    const out = ostrzezeniaMiesiaca(wpisyMiesiaca, [pEtat], 2026, 11, DOMYSLNE_PARAMETRY, roczne);
    expect(out.some((o) => o.rule === 'W17' && o.data === '2026-11-01')).toBe(false);
  });
  it('zgłasza W17 dla pracy w sobotę bez Ws w oknie', () => {
    // 2026-11-07 to sobota
    const roczne = [wpis('p1', '2026-11-07', 'N')];
    const out = ostrzezeniaMiesiaca(roczne, [pEtat], 2026, 11, DOMYSLNE_PARAMETRY, roczne);
    const w17 = out.find((o) => o.rule === 'W17' && o.data === '2026-11-07');
    expect(w17).toBeTruthy();
    expect(w17.komunikat).toMatch(/sobot/);
  });
  it('zgłasza W17 dla pracy w święto przypadające w zwykły dzień tygodnia (11 listopada, środa)', () => {
    const roczne = [wpis('p1', '2026-11-11', 'D')];
    const out = ostrzezeniaMiesiaca(roczne, [pEtat], 2026, 11, DOMYSLNE_PARAMETRY, roczne);
    const w17 = out.find((o) => o.rule === 'W17' && o.data === '2026-11-11');
    expect(w17).toBeTruthy();
    expect(w17.komunikat).toMatch(/święto/);
  });
  it('okno ±6 dni działa PONAD granicę miesiąca (Wn w grudniu za pracę w ostatnią niedzielę listopada)', () => {
    // 2026-11-29 to niedziela; Wn dopisany 3 grudnia (inny miesiąc) powinien się policzyć
    const rocznePelne = [wpis('p1', '2026-11-29', 'D'), wpis('p1', '2026-12-03', 'Wn')];
    const wpisyListopada = [wpis('p1', '2026-11-29', 'D')];
    const out = ostrzezeniaMiesiaca(wpisyListopada, [pEtat], 2026, 11, DOMYSLNE_PARAMETRY, rocznePelne);
    expect(out.some((o) => o.rule === 'W17' && o.data === '2026-11-29')).toBe(false);
  });
});

describe('Nn — nieobecność NIEusprawiedliwiona: 0h (nie obniża wymiaru jak pozostałe) i zawsze sygnalizowana', () => {
  it('Nn liczy się jako 0h, w odróżnieniu od pozostałych nieobecności (Ub/Us/Uo/Op/SW/Um/Zr/Nun/Nup liczą się wg stawki)', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'Nn')];
    expect(godzinyPracownika(wpisy, 'p1', 1)).toBe(0);
  });
  it('nowe kody usprawiedliwionych nieobecności liczą się wg indywidualnej stawki (jak UW/CH)', () => {
    ['Ub', 'Us', 'Uo', 'Op', 'SW', 'Um', 'Zr', 'Nun', 'Nup'].forEach((kod) => {
      const wpisy = [wpis('p1', '2026-11-05', kod)];
      expect(godzinyPracownika(wpisy, 'p1', 1)).toBeCloseTo(7 + 35 / 60, 3);
    });
  });
  it('zgłasza ostrzeżenie za każdym razem, gdy pojawia się Nn w grafiku', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'Nn')];
    const out = ostrzezeniaMiesiaca(wpisy, [pEtat], 2026, 11, DOMYSLNE_PARAMETRY, wpisy);
    expect(out.some((o) => o.komunikat.indexOf('NIEusprawiedliwiona') !== -1)).toBe(true);
  });
});

describe('W5 — norma CAŁEGO 2-miesięcznego okresu rozliczeniowego (nie pojedynczego miesiąca)', () => {
  it('wymiarOkresuRozliczeniowego sumuje oba miesiące pary, ten sam wynik niezależnie który z nich podamy', () => {
    const suma = wymiarMiesieczny(pEtat, 2026, 11) + wymiarMiesieczny(pEtat, 2026, 12);
    expect(wymiarOkresuRozliczeniowego(pEtat, 2026, 12)).toBeCloseTo(suma, 5);
    expect(wymiarOkresuRozliczeniowego(pEtat, 2026, 11)).toBeCloseTo(suma, 5);
  });

  it('godzinyOkresuRozliczeniowego sumuje wpisy z OBU miesięcy pary, nie tylko z podanego miesiąca', () => {
    const wpisy = [wpis('p1', '2026-11-05', 'D'), wpis('p1', '2026-12-05', 'D'), wpis('p2', '2026-11-06', 'D')];
    expect(godzinyOkresuRozliczeniowego(wpisy, 'p1', 1, 2026, 12)).toBe(24); // D (listopad) + D (grudzień)
    expect(godzinyOkresuRozliczeniowego(wpisy, 'p1', 1, 2026, 11)).toBe(24); // ten sam wynik dla dowolnego miesiąca pary
  });

  it('ostrzezeniaMiesiaca NIE zgłasza W5 przy przeglądzie PIERWSZEGO miesiąca pary (bilans może się jeszcze wyrównać w drugim)', () => {
    const wymNov = wymiarMiesieczny(pEtat, 2026, 11);
    const dniD = Math.round(wymNov / 12); // D = 12h/dyżur
    const wpisy = [];
    for (let d = 1; d <= dniD; d++) wpisy.push(wpis('p1', `2026-11-${String(d).padStart(2, '0')}`, 'D'));
    const out = ostrzezeniaMiesiaca(wpisy, [pEtat], 2026, 11);
    expect(out.some(o => o.rule === 'W5')).toBe(false);
  });

  it('ostrzezeniaMiesiaca zgłasza W5 dopiero przy przeglądzie DRUGIEGO (zamykającego) miesiąca pary, licząc sumę obu miesięcy', () => {
    // Tyle D w listopadzie, żeby dokładnie trafić normę SAMEGO listopada, i ZERO
    // wpisów w grudniu — w sumie za cały okres brakuje ~normy grudnia (niedobór).
    const wymNov = wymiarMiesieczny(pEtat, 2026, 11);
    const dniD = Math.round(wymNov / 12);
    const wpisy = [];
    for (let d = 1; d <= dniD; d++) wpisy.push(wpis('p1', `2026-11-${String(d).padStart(2, '0')}`, 'D'));
    const out = ostrzezeniaMiesiaca(wpisy, [pEtat], 2026, 12);
    expect(out.some(o => o.rule === 'W5' && /Niedob.r do wymiaru okresu rozliczeniowego/.test(o.komunikat))).toBe(true);
  });

  it('ostrzezeniaMiesiaca (drugi miesiąc pary) liczy sumę wpisów z OBU miesięcy, nie tylko grudnia', () => {
    // Każdy miesiąc dostaje wpisy nadające dokładnie normę TEGO miesiąca (żeby pojedynczy
    // miesiąc sam w sobie nie przekraczał tolerancji) - ale SUMA obu miesięcy w 12h dyżurach
    // (zaokrąglonych w górę) przekracza normę całego okresu o więcej niż tolerancję.
    const dniDNov = Math.ceil(wymiarMiesieczny(pEtat, 2026, 11) / 12) + 1;
    const dniDDec = Math.ceil(wymiarMiesieczny(pEtat, 2026, 12) / 12) + 1;
    const wpisy = [];
    for (let d = 1; d <= dniDNov; d++) wpisy.push(wpis('p1', `2026-11-${String(d).padStart(2, '0')}`, 'D'));
    for (let d = 1; d <= dniDDec; d++) wpisy.push(wpis('p1', `2026-12-${String(d).padStart(2, '0')}`, 'D'));
    const out = ostrzezeniaMiesiaca(wpisy, [pEtat], 2026, 12);
    expect(out.some(o => o.rule === 'W5' && /Przekroczony wymiar okresu rozliczeniowego/.test(o.komunikat))).toBe(true);
  });
});

describe('W15 — zakres godzin (min/max łącznie) dla osób na zlecenie/kontrakt, okres MIESIĘCZNY (nie 2-miesięczny jak W5)', () => {
  const pZlecenieZakres = { id: 'p5', forma: 'zlecenie', grupa: 'opie', zlecenieMinGodzin: 96, zlecenieMaxGodzin: 240 };
  const pKontraktZakres = { id: 'p7', forma: 'kontrakt', grupa: 'main', zlecenieMinGodzin: 96, zlecenieMaxGodzin: 240 };

  it('NIE zgłasza W15, gdy suma godzin SAMEGO przeglądanego miesiąca mieści się w zakresie [min, max]', () => {
    // 12 dyżurów D po 12h w listopadzie = 144h, w zakresie 96-240.
    const wpisy = [];
    for (let d = 1; d <= 12; d++) wpisy.push(wpis('p5', `2026-11-${String(d).padStart(2, '0')}`, 'D'));
    const out = ostrzezeniaMiesiaca(wpisy, [pZlecenieZakres], 2026, 11);
    expect(out.some(o => o.rule === 'W15')).toBe(false);
  });

  it('zgłasza W15 (przekroczony max) już w PIERWSZYM miesiącu, licząc TYLKO ten miesiąc (nie parę jak W5)', () => {
    // 22 dyżury D w listopadzie = 264h > max 240h - grudzień pusty, nie ma znaczenia.
    const wpisy = [];
    for (let d = 1; d <= 22; d++) wpisy.push(wpis('p5', `2026-11-${String(d).padStart(2, '0')}`, 'D'));
    const out = ostrzezeniaMiesiaca(wpisy, [pZlecenieZakres], 2026, 11);
    expect(out.some(o => o.rule === 'W15' && /Przekroczony maksymalny zakres godzin miesi.ca/.test(o.komunikat))).toBe(true);
  });

  it('nie liczy godzin z SĄSIEDNIEGO miesiąca do bieżącego (w odróżnieniu od W5)', () => {
    // 22 dyżury D w listopadzie (264h > max), 0 w grudniu - przegląd GRUDNIA nie
    // powinien zgłosić W15, bo grudzień sam w sobie ma 0h (w zakresie [96,240]? nie,
    // 0 < min 96 - test niedoboru), a na pewno NIE powinien "zobaczyć" nadwyżki z listopada.
    const wpisy = [];
    for (let d = 1; d <= 22; d++) wpisy.push(wpis('p5', `2026-11-${String(d).padStart(2, '0')}`, 'D'));
    const outGrudzien = ostrzezeniaMiesiaca(wpisy, [pZlecenieZakres], 2026, 12);
    expect(outGrudzien.some(o => o.rule === 'W15' && /Przekroczony maksymalny/.test(o.komunikat))).toBe(false);
    expect(outGrudzien.some(o => o.rule === 'W15' && /Niedob.r do minimalnego/.test(o.komunikat))).toBe(true);
  });

  it('zgłasza W15 (niedobór do min) gdy suma godzin przeglądanego miesiąca poniżej minimum', () => {
    // 3 dyżury D w listopadzie = 36h < min 96h.
    const wpisy = [wpis('p5', '2026-11-01', 'D'), wpis('p5', '2026-11-02', 'D'), wpis('p5', '2026-11-03', 'D')];
    const out = ostrzezeniaMiesiaca(wpisy, [pZlecenieZakres], 2026, 11);
    expect(out.some(o => o.rule === 'W15' && /Niedob.r do minimalnego zakresu godzin miesi.ca/.test(o.komunikat))).toBe(true);
  });

  it('działa też dla osoby na KONTRAKCIE (nie tylko zlecenie)', () => {
    const wpisy = [wpis('p7', '2026-11-01', 'D'), wpis('p7', '2026-11-02', 'D')]; // 24h < min 96h
    const out = ostrzezeniaMiesiaca(wpisy, [pKontraktZakres], 2026, 11);
    expect(out.some(o => o.rule === 'W15' && /Niedob.r do minimalnego/.test(o.komunikat))).toBe(true);
  });

  it('nie zgłasza W15 dla osoby na zlecenie bez ustawionego zakresu godzin', () => {
    const pBezZakresu = { id: 'p6', forma: 'zlecenie', grupa: 'opie' };
    const wpisy = [wpis('p6', '2026-11-01', 'D')];
    const out = ostrzezeniaMiesiaca(wpisy, [pBezZakresu], 2026, 11);
    expect(out.some(o => o.rule === 'W15')).toBe(false);
  });

  it('nie zgłasza W15 dla osoby na etacie (reguła dotyczy tylko zlecenia/kontraktu)', () => {
    const pEtatZZakresem = { ...pEtat, zlecenieMinGodzin: 96, zlecenieMaxGodzin: 240 };
    const wpisy = [wpis('p1', '2026-11-01', 'D')];
    const out = ostrzezeniaMiesiaca(wpisy, [pEtatZZakresem], 2026, 11);
    expect(out.some(o => o.rule === 'W15')).toBe(false);
  });
});

describe('F2.4 — kandydaciNaDziure', () => {
  it('pomija osoby, którym blokada() zabrania wziąć zmianę', () => {
    const wpisy = [wpis('p3', '2026-11-04', undefined)].filter(() => false); // brak wpisów
    const kandydaci = kandydaciNaDziure('2026-11-05', 'N', 'main', wpisy, [pEtat, pFlaga], 2026, 11);
    expect(kandydaci.map(k => k.id)).toContain('p1');
    expect(kandydaci.map(k => k.id)).not.toContain('p3'); // flaga bez_nocek
  });
  it('sortuje po wykorzystaniu wymiaru, nie po godzinach bezwzględnych', () => {
    const pPolEtatu = { ...pEtat, id: 'p4', etat: 0.5 };
    // p1 ma 0h, p4 (pół etatu) ma już 60h wykorzystania -> mimo mniejszych godzin bezwzględnych
    // niż mógłby mieć pełnoetatowiec, liczy się % wymiaru
    const wpisy = [wpis('p4', '2026-11-01', 'D'), wpis('p4', '2026-11-02', 'D'), wpis('p4', '2026-11-03', 'D'),
      wpis('p4', '2026-11-04', 'D'), wpis('p4', '2026-11-05', 'D')];
    const kandydaci = kandydaciNaDziure('2026-11-10', 'D', 'main', wpisy, [pEtat, pPolEtatu], 2026, 11);
    expect(kandydaci[0].id).toBe('p1'); // mniej wykorzystany wymiar idzie pierwszy
  });
});

describe('generujBrakujaceDyzury — generator uzupełniający obsadę (przycisk "Generuj grafik")', () => {
  // Obsady zmniejszone dla czytelnych fixture'ów (nie trzeba 16 osób main w teście) -
  // wzorem innych describe (patrz np. linia ~146 "stosujeDobe: false").
  const parametryMale = {
    ...DOMYSLNE_PARAMETRY,
    obsady: {
      main: { dzienPow: { D: 2, N: 2 }, weekendSwieto: { D: 2, N: 2 } },
      opie: { dzienPow: { D: 1, N: 1 }, weekendSwieto: { D: 1, N: 1 } },
    },
    minimalnaLiczbaPielegniarekNaDyzurze: 1,
  };
  // forma='kontrakt' w fixture'ach (nie etat), żeby test skupiał się na logice
  // generatora, a nie przypadkowo wpadał w niepowiązane reguły etatowe (W3/W6) przy
  // wielu dniach z rzędu z tą samą, minimalną obsadą - to osobno pokryte w W3/W6 wyżej.

  it('uzupełnia brakującą obsadę main do minimum, dopisując wpisy D pierwszego dnia', () => {
    const p1 = { id: 'g1', forma: 'kontrakt', etat: 1, grupa: 'main' };
    const p2 = { id: 'g2', forma: 'kontrakt', etat: 1, grupa: 'main' };
    const { noweWpisy } = generujBrakujaceDyzury([], [p1, p2], 2026, 11, parametryMale);
    const dzien1 = noweWpisy.filter(w => w.data === '2026-11-01' && w.kod === 'D');
    expect(dzien1.length).toBe(2);
    expect(dzien1.map(w => w.pracownikId).sort()).toEqual(['g1', 'g2']);
  });

  it('nie dodaje drugiego wpisu osobie, która tego dnia już ma dyżur (nie nadpisuje istniejących danych)', () => {
    const p1 = { id: 'g1', forma: 'kontrakt', etat: 1, grupa: 'main' };
    const p2 = { id: 'g2', forma: 'kontrakt', etat: 1, grupa: 'main' };
    const p3 = { id: 'g3', forma: 'kontrakt', etat: 1, grupa: 'main' };
    const istniejace = [wpis('g1', '2026-11-01', 'D')];
    const { noweWpisy } = generujBrakujaceDyzury(istniejace, [p1, p2, p3], 2026, 11, parametryMale);
    const dzien1 = noweWpisy.filter(w => w.data === '2026-11-01' && w.kod === 'D');
    expect(dzien1.some(w => w.pracownikId === 'g1')).toBe(false);
    expect(dzien1.length).toBe(1); // g1 już liczy się do obsady (min 2), brakuje tylko 1
  });

  it('main: dobiera najpierw pielęgniarki, żeby spełnić W14, zanim uzupełni resztą', () => {
    const piel = { id: 'piel1', forma: 'kontrakt', etat: 1, grupa: 'main', stanowisko: 'pielegniarka' };
    const rat1 = { id: 'rat1', forma: 'kontrakt', etat: 1, grupa: 'main', stanowisko: 'ratownik' };
    const rat2 = { id: 'rat2', forma: 'kontrakt', etat: 1, grupa: 'main', stanowisko: 'ratownik' };
    const { noweWpisy } = generujBrakujaceDyzury([], [rat1, rat2, piel], 2026, 11, parametryMale);
    const dzien1 = noweWpisy.filter(w => w.data === '2026-11-01' && w.kod === 'D');
    expect(dzien1.map(w => w.pracownikId)).toContain('piel1');
  });

  it('opie: przy uzupełnianiu preferuje kandydatów uprawnionych do danego typu dyżuru (jeśli dane są w ogóle podane)', () => {
    const tylkoNoc = { id: 'o1', forma: 'kontrakt', etat: 1, grupa: 'opie', typyDyzuru: ['noc'] };
    const tylkoDzien = { id: 'o2', forma: 'kontrakt', etat: 1, grupa: 'opie', typyDyzuru: ['dzien'] };
    const { noweWpisy } = generujBrakujaceDyzury([], [tylkoNoc, tylkoDzien], 2026, 11, parametryMale);
    const dzienD = noweWpisy.filter(w => w.data === '2026-11-01' && w.kod === 'D');
    expect(dzienD.map(w => w.pracownikId)).toEqual(['o2']);
  });

  it('opie: bez żadnych danych o typie dyżuru w całej grupie, dobiera kogokolwiek (brak ograniczenia)', () => {
    const o1 = { id: 'o1', forma: 'kontrakt', etat: 1, grupa: 'opie' };
    const o2 = { id: 'o2', forma: 'kontrakt', etat: 1, grupa: 'opie' };
    const { noweWpisy } = generujBrakujaceDyzury([], [o1, o2], 2026, 11, parametryMale);
    const dzienD = noweWpisy.filter(w => w.data === '2026-11-01' && w.kod === 'D');
    expect(dzienD.length).toBe(1);
  });

  it('nie przydziela nocki osobie z flagą "bez_nocek" (reguła twarda W12) i zgłasza brak w `braki`', () => {
    // D=0, żeby izolować test od dziennej zmiany (inaczej D zabrałby kandydatów
    // przed dojściem do N i test sprawdzałby coś innego, niż zamierzono).
    const parametryTylkoNoc = {
      ...parametryMale,
      obsady: { ...parametryMale.obsady, main: { dzienPow: { D: 0, N: 2 }, weekendSwieto: { D: 0, N: 2 } } },
    };
    const p1 = { id: 'g1', forma: 'kontrakt', etat: 1, grupa: 'main', flagi: ['bez_nocek'] };
    const p2 = { id: 'g2', forma: 'kontrakt', etat: 1, grupa: 'main' };
    const { noweWpisy, braki } = generujBrakujaceDyzury([], [p1, p2], 2026, 11, parametryTylkoNoc);
    const nocDzien1 = noweWpisy.filter(w => w.data === '2026-11-01' && w.kod === 'N');
    expect(nocDzien1.map(w => w.pracownikId)).toEqual(['g2']);
    const brak = braki.find(b => b.data === '2026-11-01' && b.grupa === 'main' && b.typ === 'N');
    expect(brak).toBeDefined();
    expect(brak.brakuje).toBe(1);
  });

  it('nigdy nie generuje samodzielnie dyżurów DOBA (zostawia tę decyzję układającemu)', () => {
    const p1 = { id: 'g1', forma: 'zlecenie', etat: 1, grupa: 'main' };
    const { noweWpisy } = generujBrakujaceDyzury([], [p1], 2026, 11, parametryMale);
    expect(noweWpisy.some(w => w.kod === 'DOBA')).toBe(false);
  });
});

describe('odm — odmiana liczebników PL', () => {
  it('liczba pojedyncza', () => expect(odm(1, 'dzień', 'dni', 'dni')).toBe('1 dzień'));
  it('liczba kilka (2–4)', () => expect(odm(3, 'pozycję', 'pozycje', 'pozycji')).toBe('3 pozycje'));
  it('liczba wiele (5+)', () => expect(odm(5, 'pozycję', 'pozycje', 'pozycji')).toBe('5 pozycji'));
  it('wyjątek 12–14 → forma "wiele"', () => expect(odm(13, 'pozycję', 'pozycje', 'pozycji')).toBe('13 pozycji'));
});
