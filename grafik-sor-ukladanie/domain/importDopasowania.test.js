import { describe, it, expect } from 'vitest';
import { podobienstwo, zbudujMapowanieId } from './migracjaId.js';
import { idDopasujNazwisko, idDopasujListe, idZatwierdzDecyzje } from './importDopasowania.js';

// Wstrzykiwane jawnie w testach (patrz komentarz w importDopasowania.js - w
// przeglądarce dzieje się to automatycznie przez globale z migracjaId.js).
const silnik = { podobienstwo };

// Kanoniczna lista (jak EMPLOYEES w js/rdzen.js) przepuszczona przez Krok 0.
const kanoniczni = ['Kowalska Anna', 'Nowak Piotr', 'Wiśniewski Jan'];
const mapowanie = zbudujMapowanieId(kanoniczni, 'p'); // [{nazwisko, nazwiskoZnormalizowane, id: p01/p02/p03}]

describe('idDopasujNazwisko', () => {
  it('dokładne dopasowanie (identyczne po normalizacji) -> wynik "dokladne", bez potrzeby decyzji', () => {
    const d = idDopasujNazwisko('kowalska  anna', mapowanie, undefined, silnik); // inna wielkość liter/spacje
    expect(d.wynik).toBe('dokladne');
    expect(d.id).toBe(mapowanie[0].id);
  });

  it('literówka -> wynik "kandydaci" z podobną osobą, nie auto-dopasowane', () => {
    const d = idDopasujNazwisko('Nowak Piptr', mapowanie, undefined, silnik); // literówka: Piotr -> Piptr
    expect(d.wynik).toBe('kandydaci');
    expect(d.kandydaci.some(k => k.id === mapowanie[1].id)).toBe(true);
  });

  it('zupełnie inne nazwisko -> wynik "brak" (brak podobnych kandydatów)', () => {
    const d = idDopasujNazwisko('Zieliński Tomasz', mapowanie, undefined, silnik);
    expect(d.wynik).toBe('brak');
  });

  it('próg podobieństwa jest konfigurowalny', () => {
    // Podobieństwo "Nowak Piotr" vs "Nowak Piotrek" powinno być wysokie, ale
    // przy bardzo wysokim progu (0.99) może nie przejść - test dokumentuje
    // parametr, nie konkretną wartość progu.
    const dNiski = idDopasujNazwisko('Nowak Piotrek', mapowanie, 0.5, silnik);
    expect(dNiski.wynik).not.toBe('brak');
    const dWysoki = idDopasujNazwisko('Zieliński Tomasz', mapowanie, 0.99, silnik);
    expect(dWysoki.wynik).toBe('brak');
  });
});

describe('idDopasujListe', () => {
  it('dopasowuje listę i liczy podsumowanie per kategoria', () => {
    const { dopasowania, podsumowanie } = idDopasujListe(
      ['Kowalska Anna', 'Nowak Piptr', 'Zieliński Tomasz'],
      mapowanie, undefined, silnik,
    );
    expect(dopasowania).toHaveLength(3);
    expect(podsumowanie.dokladne).toBe(1);
    expect(podsumowanie.kandydaci).toBe(1);
    expect(podsumowanie.brak).toBe(1);
  });
});

describe('idZatwierdzDecyzje', () => {
  it('dokładne trafiają do przypisań automatycznie, bez decyzji', () => {
    const { dopasowania } = idDopasujListe(['Kowalska Anna'], mapowanie, undefined, silnik);
    const wynik = idZatwierdzDecyzje(dopasowania, {});
    expect(wynik.przypisania['Kowalska Anna']).toBe(mapowanie[0].id);
    expect(wynik.brakDecyzji).toHaveLength(0);
  });

  it('decyzja "istniejacy" przypisuje wybrane ID kandydata, nie tworzy nowego', () => {
    const { dopasowania } = idDopasujListe(['Nowak Piptr'], mapowanie, undefined, silnik);
    const wynik = idZatwierdzDecyzje(dopasowania, { 'Nowak Piptr': { typ: 'istniejacy', id: mapowanie[1].id } });
    expect(wynik.przypisania['Nowak Piptr']).toBe(mapowanie[1].id);
    expect(wynik.mapowanieDopisane).toHaveLength(0);
  });

  it('decyzja "nowy" przydziela nowe ID i dopisuje do mapowania', () => {
    const { dopasowania } = idDopasujListe(['Zieliński Tomasz'], mapowanie, undefined, silnik);
    const wynik = idZatwierdzDecyzje(dopasowania, { 'Zieliński Tomasz': { typ: 'nowy' } }, 'p', 3);
    expect(wynik.mapowanieDopisane).toEqual([{ nazwisko: 'Zieliński Tomasz', id: 'p04' }]);
    expect(wynik.przypisania['Zieliński Tomasz']).toBe('p04');
  });

  it('brak decyzji dla pozycji "kandydaci"/"brak" -> wpada do brakDecyzji, ekran musi wymusić decyzję', () => {
    const { dopasowania } = idDopasujListe(['Nowak Piptr', 'Zieliński Tomasz'], mapowanie, undefined, silnik);
    const wynik = idZatwierdzDecyzje(dopasowania, {});
    expect(wynik.brakDecyzji.sort()).toEqual(['Nowak Piptr', 'Zieliński Tomasz'].sort());
    expect(Object.keys(wynik.przypisania)).toHaveLength(0);
  });

  it('kolejne wywołania "nowy" w tej samej partii dostają kolejne numery ID', () => {
    const { dopasowania } = idDopasujListe(['Zieliński Tomasz', 'Abacki Adam'], mapowanie, undefined, silnik);
    const wynik = idZatwierdzDecyzje(dopasowania, {
      'Zieliński Tomasz': { typ: 'nowy' },
      'Abacki Adam': { typ: 'nowy' },
    }, 'p', 3);
    expect(wynik.przypisania['Zieliński Tomasz']).toBe('p04');
    expect(wynik.przypisania['Abacki Adam']).toBe('p05');
  });
});
