import { describe, it, expect } from 'vitest';
import { rekordyDoHarmonogramu, harmonogramDoRekordow, wzKluczArkusza, graniczneDniPoprzedniegoMiesiaca } from './warstwaZgodnosci.js';

const pracownicy = [
  { id: 'p1', imieNazwisko: 'Kowalczyk Marta', grupa: 'main' },
  { id: 'p2', imieNazwisko: 'Wróbel Teresa', grupa: 'opie' },
];

describe('wzKluczArkusza', () => {
  it('zwraca nazwę miesiąca dla main', () => {
    expect(wzKluczArkusza(11, 'main')).toBe('listopad');
  });
  it('dodaje prefiks Opie- dla grupy opie', () => {
    expect(wzKluczArkusza(11, 'opie')).toBe('Opie-listopad');
  });
  it('styczeń to miesiąc 1', () => {
    expect(wzKluczArkusza(1, 'main')).toBe('styczeń');
  });
});

describe('rekordyDoHarmonogramu', () => {
  it('tworzy sekcję entries[] z type:"employee", kluczowaną nazwą miesiąca', () => {
    const wpisy = [
      { pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'D' },
      { pracownikId: 'p1', data: '2026-11-06', slot: 1, kod: 'N' },
    ];
    const dok = rekordyDoHarmonogramu(wpisy, pracownicy, 2026, 11);
    expect(dok.listopad.entries).toHaveLength(1);
    expect(dok.listopad.entries[0]).toMatchObject({ type: 'employee', name: 'Kowalczyk Marta' });
    expect(dok.listopad.entries[0].row1['5']).toBe('D');
    expect(dok.listopad.entries[0].row1['6']).toBe('N');
  });

  it('grupa opie trafia pod klucz "Opie-<miesiąc>", osobno od main', () => {
    const wpisy = [{ pracownikId: 'p2', data: '2026-11-05', slot: 1, kod: 'D' }];
    const dok = rekordyDoHarmonogramu(wpisy, pracownicy, 2026, 11);
    expect(dok['Opie-listopad'].entries[0].name).toBe('Wróbel Teresa');
    // main NIE jest pomijane, mimo braku wpisów - funkcja zawsze generuje wiersz
    // dla każdego pracownika z przekazanej listy (tak jak pełny arkusz Excela
    // zawsze ma wiersz per osoba, nawet z pustymi komórkami).
    expect(dok.listopad.entries[0]).toMatchObject({ name: 'Kowalczyk Marta', row1: {}, row2: {} });
  });

  it('klucze dni BEZ zera wiodącego ("5", nie "05") - jak w hgParsujArkusz', () => {
    const wpisy = [{ pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'D' }];
    const dok = rekordyDoHarmonogramu(wpisy, pracownicy, 2026, 11);
    expect(dok.listopad.entries[0].row1).toHaveProperty('5');
    expect(dok.listopad.entries[0].row1).not.toHaveProperty('05');
  });

  it('pomija wpisy spoza podanego miesiąca (np. dzień graniczny do W3) - komórka zostaje pusta', () => {
    const wpisy = [{ pracownikId: 'p1', data: '2026-10-31', slot: 1, kod: 'N' }];
    const dok = rekordyDoHarmonogramu(wpisy, pracownicy, 2026, 11);
    expect(dok.listopad.entries[0].row1).toEqual({});
  });

  it('notatka trafia do c1 (slot 1) / c2 (slot 2), nie do row1/row2', () => {
    const wpisy = [
      { pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'D', notatka: 'zamiana z A. Nowak' },
      { pracownikId: 'p1', data: '2026-11-05', slot: 2, kod: 'S', notatka: 'kurs' },
    ];
    const dok = rekordyDoHarmonogramu(wpisy, pracownicy, 2026, 11);
    const entry = dok.listopad.entries[0];
    expect(entry.row1['5']).toBe('D');
    expect(entry.c1['5']).toBe('zamiana z A. Nowak');
    expect(entry.row2['5']).toBe('S');
    expect(entry.c2['5']).toBe('kurs');
  });

  it('bez notatek entry nie ma pól c1/c2 wcale (nie puste obiekty)', () => {
    const wpisy = [{ pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'D' }];
    const dok = rekordyDoHarmonogramu(wpisy, pracownicy, 2026, 11);
    expect(dok.listopad.entries[0].c1).toBeUndefined();
  });

  it('zachowuje kolejność pracowników z listy wejściowej', () => {
    const odwrotna = [pracownicy[1], pracownicy[0]];
    const wpisy = [
      { pracownikId: 'p2', data: '2026-11-05', slot: 1, kod: 'D' },
    ];
    // p2 jest w grupie opie, więc trafia do osobnej sekcji - test kolejności w obrębie main:
    const dwieOsobyMain = [
      { id: 'a', imieNazwisko: 'Aaa', grupa: 'main' },
      { id: 'b', imieNazwisko: 'Bbb', grupa: 'main' },
    ];
    const wpisyMain = [
      { pracownikId: 'b', data: '2026-11-05', slot: 1, kod: 'D' },
      { pracownikId: 'a', data: '2026-11-05', slot: 1, kod: 'N' },
    ];
    const dok = rekordyDoHarmonogramu(wpisyMain, dwieOsobyMain, 2026, 11);
    expect(dok.listopad.entries.map(e => e.name)).toEqual(['Aaa', 'Bbb']); // kolejność listy pracownicy, nie wpisów
  });
});

describe('harmonogramDoRekordow — odwrotność (round-trip)', () => {
  it('odtwarza wpisy z dokumentu wygenerowanego przez rekordyDoHarmonogramu', () => {
    const oryginalne = [
      { pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'D' },
      { pracownikId: 'p1', data: '2026-11-06', slot: 1, kod: 'N' },
      { pracownikId: 'p2', data: '2026-11-05', slot: 1, kod: 'D' },
    ];
    const dok = rekordyDoHarmonogramu(oryginalne, pracownicy, 2026, 11);
    const odtworzone = harmonogramDoRekordow(dok, pracownicy, 2026, 11);
    expect(odtworzone).toHaveLength(3);
    expect(odtworzone).toEqual(expect.arrayContaining(oryginalne.map(w => expect.objectContaining(w))));
  });

  it('pomija entries typu "gap"', () => {
    const dok = { listopad: { entries: [{ type: 'gap' }, { type: 'employee', name: 'Kowalczyk Marta', row1: { '1': 'D' }, row2: {} }] } };
    const wpisy = harmonogramDoRekordow(dok, pracownicy, 2026, 11);
    expect(wpisy).toHaveLength(1);
    expect(wpisy[0].kod).toBe('D');
  });

  it('pomija osoby, których nie ma na liście pracowników (nazwisko niedopasowane)', () => {
    const dok = { listopad: { entries: [{ type: 'employee', name: 'Ktoś Nieznany', row1: { '1': 'D' }, row2: {} }] } };
    expect(harmonogramDoRekordow(dok, pracownicy, 2026, 11)).toHaveLength(0);
  });

  it('odtwarza notatkę z c1/c2', () => {
    const wpisy = [{ pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'D', notatka: 'uwaga' }];
    const dok = rekordyDoHarmonogramu(wpisy, pracownicy, 2026, 11);
    const odtworzone = harmonogramDoRekordow(dok, pracownicy, 2026, 11);
    expect(odtworzone[0].notatka).toBe('uwaga');
  });

  it('brak sekcji dla danego miesiąca/grupy nie wywala błędu, zwraca pustą tablicę', () => {
    expect(harmonogramDoRekordow({}, pracownicy, 2026, 11)).toEqual([]);
  });
});

describe('graniczneDniPoprzedniegoMiesiaca', () => {
  it('zwraca ostatni dzień poprzedniego miesiąca', () => {
    expect(graniczneDniPoprzedniegoMiesiaca(2026, 11, 1)).toEqual(['2026-10-31']);
  });
  it('zwraca N dni wstecz w kolejności rosnącej', () => {
    expect(graniczneDniPoprzedniegoMiesiaca(2026, 11, 2)).toEqual(['2026-10-30', '2026-10-31']);
  });
});
