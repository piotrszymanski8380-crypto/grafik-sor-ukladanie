import { describe, it, expect } from 'vitest';
import {
  sgNowyGrafik,
  sgZapiszZmiane,
  sgOpublikuj,
  sgWznowEdycje,
  sgHistoriaKomorki,
  sgMoznaEdytowac,
} from './stanGrafiku.js';

describe('sgNowyGrafik', () => {
  it('startuje w statusie roboczym, wersja 1, pusta historia', () => {
    const stan = sgNowyGrafik();
    expect(stan.status).toBe('roboczy');
    expect(stan.wersja).toBe(1);
    expect(stan.wpisy).toEqual([]);
    expect(stan.historia).toEqual([]);
  });
  it('przyjmuje wpisy początkowe (np. z importu Excela)', () => {
    const wpisy = [{ pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'D' }];
    const stan = sgNowyGrafik(wpisy);
    expect(stan.wpisy).toHaveLength(1);
  });
});

describe('sgZapiszZmiane', () => {
  it('dodaje nowy wpis i loguje historię z staraWartosc=null', () => {
    const stan = sgNowyGrafik();
    const nowy = sgZapiszZmiane(stan, { pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'D' }, 'admin');
    expect(nowy.wpisy).toHaveLength(1);
    expect(nowy.wpisy[0].kod).toBe('D');
    expect(nowy.historia).toHaveLength(1);
    expect(nowy.historia[0].staraWartosc).toBeNull();
    expect(nowy.historia[0].nowaWartosc).toBe('D');
    expect(nowy.historia[0].kto).toBe('admin');
  });

  it('nadpisuje istniejący wpis tej samej komórki i pamięta starą wartość w historii', () => {
    let stan = sgNowyGrafik();
    stan = sgZapiszZmiane(stan, { pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'D' }, 'admin');
    stan = sgZapiszZmiane(stan, { pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'N' }, 'admin', 'poprawka po telefonie');
    expect(stan.wpisy).toHaveLength(1); // nie duplikuje komórki
    expect(stan.wpisy[0].kod).toBe('N');
    expect(stan.historia).toHaveLength(2);
    expect(stan.historia[1].staraWartosc).toBe('D');
    expect(stan.historia[1].nowaWartosc).toBe('N');
    expect(stan.historia[1].kontekst).toBe('poprawka po telefonie');
  });

  it('kod pusty/null czyści komórkę (usuwa wpis)', () => {
    let stan = sgNowyGrafik();
    stan = sgZapiszZmiane(stan, { pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'D' }, 'admin');
    stan = sgZapiszZmiane(stan, { pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: null }, 'admin');
    expect(stan.wpisy).toHaveLength(0);
    expect(stan.historia[1].nowaWartosc).toBeNull();
  });

  it('zapisuje kodRealizacji i zamianaZId razem z planem (F: "płachta" — plan/realizacja/komentarz zamiany)', () => {
    let stan = sgNowyGrafik();
    stan = sgZapiszZmiane(stan, {
      pracownikId: 'p1', data: '2026-11-05', slot: 1,
      kod: 'D', kodRealizacji: 'N', zamianaZId: 'p2',
    }, 'admin');
    expect(stan.wpisy[0].kod).toBe('D');
    expect(stan.wpisy[0].kodRealizacji).toBe('N');
    expect(stan.wpisy[0].zamianaZId).toBe('p2');
  });

  it('nie mutuje oryginalnego stanu (zwraca nową kopię)', () => {
    const stan = sgNowyGrafik();
    const nowy = sgZapiszZmiane(stan, { pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'D' }, 'admin');
    expect(stan.wpisy).toHaveLength(0); // oryginał nietknięty
    expect(nowy.wpisy).toHaveLength(1);
  });

  it('rzuca błąd przy próbie edycji opublikowanego grafiku', () => {
    let stan = sgNowyGrafik();
    const wynik = sgOpublikuj(stan, [], 'admin');
    stan = wynik.stan;
    expect(() => sgZapiszZmiane(stan, { pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'D' }, 'admin'))
      .toThrow(/SG1/);
  });
});

describe('sgOpublikuj', () => {
  it('publikuje bez ostrzeżeń: podnosi wersję, zmienia status, loguje w historii', () => {
    const stan = sgNowyGrafik();
    const wynik = sgOpublikuj(stan, [], 'admin');
    expect(wynik.ok).toBe(true);
    expect(wynik.stan.status).toBe('opublikowany');
    expect(wynik.stan.wersja).toBe(2);
    expect(wynik.stan.historia[0].akcja).toBe('publikacja');
  });

  it('blokuje publikację przy choć jednym ostrzeżeniu hard', () => {
    const stan = sgNowyGrafik();
    const ostrzezenia = [{ sev: 'hard', rule: 'W1', pracownikId: 'p1', data: '2026-11-05', komunikat: 'x' }];
    const wynik = sgOpublikuj(stan, ostrzezenia, 'admin');
    expect(wynik.ok).toBe(false);
    expect(wynik.powod).toMatch(/^SG2/);
  });

  it('blokuje publikację przy ostrzeżeniach soft bez potwierdzenia "mimo ostrzeżeń"', () => {
    const stan = sgNowyGrafik();
    const ostrzezenia = [{ sev: 'soft', rule: 'W5', pracownikId: 'p1', data: '2026-11-01', komunikat: 'x' }];
    const wynik = sgOpublikuj(stan, ostrzezenia, 'admin');
    expect(wynik.ok).toBe(false);
    expect(wynik.powod).toMatch(/^SG3/);
  });

  it('pozwala publikować z ostrzeżeniami soft, gdy mimoOstrzezen=true', () => {
    const stan = sgNowyGrafik();
    const ostrzezenia = [{ sev: 'soft', rule: 'W5', pracownikId: 'p1', data: '2026-11-01', komunikat: 'x' }];
    const wynik = sgOpublikuj(stan, ostrzezenia, 'admin', { mimoOstrzezen: true });
    expect(wynik.ok).toBe(true);
    expect(wynik.stan.historia[0].ostrzezeniaMiekkiePominiete).toBe(1);
  });

  it('hard ma pierwszeństwo nad mimoOstrzezen (nie da się obejść twardej blokady)', () => {
    const stan = sgNowyGrafik();
    const ostrzezenia = [{ sev: 'hard', rule: 'W1', pracownikId: 'p1', data: '2026-11-05', komunikat: 'x' }];
    const wynik = sgOpublikuj(stan, ostrzezenia, 'admin', { mimoOstrzezen: true });
    expect(wynik.ok).toBe(false);
    expect(wynik.powod).toMatch(/^SG2/);
  });
});

describe('sgWznowEdycje', () => {
  it('wraca do statusu roboczego bez cofania wersji i loguje zdarzenie', () => {
    const stan = sgNowyGrafik();
    const opublikowany = sgOpublikuj(stan, [], 'admin').stan;
    const wznowiony = sgWznowEdycje(opublikowany, 'admin', 'znaleziono błąd po publikacji');
    expect(wznowiony.status).toBe('roboczy');
    expect(wznowiony.wersja).toBe(2); // wersja NIE cofnięta
    expect(wznowiony.historia[wznowiony.historia.length - 1].akcja).toBe('wznowienie_edycji');
    expect(wznowiony.historia[wznowiony.historia.length - 1].kontekst).toBe('znaleziono błąd po publikacji');
  });

  it('po wznowieniu edycja znów jest możliwa', () => {
    const stan = sgNowyGrafik();
    const opublikowany = sgOpublikuj(stan, [], 'admin').stan;
    const wznowiony = sgWznowEdycje(opublikowany, 'admin');
    expect(() => sgZapiszZmiane(wznowiony, { pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'D' }, 'admin')).not.toThrow();
  });
});

describe('sgHistoriaKomorki', () => {
  it('zwraca chronologicznie tylko zmiany JEDNEJ komórki, nie całej historii', () => {
    let stan = sgNowyGrafik();
    stan = sgZapiszZmiane(stan, { pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'D' }, 'admin');
    stan = sgZapiszZmiane(stan, { pracownikId: 'p2', data: '2026-11-05', slot: 1, kod: 'N' }, 'admin'); // inna osoba, ma nie wejść
    stan = sgZapiszZmiane(stan, { pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'N' }, 'admin');
    const historia = sgHistoriaKomorki(stan, 'p1', '2026-11-05', 1);
    expect(historia).toHaveLength(2);
    expect(historia[0].nowaWartosc).toBe('D');
    expect(historia[1].nowaWartosc).toBe('N');
  });
});

describe('sgMoznaEdytowac', () => {
  it('true dla roboczego, false dla opublikowanego', () => {
    const stan = sgNowyGrafik();
    expect(sgMoznaEdytowac(stan)).toBe(true);
    const opublikowany = sgOpublikuj(stan, [], 'admin').stan;
    expect(sgMoznaEdytowac(opublikowany)).toBe(false);
  });
});
