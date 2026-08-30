// domain/polautomat.js
//
// Silnik półautomatu F2.1-F2.3 (specyfikacja sekcja 5): automatyczne nanoszenie
// zatwierdzonych urlopów i wniosków oraz aktualizacja grafiku po zatwierdzonej
// zamianie. Wzorowane na funkcji `nanies` z prototypu: działa na KOPII wpisów,
// każdą pozycję sprawdza blokada(), jeden zwrot na końcu. Nic nie nanosi wbrew
// regule twardej - "grafik nie został nimi zepsuty".
//
// Kształty wejściowe POTWIERDZONE czytaniem prawdziwego kodu repo (nie zgadywane
// z prototypu - prototyp mylił się co do znaczenia kodów DW/NW, patrz niżej):
//   - wniosek grafikowy: kody z js/wnioski.js (WNIOSEK_KODY) - D/N/DOBA to CHĘĆ
//     danego dyżuru, DND to "D lub N lub Doba" (do rozstrzygnięcia), W/DW/NW to
//     WOLNE (DW = "dzień wolny", NW = "noc wolna" - odwrotnie niż zakładał
//     prototyp specyfikacji! DW/NW NIE oznaczają "chcę D"/"chcę N", tylko
//     "chcę mieć wolne od dniówki/nocki"), UW, S, INNY (kod dowolny, ręcznie).
//   - zamiana: to wniosek z polem typ:'zamiana' (NIE osobny moduł, wbrew
//     wcześniejszym założeniom) - patrz js/wnioski.js (renderZamianaTab,
//     btnZmSend): { id, typ:'zamiana', pracownik, grupa, kolega, kolegaGrupa,
//     wlasnaData, wlasnyDyzur, docelowaData, docelowyDyzur, status }. Status
//     końcowy po pełnej akceptacji: 'zaakceptowana' (patrz js/admin.js,
//     setZamianaStatus(z, 'zaakceptowana', 'decyzja_admina')). To WYMIANA DWÓCH
//     dyżurów (pracownik oddaje wlasnaData/wlasnyDyzur, w zamian bierze
//     docelowaData/docelowyDyzur po stronie kolegi) - NIE jednostronne oddanie.
//
// Zależność od domain/grafik.js: funkcje `blokada`/`zbudujIndeks`/`dodajDni` są
// przekazywane jako argument `silnik` (wstrzykiwanie zależności), NIE ładowane
// przez require()/import. Powód: w przeglądarce ten plik jest zwykłym <script>
// bez ESM, a próba dociągnięcia sąsiedniego domain/*.js przez require() wewnątrz
// pliku okazała się zawodna pod Vitest/Vite (sprawdzone empirycznie - require()
// jednego pliku domain/*.js z drugiego zwraca pusty obiekt, mimo że dokładnie ten
// sam plik poprawnie eksportuje przez `import` w pliku testowym). Wywołanie w
// przeglądarce (gdzie grafik.js jest wczytany wcześniej jako <script> i jego
// funkcje są już globalami) może pominąć argument `silnik` - patrz domyślna
// wartość niżej, która sama sięga po globale.
function paSilnikDomyslny() {
  if (typeof blokada !== 'undefined') {
    return { blokada: blokada, zbudujIndeks: zbudujIndeks, dodajDni: dodajDni };
  }
  return null; // w Node/Vitest trzeba podać `silnik` jawnie (patrz testy)
}

// DW/NW to proste prośby o WOLNE (nie o dyżur - patrz nagłówek pliku). DND jest
// niejednoznaczne (D/N/DOBA) i zawsze trafia do rozstrzygnięcia człowieka. INNY
// to dowolny kod spoza słownika - też wymaga ręcznej decyzji (nie wiadomo, co
// właściwie oznacza bez przeczytania treści wniosku).
const PA_MAPA_KODOW_WNIOSKOWYCH = { D: 'D', N: 'N', DOBA: 'DOBA', W: 'W', DW: 'W', NW: 'W', UW: 'UW', S: 'S' };
const PA_KODY_WYMAGAJACE_ROZSTRZYGNIECIA = ['DND', 'INNY'];

function paKodDnia(indeks, pracownikId, data) {
  var kody = (indeks[pracownikId] && indeks[pracownikId][data]) || [];
  for (var i = 0; i < kody.length; i++) {
    if (kody[i] && kody[i] !== 'W') return kody[i];
  }
  return null;
}

/**
 * F2.1 - naniesUrlopy(wpisy, zatwierdzoneUrlopy, pracownicy, silnik, parametry)
 * zatwierdzonyUrlop: { pracownikId, dataOd: 'YYYY-MM-DD', dataDo: 'YYYY-MM-DD' }
 * Wpisuje UW na cały zakres. Nie nadpisuje cichcem komórki z innym sensownym
 * wpisem - takie przypadki lądują w raporcie do ręcznej decyzji układającego.
 */
function naniesUrlopy(wpisy, zatwierdzoneUrlopy, pracownicy, silnik, parametry) {
  silnik = silnik || paSilnikDomyslny();
  var kopia = wpisy.slice();
  var indeks = silnik.zbudujIndeks(kopia);
  var raport = { wpisane: [], pominiete: [] };

  zatwierdzoneUrlopy.forEach(function (urlop) {
    var pracownik = pracownicy.filter(function (p) { return p.id === urlop.pracownikId; })[0];
    if (!pracownik) {
      raport.pominiete.push({ pracownikId: urlop.pracownikId, powod: 'nieznany pracownik (brak ID - sprawdzić Krok 0)' });
      return;
    }
    var data = urlop.dataOd;
    while (data <= urlop.dataDo) {
      var istniejacy = paKodDnia(indeks, pracownik.id, data);
      if (istniejacy && istniejacy !== 'UW') {
        raport.pominiete.push({ pracownikId: pracownik.id, data: data, powod: 'zajęte kodem ' + istniejacy });
      } else if (!istniejacy) {
        kopia.push({ pracownikId: pracownik.id, data: data, slot: 1, kod: 'UW', notatka: 'urlop zatwierdzony' });
        indeks[pracownik.id] = indeks[pracownik.id] || {};
        indeks[pracownik.id][data] = ['UW'];
        raport.wpisane.push({ pracownikId: pracownik.id, data: data, kod: 'UW' });
      }
      // istniejacy === 'UW': już naniesione, pomijamy bez zgłaszania
      data = silnik.dodajDni(data, 1);
    }
  });
  return { wpisy: kopia, raport: raport };
}

/**
 * F2.2 - naniesWnioski(wpisy, wnioski, pracownicy, silnik, parametry)
 * wniosek: { id, pracownikId, dni: ['YYYY-MM-DD', ...], kod, status }
 * Tylko `status === 'zaakceptowana'` (patrz js/wnioski.js: wnStatusLabel) jest
 * brany pod uwagę. Zwraca raport: wpisane / pominięte-bo-zajęte (z kodem
 * zajmującym) / odrzucone-przez-reguły (z powodem, NIE wpisywane) /
 * doRozstrzygniecia (DND, INNY - decyzja człowieka).
 */
function naniesWnioski(wpisy, wnioski, pracownicy, silnik, parametry) {
  silnik = silnik || paSilnikDomyslny();
  var kopia = wpisy.slice();
  var indeks = silnik.zbudujIndeks(kopia);
  var raport = { wpisane: [], pominiete: [], odrzucone: [], doRozstrzygniecia: [] };

  wnioski.filter(function (w) { return w.status === 'zaakceptowana'; }).forEach(function (wniosek) {
    var pracownik = pracownicy.filter(function (p) { return p.id === wniosek.pracownikId; })[0];
    if (!pracownik) {
      raport.pominiete.push({ wniosekId: wniosek.id, powod: 'nieznany pracownik' });
      return;
    }
    if (PA_KODY_WYMAGAJACE_ROZSTRZYGNIECIA.indexOf(wniosek.kod) !== -1) {
      raport.doRozstrzygniecia.push({
        wniosekId: wniosek.id, pracownikId: pracownik.id, dni: wniosek.dni,
        powod: wniosek.kod === 'DND'
          ? 'DND - wybierz D/N/DOBA wg braków obsady (F2.4 podpowie kandydatów).'
          : 'INNY - kod niestandardowy, sprawdzić treść wniosku i wpisać ręcznie.',
      });
      return;
    }
    var kodDocelowy = PA_MAPA_KODOW_WNIOSKOWYCH[wniosek.kod] || wniosek.kod;
    (wniosek.dni || []).forEach(function (data) {
      var istniejacy = paKodDnia(indeks, pracownik.id, data);
      if (istniejacy) {
        raport.pominiete.push({ wniosekId: wniosek.id, pracownikId: pracownik.id, data: data, powod: 'zajęte kodem ' + istniejacy });
        return;
      }
      var powodBlokady = silnik.blokada(pracownik, data, kodDocelowy, kopia, parametry);
      if (powodBlokady) {
        raport.odrzucone.push({ wniosekId: wniosek.id, pracownikId: pracownik.id, data: data, powod: powodBlokady });
        return;
      }
      kopia.push({ pracownikId: pracownik.id, data: data, slot: 1, kod: kodDocelowy, notatka: 'wniosek ' + wniosek.id });
      indeks[pracownik.id] = indeks[pracownik.id] || {};
      indeks[pracownik.id][data] = [kodDocelowy];
      raport.wpisane.push({ wniosekId: wniosek.id, pracownikId: pracownik.id, data: data, kod: kodDocelowy });
    });
  });
  return { wpisy: kopia, raport: raport };
}

/**
 * F2.3 - naniesZamiane(wpisy, zamiana, pracownicy, silnik, parametry)
 * zamiana (wniosek typ:'zamiana', status:'zaakceptowana'):
 *   { pracownikId, kolegaId, wlasnaData, wlasnyDyzur, docelowaData, docelowyDyzur }
 * (pracownikId/kolegaId - ID po dopasowaniu z pól pracownik/kolega, patrz Krok 0).
 * To WYMIANA dwóch dyżurów: pracownik oddaje swój dyżur (wlasnaData/wlasnyDyzur)
 * i przejmuje dyżur kolegi (docelowaData/docelowyDyzur) - obie strony sprawdzane
 * osobno przez blokada(). Zwraca status: 'wykonana' | 'odrzucona' | 'blad'.
 */
function naniesZamiane(wpisy, zamiana, pracownicy, silnik, parametry) {
  silnik = silnik || paSilnikDomyslny();
  var kopia = wpisy.slice();
  var pracownik = pracownicy.filter(function (p) { return p.id === zamiana.pracownikId; })[0];
  var kolega = pracownicy.filter(function (p) { return p.id === zamiana.kolegaId; })[0];
  if (!pracownik || !kolega) {
    return { wpisy: kopia, status: 'blad', powod: 'nieznany pracownik (inicjator lub kolega)' };
  }

  // Krok 1: pracownik przejmuje dyżur kolegi (docelowaData/docelowyDyzur)
  var powodA = silnik.blokada(pracownik, zamiana.docelowaData, zamiana.docelowyDyzur, kopia, parametry);
  if (powodA) return { wpisy: kopia, status: 'odrzucona', powod: 'Strona 1 (przejęcie): ' + powodA };

  // Krok 2: kolega przejmuje dyżur pracownika (wlasnaData/wlasnyDyzur) - sprawdzane
  // na kopii już zawierającej hipotetyczny wynik kroku 1 (żeby wyłapać np. konflikt W2)
  var kopiaPoKroku1 = kopia.concat([{ pracownikId: pracownik.id, data: zamiana.docelowaData, slot: 1, kod: zamiana.docelowyDyzur }]);
  var powodB = silnik.blokada(kolega, zamiana.wlasnaData, zamiana.wlasnyDyzur, kopiaPoKroku1, parametry);
  if (powodB) return { wpisy: kopia, status: 'odrzucona', powod: 'Strona 2 (oddanie): ' + powodB };

  var wynik = kopia
    .concat([{ pracownikId: pracownik.id, data: zamiana.wlasnaData, slot: 1, kod: 'W', notatka: 'oddane w zamianie ' + (zamiana.id || '') }])
    .concat([{ pracownikId: kolega.id, data: zamiana.wlasnaData, slot: 1, kod: zamiana.wlasnyDyzur, notatka: 'przejęte w zamianie ' + (zamiana.id || '') }])
    .concat([{ pracownikId: kolega.id, data: zamiana.docelowaData, slot: 1, kod: 'W', notatka: 'oddane w zamianie ' + (zamiana.id || '') }])
    .concat([{ pracownikId: pracownik.id, data: zamiana.docelowaData, slot: 1, kod: zamiana.docelowyDyzur, notatka: 'przejęte w zamianie ' + (zamiana.id || '') }]);

  var wpisHistorii = {
    kto: 'system (łańcuch zgód)',
    komorka: pracownik.id + ' ⇄ ' + kolega.id + ' · ' + zamiana.wlasnaData + '/' + zamiana.docelowaData,
    zmiana: pracownik.id + ': ' + zamiana.wlasnyDyzur + '@' + zamiana.wlasnaData + ' → ' + zamiana.docelowyDyzur + '@' + zamiana.docelowaData + ' (i odwrotnie dla ' + kolega.id + ')',
    ctx: 'zamiana',
  };

  return { wpisy: wynik, status: 'wykonana', historiaWpis: wpisHistorii };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PA_MAPA_KODOW_WNIOSKOWYCH: PA_MAPA_KODOW_WNIOSKOWYCH,
    naniesUrlopy: naniesUrlopy,
    naniesWnioski: naniesWnioski,
    naniesZamiane: naniesZamiane,
  };
}
