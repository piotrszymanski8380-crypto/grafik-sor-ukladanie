import { describe, it, expect } from 'vitest';
import { normalizujNazwisko, podobienstwo, zbudujMapowanieId, znajdzMozliweDuplikaty, zrodlaWystapien } from './migracjaId.js';

describe('normalizujNazwisko (zgodne z wnNormName z js/wnioski.js)', () => {
  it('usuwa polskie znaki diakrytyczne i sprowadza do małych liter', () => {
    expect(normalizujNazwisko('Zielińska Katarzyna')).toBe('zielinska katarzyna');
    expect(normalizujNazwisko('Dąbrowska Ewa')).toBe('dabrowska ewa');
  });
  it('porządkuje wielokrotne spacje', () => {
    expect(normalizujNazwisko('Kowalski   Jan')).toBe('kowalski jan');
  });
  it('NIE usuwa przecinków/kropek (tak jak wnNormName - inaczej niż wcześniejsza wersja tego modułu)', () => {
    expect(normalizujNazwisko('Kowalski, Jan')).toBe('kowalski, jan');
  });
  it('puste/undefined daje pusty string, nie wywala błędu', () => {
    expect(normalizujNazwisko('')).toBe('');
    expect(normalizujNazwisko(undefined)).toBe('');
    expect(normalizujNazwisko(null)).toBe('');
  });
});

describe('podobienstwo', () => {
  it('zwraca 1 dla identycznych po normalizacji', () => {
    expect(podobienstwo('Kowalczyk Marta', 'kowalczyk marta')).toBe(1);
  });
  it('zwraca 1 dla zamienionej kolejności imię/nazwisko', () => {
    expect(podobienstwo('Kowalczyk Marta', 'Marta Kowalczyk')).toBe(1);
  });
  it('zwraca wysokie podobieństwo dla literówki', () => {
    expect(podobienstwo('Kowalczyk Marta', 'Kowalczyk Marte')).toBeGreaterThan(0.85);
  });
  it('zwraca niskie podobieństwo dla różnych osób', () => {
    expect(podobienstwo('Kowalczyk Marta', 'Nowak Piotr')).toBeLessThan(0.5);
  });
});

describe('zbudujMapowanieId', () => {
  it('przydziela kolejne ID w kolejności pierwszego wystąpienia', () => {
    const wynik = zbudujMapowanieId(['Kowalczyk Marta', 'Nowak Piotr', 'Zielińska Anna'], 'p');
    expect(wynik.map(w => w.id)).toEqual(['p01', 'p02', 'p03']);
  });
  it('to samo ID dla powtórzeń identycznych po normalizacji (w tym zamiana kolejności)', () => {
    const wynik = zbudujMapowanieId(['Kowalczyk Marta', 'kowalczyk marta', 'Marta Kowalczyk', 'Nowak Piotr']);
    expect(wynik[0].id).toBe(wynik[1].id);
    expect(wynik[0].id).toBe(wynik[2].id);
    expect(wynik[3].id).not.toBe(wynik[0].id);
  });
  it('respektuje prefiks (np. "o" dla grupy opiekunów - zgodnie z konwencją id w prototypie)', () => {
    const wynik = zbudujMapowanieId(['Wróbel Teresa'], 'o');
    expect(wynik[0].id).toBe('o01');
  });
  it('domyślny prefiks to "p"', () => {
    const wynik = zbudujMapowanieId(['Kowalczyk Marta']);
    expect(wynik[0].id).toBe('p01');
  });
});

describe('znajdzMozliweDuplikaty', () => {
  it('wykrywa parę z literówką jako podejrzenie duplikatu', () => {
    const pary = znajdzMozliweDuplikaty(['Kowalczyk Marta', 'Kowalczyk Marte', 'Nowak Piotr']);
    expect(pary).toHaveLength(1);
    expect(pary[0]).toMatchObject({ a: 'Kowalczyk Marta', b: 'Kowalczyk Marte' });
  });
  it('NIE zgłasza par identycznych po normalizacji (to jedna osoba, nie duplikat do decyzji)', () => {
    const pary = znajdzMozliweDuplikaty(['Kowalczyk Marta', 'kowalczyk marta']);
    expect(pary).toHaveLength(0);
  });
  it('nie zgłasza wyraźnie różnych osób', () => {
    const pary = znajdzMozliweDuplikaty(['Kowalczyk Marta', 'Nowak Piotr', 'Zielińska Anna']);
    expect(pary).toHaveLength(0);
  });
  it('sortuje malejąco po podobieństwie', () => {
    const pary = znajdzMozliweDuplikaty(['Kowalczyk Marta', 'Kowalczyk Marte', 'Kowalczyk Mart']);
    for (let i = 1; i < pary.length; i++) {
      expect(pary[i - 1].podobienstwo).toBeGreaterThanOrEqual(pary[i].podobienstwo);
    }
  });
});

describe('zrodlaWystapien', () => {
  it('grupuje moduły, w których pojawia się dana osoba', () => {
    const mapa = zrodlaWystapien({
      grafik: ['Kowalczyk Marta', 'Nowak Piotr'],
      wnioski: ['Kowalczyk Marta'],
      urlopy: ['Marta Kowalczyk'], // inna kolejność, ta sama osoba
    });
    const klucz = Object.keys(mapa).find(k => k.includes('kowalczyk'));
    expect(mapa[klucz].sort()).toEqual(['grafik', 'urlopy', 'wnioski']);
  });
  it('osoba widoczna tylko w jednym module jest łatwa do wychwycenia', () => {
    const mapa = zrodlaWystapien({ grafik: ['Kowalczyk Marta'], zamiany: ['Ktoś Jednorazowy'] });
    const klucz = Object.keys(mapa).find(k => k.includes('jednorazowy'));
    expect(mapa[klucz]).toHaveLength(1);
  });
});
