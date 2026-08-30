import { describe, it, expect } from 'vitest';
import { blokada, zbudujIndeks, dodajDni } from './grafik.js';
import { naniesUrlopy, naniesWnioski, naniesZamiane } from './polautomat.js';

// Wstrzykiwane jawnie w testach (patrz komentarz w polautomat.js - w przeglądarce
// to samo dzieje się automatycznie przez globale zdefiniowane w grafik.js).
const silnik = { blokada, zbudujIndeks, dodajDni };

const pEtat = { id: 'p1', forma: 'etat', etat: 1, grupa: 'main' };
const pEtat2 = { id: 'p2', forma: 'etat', etat: 1, grupa: 'main' };
const pFlaga = { id: 'p3', forma: 'etat', etat: 1, grupa: 'main', flagi: ['bez_nocek'] };
const pracownicy = [pEtat, pEtat2, pFlaga];

describe('F2.1 — naniesUrlopy', () => {
  it('wpisuje UW na cały zakres urlopu', () => {
    const { wpisy, raport } = naniesUrlopy([], [{ pracownikId: 'p1', dataOd: '2026-11-05', dataDo: '2026-11-07' }], pracownicy, silnik);
    expect(wpisy).toHaveLength(3);
    expect(wpisy.every(w => w.kod === 'UW')).toBe(true);
    expect(raport.wpisane).toHaveLength(3);
  });

  it('pomija dzień zajęty innym kodem i zgłasza w raporcie', () => {
    const istniejace = [{ pracownikId: 'p1', data: '2026-11-06', slot: 1, kod: 'D' }];
    const { wpisy, raport } = naniesUrlopy(istniejace, [{ pracownikId: 'p1', dataOd: '2026-11-05', dataDo: '2026-11-06' }], pracownicy, silnik);
    expect(wpisy.find(w => w.data === '2026-11-06').kod).toBe('D'); // nie nadpisane
    expect(raport.pominiete[0].powod).toMatch(/zajęte kodem D/);
    expect(raport.wpisane).toHaveLength(1); // tylko 05
  });

  it('nie duplikuje, gdy UW już jest naniesione', () => {
    const istniejace = [{ pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'UW' }];
    const { wpisy, raport } = naniesUrlopy(istniejace, [{ pracownikId: 'p1', dataOd: '2026-11-05', dataDo: '2026-11-05' }], pracownicy, silnik);
    expect(wpisy).toHaveLength(1);
    expect(raport.wpisane).toHaveLength(0);
    expect(raport.pominiete).toHaveLength(0);
  });

  it('zgłasza nieznanego pracownika', () => {
    const { raport } = naniesUrlopy([], [{ pracownikId: 'brak', dataOd: '2026-11-05', dataDo: '2026-11-05' }], pracownicy, silnik);
    expect(raport.pominiete[0].powod).toMatch(/nieznany pracownik/);
  });
});

describe('F2.2 — naniesWnioski', () => {
  it('D/N/DOBA to chęć dyżuru — wpisywane wprost', () => {
    const wnioski = [
      { id: 'w1', pracownikId: 'p1', dni: ['2026-11-05'], kod: 'D', status: 'zaakceptowana' },
      { id: 'w2', pracownikId: 'p2', dni: ['2026-11-05'], kod: 'N', status: 'zaakceptowana' },
    ];
    const { wpisy, raport } = naniesWnioski([], wnioski, pracownicy, silnik);
    expect(wpisy.find(w => w.pracownikId === 'p1').kod).toBe('D');
    expect(wpisy.find(w => w.pracownikId === 'p2').kod).toBe('N');
    expect(raport.wpisane).toHaveLength(2);
  });

  it('DW/NW to WOLNE (nie dyżur!) — wpisywane jako W', () => {
    const wnioski = [
      { id: 'w1', pracownikId: 'p1', dni: ['2026-11-05'], kod: 'DW', status: 'zaakceptowana' },
      { id: 'w2', pracownikId: 'p2', dni: ['2026-11-05'], kod: 'NW', status: 'zaakceptowana' },
    ];
    const { wpisy } = naniesWnioski([], wnioski, pracownicy, silnik);
    expect(wpisy.find(w => w.pracownikId === 'p1').kod).toBe('W');
    expect(wpisy.find(w => w.pracownikId === 'p2').kod).toBe('W');
  });

  it('ignoruje wnioski o statusie innym niż zaakceptowana (patrz wnStatusLabel w js/wnioski.js)', () => {
    const wnioski = [{ id: 'w1', pracownikId: 'p1', dni: ['2026-11-05'], kod: 'D', status: 'zgloszona' }];
    const { wpisy, raport } = naniesWnioski([], wnioski, pracownicy, silnik);
    expect(wpisy).toHaveLength(0);
    expect(raport.wpisane).toHaveLength(0);
  });

  it('DND trafia do doRozstrzygniecia, nie jest wpisywane', () => {
    const wnioski = [{ id: 'w1', pracownikId: 'p1', dni: ['2026-11-05'], kod: 'DND', status: 'zaakceptowana' }];
    const { wpisy, raport } = naniesWnioski([], wnioski, pracownicy, silnik);
    expect(wpisy).toHaveLength(0);
    expect(raport.doRozstrzygniecia).toHaveLength(1);
    expect(raport.doRozstrzygniecia[0].wniosekId).toBe('w1');
  });

  it('INNY też trafia do doRozstrzygniecia', () => {
    const wnioski = [{ id: 'w1', pracownikId: 'p1', dni: ['2026-11-05'], kod: 'INNY', status: 'zaakceptowana' }];
    const { raport } = naniesWnioski([], wnioski, pracownicy, silnik);
    expect(raport.doRozstrzygniecia).toHaveLength(1);
  });

  it('odrzuca wniosek łamiący regułę twardą (W12: N dla osoby bez nocek) z powodem, bez wpisania', () => {
    const wnioski = [{ id: 'w1', pracownikId: 'p3', dni: ['2026-11-05'], kod: 'N', status: 'zaakceptowana' }];
    const { wpisy, raport } = naniesWnioski([], wnioski, pracownicy, silnik);
    expect(wpisy).toHaveLength(0);
    expect(raport.odrzucone[0].powod).toMatch(/^W12/);
  });

  it('pomija dzień już zajęty i podaje zajmujący kod', () => {
    const istniejace = [{ pracownikId: 'p1', data: '2026-11-05', slot: 1, kod: 'CH' }];
    const wnioski = [{ id: 'w1', pracownikId: 'p1', dni: ['2026-11-05'], kod: 'D', status: 'zaakceptowana' }];
    const { raport } = naniesWnioski(istniejace, wnioski, pracownicy, silnik);
    expect(raport.pominiete[0].powod).toMatch(/zajęte kodem CH/);
  });
});

describe('F2.3 — naniesZamiane (wymiana dwóch dyżurów)', () => {
  it('obie strony przejmują dyżur drugiej osoby, wpis historii z systemowym kto', () => {
    const zamiana = {
      id: 'z1', pracownikId: 'p1', kolegaId: 'p2',
      wlasnaData: '2026-11-05', wlasnyDyzur: 'D',
      docelowaData: '2026-11-10', docelowyDyzur: 'N',
    };
    const wynik = naniesZamiane([], zamiana, pracownicy, silnik);
    expect(wynik.status).toBe('wykonana');
    // p1 oddaje 05 (D), przejmuje 10 (N)
    expect(wynik.wpisy.find(w => w.pracownikId === 'p1' && w.data === '2026-11-05').kod).toBe('W');
    expect(wynik.wpisy.find(w => w.pracownikId === 'p1' && w.data === '2026-11-10').kod).toBe('N');
    // p2 oddaje 10 (N), przejmuje 05 (D)
    expect(wynik.wpisy.find(w => w.pracownikId === 'p2' && w.data === '2026-11-10').kod).toBe('W');
    expect(wynik.wpisy.find(w => w.pracownikId === 'p2' && w.data === '2026-11-05').kod).toBe('D');
    expect(wynik.historiaWpis.kto).toBe('system (łańcuch zgód)');
  });

  it('odrzuca zamianę, gdy przejęcie łamie regułę twardą (W12)', () => {
    const zamiana = {
      id: 'z1', pracownikId: 'p3', kolegaId: 'p2', // p3 ma flagę bez_nocek
      wlasnaData: '2026-11-05', wlasnyDyzur: 'D',
      docelowaData: '2026-11-10', docelowyDyzur: 'N', // p3 przejmuje nockę -> W12
    };
    const wynik = naniesZamiane([], zamiana, pracownicy, silnik);
    expect(wynik.status).toBe('odrzucona');
    expect(wynik.powod).toMatch(/^Strona 1.*W12/);
  });

  it('zwraca błąd dla nieznanego pracownika', () => {
    const zamiana = { id: 'z1', pracownikId: 'p1', kolegaId: 'brak', wlasnaData: '2026-11-05', wlasnyDyzur: 'D', docelowaData: '2026-11-10', docelowyDyzur: 'N' };
    const wynik = naniesZamiane([], zamiana, pracownicy, silnik);
    expect(wynik.status).toBe('blad');
  });

  it('grafik pozostaje nietknięty przy odrzuceniu (oryginalna tablica wpisy niemutowana)', () => {
    const wpisy = [{ pracownikId: 'p3', data: '2026-11-01', slot: 1, kod: 'W' }];
    const zamiana = { id: 'z1', pracownikId: 'p3', kolegaId: 'p2', wlasnaData: '2026-11-05', wlasnyDyzur: 'D', docelowaData: '2026-11-10', docelowyDyzur: 'N' };
    naniesZamiane(wpisy, zamiana, pracownicy, silnik);
    expect(wpisy).toHaveLength(1); // niezmieniona
  });
});
