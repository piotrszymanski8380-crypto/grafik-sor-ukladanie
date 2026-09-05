// public/admin.js — panel administratora v2 (boczna nawigacja, kolorowa
// siatka grafiku z edycją jednym kliknięciem). Logika API/danych w dużej
// mierze przeniesiona bez zmian z poprzedniej wersji - zmienia się głównie
// budowanie DOM (nowy układ) i sposób edycji komórek grafiku.
// Kody dopisane 2026-08-30 (SW/Op/Us/Uo/Ub/Um/Nn/Nun/Nup/Zr/Wn/Ws) na podstawie
// wytyczne_grafik_oddzialowa.docx i legendy z arkuszy "maj-czerwiec ... 2026.xlsx" —
// patrz komentarz przy GRF_KODY_WG_STAWKI_OSOBY w domain/grafik.js.
const KODY = [
  '', 'D', 'N', 'DOBA', 'W', 'UW', 'CH', 'DCH', 'NCH', 'S',
  'SW', 'Op', 'Us', 'Uo', 'Ub', 'Um', 'Nn', 'Nun', 'Nup', 'Zr', 'Wn', 'Ws', 'OJCO',
];
const ETYKIETY_KODOW = {
  '': '—', D: 'D', N: 'N', DOBA: 'DOBA', W: 'W', UW: 'UW', CH: 'CH', DCH: 'DCH', NCH: 'NCH', S: 'S',
  SW: 'SW', Op: 'Op', Us: 'Us', Uo: 'Uo', Ub: 'Ub', Um: 'Um', Nn: 'Nn', Nun: 'Nun', Nup: 'Nup', Zr: 'Zr', Wn: 'Wn', Ws: 'Ws', OJCO: 'OJCO',
};
// Podpowiedzi (title="...") w pickerze - żeby "Uo"/"Zr" itp. nie były zagadką.
const OPISY_KODOW = {
  D: 'dyżur 12h - dzień', N: 'dyżur 12h - noc', DOBA: 'dyżur 24h (kontrakt/zlecenie)',
  W: 'wolne', UW: 'urlop wypoczynkowy', CH: 'zwolnienie lekarskie',
  DCH: 'dyżur D przerwany chorobowym', NCH: 'dyżur N przerwany chorobowym', S: 'szkolenie obowiązkowe',
  SW: 'siła wyższa (2 dni/16h rok)', Op: 'opieka nad dzieckiem do lat 14 (2 dni/16h rok)',
  Us: 'urlop szkoleniowy', Uo: 'urlop okolicznościowy', Ub: 'urlop bezpłatny', Um: 'urlop macierzyński/rodzicielski',
  Nn: 'nieobecność NIEusprawiedliwiona', Nun: 'nieobecność usprawiedliwiona niepłatna',
  Nup: 'nieobecność usprawiedliwiona płatna', Zr: 'zasiłek rehabilitacyjny',
  Wn: 'odbiór za pracę w niedzielę/święto', Ws: 'odbiór za pracę w sobotę',
  OJCO: 'urlop ojcowski',
};
const NAZWY_MIESIECY = ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'];

let pracownicy = [];
let biezacyGrafik = null; // { stan, ostrzezenia, obsada }
let rok, miesiac;
let aktywnaGrupa = 'main'; // stan współdzielony między widokiem Grafik i Kadra

function dzisiaj() { return new Date(); }

function pokazMsg(id, tekst, klasa) {
  document.getElementById(id).innerHTML = tekst ? '<div class="msg ' + klasa + '">' + tekst + '</div>' : '';
}

// pokazBladStartu(e) — dopisane 2026-08-30 po incydencie "pusta/biała strona panelu
// bez żadnego komunikatu" (np. gdy przeglądarka wczyta z cache starszy admin.html
// razem z nowszym admin.js po deployu, i skrypt rzuci wyjątkiem na elemencie,
// którego jeszcze nie ma w DOM). BEZ TEGO taki wyjątek w wystartuj()/sprawdzSesje()
// kończył się CAŁKOWICIE PUSTYM ekranem (ani login, ani appka) bez żadnej wskazówki -
// wyglądało to jak utrata danych, choć dane na serwerze były cały czas nietknięte.
// Teraz zamiast tego appka pokazuje czerwony baner z treścią błędu, żeby dało się
// go zrelacjonować/zrzucić ekran zamiast zgadywać. Dane pracowników/grafiku same w
// sobie NIE są tu w żaden sposób kasowane - ten kod tylko RYSUJE komunikat.
function pokazBladStartu(e) {
  console.error('Błąd startu appki:', e);
  let baner = document.getElementById('blad-startu-baner');
  if (!baner) {
    baner = document.createElement('div');
    baner.id = 'blad-startu-baner';
    baner.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:9999; background:#c22222; color:#fff; ' +
      'padding:14px 18px; font:13px/1.5 -apple-system,sans-serif; white-space:pre-wrap;';
    document.body.prepend(baner);
  }
  baner.textContent = 'Błąd aplikacji - odśwież stronę (Ctrl+Shift+R / Cmd+Shift+R). ' +
    'Jeśli się powtarza, zrób zrzut ekranu tego komunikatu: ' + (e && e.message ? e.message : String(e));
}
window.addEventListener('error', (ev) => pokazBladStartu(ev.error || ev.message));
window.addEventListener('unhandledrejection', (ev) => pokazBladStartu(ev.reason));

async function api(sciezka, opcje) {
  const res = await fetch(sciezka, Object.assign({ credentials: 'same-origin' }, opcje));
  const dane = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 200) throw Object.assign(new Error(dane.error || ('HTTP ' + res.status)), { dane, status: res.status });
  return dane;
}

// ============================================================================
// LOGOWANIE
// ============================================================================
async function sprawdzSesje() {
  const { isAdmin } = await api('/api/session');
  if (isAdmin) {
    document.getElementById('login-widok').style.display = 'none';
    document.getElementById('app-widok').style.display = 'flex';
    try {
      await wystartuj();
    } catch (e) {
      // Patrz komentarz przy pokazBladStartu() - bez tego try/catch appka po
      // zalogowaniu zostawała PUSTA (żadnego widoku, żadnego komunikatu), jeśli
      // cokolwiek w wystartuj() rzuciło wyjątek.
      pokazBladStartu(e);
    }
  } else {
    document.getElementById('login-widok').style.display = 'flex';
    document.getElementById('app-widok').style.display = 'none';
  }
}

document.getElementById('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const haslo = document.getElementById('login-haslo').value;
  try {
    await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ haslo }) });
    pokazMsg('login-msg', '', '');
    await sprawdzSesje();
  } catch (e) {
    pokazMsg('login-msg', e.dane && e.dane.error ? e.dane.error : 'Błąd logowania.', 'err');
  }
});

document.getElementById('btn-wyloguj').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  await sprawdzSesje();
});

// ============================================================================
// NAWIGACJA (boczny pasek) + przełącznik main/opie (współdzielony)
// ============================================================================
document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const widok = btn.dataset.view;
    document.querySelectorAll('.nav-item[data-view]').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view[data-view-content]').forEach((el) => {
      el.classList.toggle('active', el.dataset.viewContent === widok);
    });
  });
});

function ustawGrupe(grupa) {
  aktywnaGrupa = grupa;
  document.querySelectorAll('.grupa-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.grupa === grupa));
  document.getElementById('grafik-table-main').style.display = grupa === 'main' ? '' : 'none';
  document.getElementById('grafik-table-opie').style.display = grupa === 'opie' ? '' : 'none';
  document.getElementById('tabela-pracownicy-main').style.display = grupa === 'main' ? '' : 'none';
  document.getElementById('tabela-pracownicy-opie').style.display = grupa === 'opie' ? '' : 'none';
}
document.querySelectorAll('.grupa-toggle button').forEach((btn) => {
  btn.addEventListener('click', () => ustawGrupe(btn.dataset.grupa));
});

// ============================================================================
// START — miesiąc domyślnie bieżący, wczytaj kadrę + grafik
// ============================================================================
async function wystartuj() {
  const teraz = dzisiaj();
  rok = teraz.getFullYear();
  miesiac = teraz.getMonth() + 1;
  document.getElementById('pole-rok').value = rok;
  const selMies = document.getElementById('pole-miesiac');
  selMies.innerHTML = NAZWY_MIESIECY.map((n, i) => '<option value="' + (i + 1) + '">' + (i + 1) + ' — ' + n + '</option>').join('');
  selMies.value = miesiac;

  await wczytajPracownikow();
  await wczytajGrafik();
  await wczytajStatusPodgladu();
  await wczytajReguly();
}

// ============================================================================
// BEZPIECZEŃSTWO — zmiana hasła admina i hasła dostępu do podglądu
// ============================================================================
async function wczytajStatusPodgladu() {
  const dane = await api('/api/dostep-podgladu');
  document.getElementById('podglad-status').textContent = dane.wymaganeHaslo ? 'włączone (wymagane hasło)' : 'wyłączone (podgląd otwarty)';
}

document.getElementById('form-haslo-admina').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const obecne = document.getElementById('admin-obecne').value;
  const nowe = document.getElementById('admin-nowe').value;
  const nowe2 = document.getElementById('admin-nowe2').value;
  if (nowe !== nowe2) {
    pokazMsg('admin-haslo-msg', 'Nowe hasła się nie zgadzają.', 'err');
    return;
  }
  try {
    await api('/api/haslo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rola: 'admin', obecneHaslo: obecne, noweHaslo: nowe }),
    });
    pokazMsg('admin-haslo-msg', 'Hasło administratora zmienione. Zapamiętaj je — będzie potrzebne przy następnym logowaniu.', 'ok');
    document.getElementById('form-haslo-admina').reset();
  } catch (e) {
    pokazMsg('admin-haslo-msg', e.dane && e.dane.error ? e.dane.error : 'Błąd zmiany hasła.', 'err');
  }
});

// ============================================================================
// USTAWIENIA — reguły grafiku (W1-W17), włącz/wyłącz per reguła
// ============================================================================
let katalogRegul = [];
let wylaczoneReguly = [];

async function wczytajReguly() {
  const dane = await api('/api/reguly');
  katalogRegul = dane.katalog || [];
  wylaczoneReguly = dane.wylaczoneReguly || [];
  renderReguly();
}

function renderReguly() {
  const wrap = document.getElementById('reguly-lista');
  wrap.innerHTML = katalogRegul.map((r) => {
    const wylaczona = wylaczoneReguly.indexOf(r.id) !== -1;
    return '<label class="regula-wiersz' + (wylaczona ? ' wylaczona' : '') + '">' +
      '<input type="checkbox" class="regula-check" data-id="' + r.id + '"' + (wylaczona ? '' : ' checked') + '>' +
      '<span class="regula-id">' + r.id + '</span>' +
      '<span class="regula-waga waga-' + r.waga.replace('/', '-') + '">' + r.waga + '</span>' +
      '<span class="regula-opis">' + r.opis + '</span>' +
      '</label>';
  }).join('');
}

document.getElementById('btn-zapisz-reguly').addEventListener('click', async () => {
  const nowaLista = Array.from(document.querySelectorAll('.regula-check')).filter((c) => !c.checked).map((c) => c.dataset.id);
  try {
    await api('/api/reguly', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wylaczoneReguly: nowaLista }) });
    wylaczoneReguly = nowaLista;
    renderReguly();
    pokazMsg('reguly-msg', 'Zapisano ustawienia reguł.', 'ok');
    await wczytajGrafik(); // odśwież ostrzeżenia/obsadę wg nowego zestawu aktywnych reguł
  } catch (e) {
    pokazMsg('reguly-msg', e.dane && e.dane.error ? e.dane.error : 'Błąd zapisu.', 'err');
  }
});

document.getElementById('form-haslo-podgladu').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const nowe = document.getElementById('podglad-nowe').value;
  try {
    const wynik = await api('/api/haslo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rola: 'podglad', noweHaslo: nowe }),
    });
    pokazMsg('podglad-haslo-msg', wynik.wymaganeHaslo ? 'Ustawiono hasło dostępu do podglądu.' : 'Wyłączono wymóg hasła — podgląd jest teraz otwarty.', 'ok');
    document.getElementById('podglad-nowe').value = '';
    await wczytajStatusPodgladu();
  } catch (e) {
    pokazMsg('podglad-haslo-msg', e.dane && e.dane.error ? e.dane.error : 'Błąd zapisu.', 'err');
  }
});

document.getElementById('btn-wczytaj').addEventListener('click', async () => {
  rok = Number(document.getElementById('pole-rok').value);
  miesiac = Number(document.getElementById('pole-miesiac').value);
  await wczytajGrafik();
});

// ============================================================================
// KADRA
// ============================================================================
async function wczytajPracownikow() {
  const dane = await api('/api/pracownicy');
  pracownicy = dane.pracownicy || [];
  renderTabelePracownikow();
}

// Opcje pola "stanowisko" zależą od grupy: main -> pielęgniarka/ratownik (do reguły
// W14), opie -> opiekun_medyczny/opiekun_pacjenta (podgrupa, dziś tylko zapisywana).
function opcjeStanowiska(grupa, wybrane) {
  const lista = grupa === 'opie'
    ? [['opiekun_medyczny', 'opiekun medyczny'], ['opiekun_pacjenta', 'opiekun pacjenta']]
    : [['pielegniarka', 'pielęgniarka'], ['ratownik', 'ratownik']];
  return '<option value=""' + (!wybrane ? ' selected' : '') + '>—</option>' +
    lista.map(([v, etykieta]) => '<option value="' + v + '"' + (wybrane === v ? ' selected' : '') + '>' + etykieta + '</option>').join('');
}

// inicjaly(imieNazwisko) - do awatara w kafelku kadry: 1-2 litery (pierwsza
// litera pierwszego i drugiego "słowa" imienia/nazwiska, albo tylko pierwsza,
// jeśli podano jedno słowo/nic jeszcze nie wpisano).
function inicjaly(imieNazwisko) {
  const czesci = String(imieNazwisko || '').trim().split(/\s+/).filter(Boolean);
  if (!czesci.length) return '?';
  if (czesci.length === 1) return czesci[0][0].toUpperCase();
  return (czesci[0][0] + czesci[1][0]).toUpperCase();
}

// wierszPracownika(p, pokazPolaMain) -> kafelek (karta) pracownika, na życzenie
// 2026-08-30 ("aby każdy pracownik był w formie kafelka") zamiast wiersza tabeli -
// KLASY CSS pól (p-nazwa, p-forma, ...) zostały BEZ ZMIAN względem poprzedniej
// wersji tabelarycznej, więc reszta appki (zapis/wgrywanie z pliku) działa
// identycznie, zmienił się tylko układ HTML/wizualny. Pola SAP/Bez nocek/Opt-out
// dotyczą tylko main, "Typ dyżuru" tylko opie - "Zgoda: mniej nocek" (W18) jest
// wspólna dla obu grup.
function wierszPracownika(p, pokazPolaMain) {
  p = p || { id: '', imieNazwisko: '', forma: 'etat', etat: 1, grupa: 'main', stanowisko: '', flagi: [], optOutZgoda: false, typyDyzuru: [] };
  if (pokazPolaMain == null) pokazPolaMain = p.grupa !== 'opie';
  const flagi = p.flagi || [];
  const typyDyzuru = p.typyDyzuru || [];
  const karta = document.createElement('div');
  karta.className = 'pracownik-kafelek';
  karta.innerHTML =
    '<div class="pk-glowka">' +
      '<div class="pk-avatar">' + inicjaly(p.imieNazwisko) + '</div>' +
      '<input type="text" class="p-nazwa pk-nazwa" value="' + (p.imieNazwisko || '').replace(/"/g, '&quot;') + '" placeholder="Imię i nazwisko">' +
      '<button type="button" class="icon-btn btn-usun-p" title="Usuń"><i class="ti ti-trash"></i></button>' +
    '</div>' +
    '<div class="pk-pola">' +
      '<label>Forma<select class="p-forma"><option value="etat"' + (p.forma === 'etat' ? ' selected' : '') + '>etat</option>' +
        '<option value="kontrakt"' + (p.forma === 'kontrakt' ? ' selected' : '') + '>kontrakt</option>' +
        '<option value="zlecenie"' + (p.forma === 'zlecenie' ? ' selected' : '') + '>zlecenie</option></select></label>' +
      '<label>Etat<input type="number" class="p-etat" value="' + (p.etat == null ? 1 : p.etat) + '" min="0" max="1" step="0.05"></label>' +
      '<label>Grupa<select class="p-grupa"><option value="main"' + (p.grupa === 'main' ? ' selected' : '') + '>main</option>' +
        '<option value="opie"' + (p.grupa === 'opie' ? ' selected' : '') + '>opie</option></select></label>' +
      '<label>Stanowisko<select class="p-stanowisko">' + opcjeStanowiska(p.grupa, p.stanowisko) + '</select></label>' +
      '<label>Godz. min<input type="number" class="p-godz-min" value="' + (p.zlecenieMinGodzin == null ? '' : p.zlecenieMinGodzin) + '" min="0" step="1" placeholder="—"' + (p.forma === 'etat' ? ' disabled' : '') + '></label>' +
      '<label>Godz. max<input type="number" class="p-godz-max" value="' + (p.zlecenieMaxGodzin == null ? '' : p.zlecenieMaxGodzin) + '" min="0" step="1" placeholder="—"' + (p.forma === 'etat' ? ' disabled' : '') + '></label>' +
      // SW/Op - jednostka rocznego limitu (2 dni LUB 16 godz.) - dotyczy tylko etatu
      // (wytyczne_grafik_oddzialowa.docx pkt 3: "Wytyczne obejmują personel etatowy").
      '<label>SW limit<select class="p-sw-jednostka" title="Jednostka rocznego limitu siły wyższej (SW)"' + (p.forma !== 'etat' ? ' disabled' : '') + '>' +
        '<option value="dni"' + (p.silaWyzszaJednostka !== 'godziny' ? ' selected' : '') + '>dni</option>' +
        '<option value="godziny"' + (p.silaWyzszaJednostka === 'godziny' ? ' selected' : '') + '>godz.</option></select></label>' +
      '<label>Op limit<select class="p-op-jednostka" title="Jednostka rocznego limitu opieki nad dzieckiem (Op)"' + (p.forma !== 'etat' ? ' disabled' : '') + '>' +
        '<option value="dni"' + (p.opiekaJednostka !== 'godziny' ? ' selected' : '') + '>dni</option>' +
        '<option value="godziny"' + (p.opiekaJednostka === 'godziny' ? ' selected' : '') + '>godz.</option></select></label>' +
    '</div>' +
    '<div class="pk-flagi">' +
      // Zgoda na mniejszą liczbę dyżurów/nocek niż reszta zespołu - wyklucza osobę
      // z reguły W18 (sprawiedliwy rozkład dyżurów, patrz domain/grafik.js), tak jak
      // "bez_nocek"/"tylko_dzien" - wspólna dla obu grup (dopisane 2026-08-30).
      '<label class="pk-flaga" title="Wyklucza z reguły W18 (sprawiedliwy rozkład dyżurów)"><input type="checkbox" class="p-mniej-nocek"' + (flagi.indexOf('zgoda_mniej_nocek') !== -1 ? ' checked' : '') + '> Zgoda: mniej nocek</label>' +
      (pokazPolaMain
        ? '<label class="pk-flaga"><input type="checkbox" class="p-sap"' + (flagi.indexOf('starszy_asystent') !== -1 ? ' checked' : '') + '> SAP 🩺</label>' +
          '<label class="pk-flaga"><input type="checkbox" class="p-beznocek"' + (flagi.indexOf('bez_nocek') !== -1 ? ' checked' : '') + '> Bez nocek</label>' +
          '<label class="pk-flaga"><input type="checkbox" class="p-optout"' + (p.optOutZgoda ? ' checked' : '') + '> Opt-out 48h</label>'
        : '<label class="pk-flaga"><input type="checkbox" class="p-dyzur-dzien"' + (typyDyzuru.indexOf('dzien') !== -1 ? ' checked' : '') + '> Dzień</label>' +
          '<label class="pk-flaga"><input type="checkbox" class="p-dyzur-noc"' + (typyDyzuru.indexOf('noc') !== -1 ? ' checked' : '') + '> Noc</label>' +
          '<label class="pk-flaga"><input type="checkbox" class="p-dyzur-tylko-dzien"' + (typyDyzuru.indexOf('tylko_dzien') !== -1 ? ' checked' : '') + '> Tylko dzień</label>' +
          '<label class="pk-flaga"><input type="checkbox" class="p-dyzur-doba"' + (typyDyzuru.indexOf('doba') !== -1 ? ' checked' : '') + '> Doba</label>') +
    '</div>';
  karta.dataset.id = p.id || '';
  karta.querySelector('.btn-usun-p').addEventListener('click', () => karta.remove());
  karta.querySelector('.p-nazwa').addEventListener('input', (ev) => {
    karta.querySelector('.pk-avatar').textContent = inicjaly(ev.target.value);
  });
  karta.querySelector('.p-grupa').addEventListener('change', (ev) => {
    karta.querySelector('.p-stanowisko').innerHTML = opcjeStanowiska(ev.target.value, '');
  });
  karta.querySelector('.p-forma').addEventListener('change', (ev) => {
    const jestEtat = ev.target.value === 'etat';
    const polMin = karta.querySelector('.p-godz-min');
    const polMax = karta.querySelector('.p-godz-max');
    polMin.disabled = jestEtat;
    polMax.disabled = jestEtat;
    if (jestEtat) { polMin.value = ''; polMax.value = ''; }
    karta.querySelector('.p-sw-jednostka').disabled = !jestEtat;
    karta.querySelector('.p-op-jednostka').disabled = !jestEtat;
  });
  return karta;
}

function renderTabelePracownikow() {
  const siatkaMain = document.getElementById('tabela-pracownicy-main');
  const siatkaOpie = document.getElementById('tabela-pracownicy-opie');
  siatkaMain.innerHTML = '';
  siatkaOpie.innerHTML = '';
  pracownicy.forEach((p) => {
    const jestOpie = p.grupa === 'opie';
    const karta = wierszPracownika(p, !jestOpie);
    (jestOpie ? siatkaOpie : siatkaMain).appendChild(karta);
  });
}

document.getElementById('btn-dodaj-pracownika').addEventListener('click', () => {
  const siatka = document.getElementById(aktywnaGrupa === 'opie' ? 'tabela-pracownicy-opie' : 'tabela-pracownicy-main');
  const nowyId = 'p' + (Date.now().toString(36));
  const karta = wierszPracownika({ id: nowyId, forma: 'etat', etat: 1, grupa: aktywnaGrupa }, aktywnaGrupa !== 'opie');
  siatka.appendChild(karta);
  karta.querySelector('.p-nazwa').focus();
});

document.getElementById('btn-zapisz-pracownikow').addEventListener('click', async () => {
  const wiersze = Array.from(document.querySelectorAll('#tabela-pracownicy-main .pracownik-kafelek, #tabela-pracownicy-opie .pracownik-kafelek'));
  const nowaLista = wiersze.map((tr, i) => {
    const flagi = [];
    const polSap = tr.querySelector('.p-sap');
    const polBeznocek = tr.querySelector('.p-beznocek');
    const polOptout = tr.querySelector('.p-optout');
    const polMniejNocek = tr.querySelector('.p-mniej-nocek');
    if (polSap && polSap.checked) flagi.push('starszy_asystent');
    if (polBeznocek && polBeznocek.checked) flagi.push('bez_nocek');
    if (polMniejNocek && polMniejNocek.checked) flagi.push('zgoda_mniej_nocek');
    const typyDyzuru = [];
    const polDzien = tr.querySelector('.p-dyzur-dzien');
    const polNoc = tr.querySelector('.p-dyzur-noc');
    const polTylkoDzien = tr.querySelector('.p-dyzur-tylko-dzien');
    const polDoba = tr.querySelector('.p-dyzur-doba');
    if (polDzien && polDzien.checked) typyDyzuru.push('dzien');
    if (polNoc && polNoc.checked) typyDyzuru.push('noc');
    if (polTylkoDzien && polTylkoDzien.checked) typyDyzuru.push('tylko_dzien');
    if (polDoba && polDoba.checked) typyDyzuru.push('doba');
    const stanowisko = tr.querySelector('.p-stanowisko').value;
    const godzMin = tr.querySelector('.p-godz-min').value;
    const godzMax = tr.querySelector('.p-godz-max').value;
    const swJednostka = tr.querySelector('.p-sw-jednostka').value;
    const opJednostka = tr.querySelector('.p-op-jednostka').value;
    return {
      id: tr.dataset.id || ('p' + Date.now().toString(36) + i),
      imieNazwisko: tr.querySelector('.p-nazwa').value.trim(),
      forma: tr.querySelector('.p-forma').value,
      etat: Number(tr.querySelector('.p-etat').value) || 1,
      grupa: tr.querySelector('.p-grupa').value,
      stanowisko: stanowisko || undefined,
      zlecenieMinGodzin: godzMin !== '' ? Number(godzMin) : undefined,
      zlecenieMaxGodzin: godzMax !== '' ? Number(godzMax) : undefined,
      flagi: flagi.length ? flagi : undefined,
      optOutZgoda: (polOptout && polOptout.checked) || undefined,
      typyDyzuru: typyDyzuru.length ? typyDyzuru : undefined,
      silaWyzszaJednostka: swJednostka === 'godziny' ? 'godziny' : undefined,
      opiekaJednostka: opJednostka === 'godziny' ? 'godziny' : undefined,
    };
  }).filter((p) => p.imieNazwisko);

  try {
    const dane = await api('/api/pracownicy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pracownicy: nowaLista }) });
    pracownicy = dane.pracownicy;
    renderTabelePracownikow();
    pokazMsg('pracownicy-msg', 'Zapisano listę pracowników (' + pracownicy.length + ').', 'ok');
    await wczytajGrafik();
  } catch (e) {
    pokazMsg('pracownicy-msg', e.dane && e.dane.error ? e.dane.error : 'Błąd zapisu.', 'err');
  }
});

// ---- import kadry z pliku Excel/CSV (bez zmian backendu — tylko wypełnia
// tabele w przeglądarce, zapis nadal przez istniejący przycisk "Zapisz listę") ----
function normKlucz(v) {
  return String(v == null ? '' : v).trim().toLowerCase()
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
    .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z');
}

function czyTak(v) {
  const s = normKlucz(v);
  return s === 'tak' || s === '1' || s === 'x' || s === 'yes' || s === 'true';
}

function liczbaGodzin(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '' || s === '-' || normKlucz(s) === 'brak') return undefined;
  const n = Number(s.replace(',', '.'));
  return isFinite(n) && n >= 0 ? n : undefined;
}

const POD_NAGLOWKI_GODZ_DYZUR = ['min lacznie', 'max lacznie', 'dzien', 'noc', 'tylko dzien', 'doba'];
function wygladaJakPodnaglowek(wiersz) {
  return (wiersz || []).some((v) => POD_NAGLOWKI_GODZ_DYZUR.indexOf(normKlucz(v)) !== -1);
}
function wierszeZArkusza(arkusz) {
  const surowe = XLSX.utils.sheet_to_json(arkusz, { header: 1, defval: '' });
  const pusty = (w) => (w || []).every((k) => String(k).trim() === '');
  let i = 0;
  while (i < surowe.length && pusty(surowe[i])) i++;
  if (i >= surowe.length) return [];
  const wiersz1 = surowe[i];
  const wiersz2 = surowe[i + 1] || [];
  let naglowki, startDanych;
  if (wygladaJakPodnaglowek(wiersz2)) {
    naglowki = wiersz1.map((v, c) => (String(wiersz2[c] || '').trim() !== '' ? wiersz2[c] : v));
    startDanych = i + 2;
  } else {
    naglowki = wiersz1;
    startDanych = i + 1;
  }
  const wynik = [];
  for (let r = startDanych; r < surowe.length; r++) {
    const wiersz = surowe[r];
    if (pusty(wiersz)) continue;
    const obj = {};
    naglowki.forEach((h, c) => {
      const klucz = String(h == null ? '' : h).trim();
      if (klucz) obj[klucz] = wiersz[c] != null ? wiersz[c] : '';
    });
    wynik.push(obj);
  }
  return wynik;
}

function wgrajPracownikowZWierszy(wiersze) {
  let dodano = 0, zaktualizowano = 0;
  wiersze.forEach((wiersz) => {
    const z = {};
    Object.keys(wiersz).forEach((k) => { z[normKlucz(k)] = wiersz[k]; });

    const imieNazwisko = String(z['imie i nazwisko'] || z['nazwisko i imie'] || z['nazwisko'] || z['imie'] || '').trim();
    if (!imieNazwisko) return;

    const formaRaw = normKlucz(z['forma zatrudnienia'] || z['forma']);
    const forma = ['etat', 'kontrakt', 'zlecenie'].indexOf(formaRaw) !== -1 ? formaRaw : 'etat';

    const etatRaw = Number(z['wymiar etatu'] != null && z['wymiar etatu'] !== '' ? z['wymiar etatu'] : z['etat']);
    const etat = isFinite(etatRaw) && etatRaw > 0 ? etatRaw : 1;

    const grupaRaw = normKlucz(z['grupa']);
    const grupa = grupaRaw.indexOf('opie') === 0 || grupaRaw.indexOf('opiekun') !== -1 ? 'opie' : 'main';

    const stanowiskoZrodlo = normKlucz(z['stanowisko']) || grupaRaw;
    let stanowisko = '';
    if (stanowiskoZrodlo.indexOf('ratow') !== -1) stanowisko = 'ratownik';
    else if (stanowiskoZrodlo.indexOf('medyczn') !== -1) stanowisko = 'opiekun_medyczny';
    else if (stanowiskoZrodlo.indexOf('pacjent') !== -1) stanowisko = 'opiekun_pacjenta';
    else if (stanowiskoZrodlo.indexOf('pieleg') !== -1) stanowisko = 'pielegniarka';

    const zlecenieMinGodzin = liczbaGodzin(z['min lacznie'] != null ? z['min lacznie'] : z['godz min']);
    const zlecenieMaxGodzin = liczbaGodzin(z['max lacznie'] != null ? z['max lacznie'] : z['godz max']);

    const flagi = [];
    if (grupa === 'main') {
      if (czyTak(z['sap'])) flagi.push('starszy_asystent');
      if (czyTak(z['bez nocek'])) flagi.push('bez_nocek');
    }
    const optOutZgoda = grupa === 'main' ? czyTak(z['opt-out 48h'] || z['opt-out'] || z['optout']) : false;

    const typyDyzuru = [];
    if (grupa === 'opie') {
      if (czyTak(z['dzien'])) typyDyzuru.push('dzien');
      if (czyTak(z['noc'])) typyDyzuru.push('noc');
      if (czyTak(z['tylko dzien'])) typyDyzuru.push('tylko_dzien');
      if (czyTak(z['doba'])) typyDyzuru.push('doba');
    }

    const istniejacy = pracownicy.find((p) => normKlucz(p.imieNazwisko) === normKlucz(imieNazwisko));
    if (istniejacy) {
      Object.assign(istniejacy, { forma, etat, grupa, stanowisko, zlecenieMinGodzin, zlecenieMaxGodzin, flagi, optOutZgoda, typyDyzuru });
      zaktualizowano++;
    } else {
      pracownicy.push({
        id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        imieNazwisko, forma, etat, grupa, stanowisko, zlecenieMinGodzin, zlecenieMaxGodzin, flagi, optOutZgoda, typyDyzuru,
      });
      dodano++;
    }
  });
  return { dodano, zaktualizowano };
}

document.getElementById('btn-wgraj-plik').addEventListener('click', () => {
  document.getElementById('input-plik-kadra').click();
});

document.getElementById('input-plik-kadra').addEventListener('change', async (ev) => {
  const plik = ev.target.files[0];
  if (!plik) return;
  try {
    const bufor = await plik.arrayBuffer();
    const skoroszyt = XLSX.read(bufor, { type: 'array' });
    const arkusz = skoroszyt.Sheets[skoroszyt.SheetNames[0]];
    const wiersze = wierszeZArkusza(arkusz);
    const { dodano, zaktualizowano } = wgrajPracownikowZWierszy(wiersze);
    renderTabelePracownikow();
    pokazMsg(
      'pracownicy-msg',
      'Wgrano z pliku: dodano ' + dodano + ', zaktualizowano ' + zaktualizowano +
        '. Sprawdź listę i kliknij „Zapisz listę", żeby zapisać.',
      dodano || zaktualizowano ? 'ok' : 'err'
    );
  } catch (e) {
    pokazMsg('pracownicy-msg', 'Błąd wczytywania pliku: ' + e.message, 'err');
  }
  ev.target.value = '';
});

// ============================================================================
// GRAFIK — siatka, ostrzeżenia, obsada, publikacja
// ============================================================================
function liczbaDniMiesiaca(r, m) { return new Date(r, m, 0).getDate(); }
function dataStr(r, m, d) { return r + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
function jestWeekend(r, m, d) { const dz = new Date(r, m - 1, d).getDay(); return dz === 0 || dz === 6; }

// wpisDnia() -> pełny wpis {kod, kodRealizacji?, zamianaZId?} albo null - do
// renderowania siatki (plan+realizacja) i do popovera edycji. kodDnia() to
// stary skrót (sam plan) - zostawiony, bo używa go jeszcze eksport Excela w
// prostszym trybie gdzieś indziej.
function wpisDnia(pracownikId, dataX) {
  return (biezacyGrafik.stan.wpisy || []).find((x) => x.pracownikId === pracownikId && x.data === dataX && x.slot === 1) || null;
}
function kodDnia(pracownikId, dataX) {
  const wpis = wpisDnia(pracownikId, dataX);
  return wpis ? wpis.kod : '';
}
function nazwiskoPracownika(id) {
  const p = pracownicy.find((x) => x.id === id);
  return p ? p.imieNazwisko : '?';
}

// chipPlanHtml/chipRealizacjiHtml — treść pojedynczej komórki w dwuwierszowej
// siatce (wiersz PLAN nad wierszem REALIZACJA tej samej osoby, na stałe - wzorem
// realnego arkusza „płachta"). Adnotacja „z kim zamiana" to mała kropka ⇄ w rogu
// komórki planu (tooltip z nazwiskiem), żeby nie rozsadzać wąskiej kolumny.
function chipPlanHtml(w) {
  const kod = w ? w.kod : '';
  let html = '<span class="kod-chip k-' + (kod || 'brak') + '"' + (OPISY_KODOW[kod] ? ' title="' + OPISY_KODOW[kod] + '"' : '') + '>' + (ETYKIETY_KODOW[kod] || kod || '—') + '</span>';
  if (w && w.zamianaZId) {
    html += '<span class="zamiana-dot" title="Zamiana z ' + nazwiskoPracownika(w.zamianaZId) + '">⇄</span>';
  }
  return html;
}
function chipRealizacjiHtml(w) {
  const kod = w ? w.kod : '';
  const kodRealizacji = w && w.kodRealizacji ? w.kodRealizacji : '';
  if (!kodRealizacji || kodRealizacji === kod) return '';
  return '<span class="kod-chip small k-' + kodRealizacji + '"' + (OPISY_KODOW[kodRealizacji] ? ' title="' + OPISY_KODOW[kodRealizacji] + '"' : '') + '>' + (ETYKIETY_KODOW[kodRealizacji] || kodRealizacji) + '</span>';
}

// ---- przeciąganie dyżuru na inny dzień (w obrębie TEJ SAMEJ osoby) ----
// Kafelka z dyżurem jest draggable (patrz atrybut w renderTabeleGrafiku). Upuszczenie
// dozwolone tylko w wierszu tego samego pracownika - jeśli dzień docelowy jest pusty,
// to zwykłe przeniesienie; jeśli już coś tam jest, to zamiana miejscami (żeby nic nie
// zniknęło). Kolejność zapisu: NAJPIERW cel, POTEM źródło - jeśli reguła twarda
// zablokuje zapis celu, nic się jeszcze nie zmieniło (źródło zostaje nietknięte).
let przeciaganie = null; // { pracownikId, d } — źródło aktualnie przeciąganego dyżuru

function onDragStart(ev) {
  const td = ev.currentTarget;
  przeciaganie = { pracownikId: td.dataset.p, d: Number(td.dataset.d) };
  ev.dataTransfer.effectAllowed = 'move';
  try { ev.dataTransfer.setData('text/plain', ''); } catch (e) { /* niektóre przeglądarki wymagają tego wywołania, żeby drag ruszył */ }
  td.classList.add('dragging');
}

function onDragEnd(ev) {
  ev.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.dzien.drag-over').forEach((el) => el.classList.remove('drag-over'));
  przeciaganie = null;
}

function onDragOver(ev) {
  const td = ev.currentTarget;
  if (!przeciaganie || td.dataset.p !== przeciaganie.pracownikId) return; // tylko w obrębie tej samej osoby
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  td.classList.add('drag-over');
}

function onDragLeave(ev) {
  ev.currentTarget.classList.remove('drag-over');
}

async function onDrop(ev) {
  ev.preventDefault();
  const td = ev.currentTarget;
  td.classList.remove('drag-over');
  if (!przeciaganie || td.dataset.p !== przeciaganie.pracownikId) { przeciaganie = null; return; }

  const pracownikId = przeciaganie.pracownikId;
  const dZrodlo = przeciaganie.d;
  const dCel = Number(td.dataset.d);
  przeciaganie = null;
  if (dZrodlo === dCel) return;

  const dataZrodlo = dataStr(rok, miesiac, dZrodlo);
  const dataCel = dataStr(rok, miesiac, dCel);
  const wZrodlo = wpisDnia(pracownikId, dataZrodlo);
  if (!wZrodlo || !wZrodlo.kod) return; // przeciągnięcie pustej komórki - nic do zrobienia
  const wCel = wpisDnia(pracownikId, dataCel);

  const polaZrodla = { kod: wZrodlo.kod, kodRealizacji: wZrodlo.kodRealizacji || '', zamianaZId: wZrodlo.zamianaZId || '' };
  const polaCeluStare = wCel
    ? { kod: wCel.kod || '', kodRealizacji: wCel.kodRealizacji || '', zamianaZId: wCel.zamianaZId || '' }
    : { kod: '', kodRealizacji: '', zamianaZId: '' };

  const okCel = await zapiszKomorke(pracownikId, dataCel, polaZrodla);
  if (!okCel) return; // reguła twarda zablokowała - nic się nie zmieniło
  await zapiszKomorke(pracownikId, dataZrodlo, polaCeluStare);
}

// renderTabeleGrafiku — siatka na STAŁE dwuwierszowa na osobę (wiersz PLAN nad
// wierszem REALIZACJA, wzorem realnego arkusza „płachta" - patrz komentarz przy
// chipPlanHtml/chipRealizacjiHtml powyżej), a kolumny dni dzielą się równo na
// całą szerokość karty (table-layout:fixed + colgroup) tak, żeby cały miesiąc
// (do 31 dni) mieścił się na ekranie bez przewijania w poziomie (2026-08-30,
// feedback: "powinna być możliwość widać cały mc na ekranie / plan realizacja
// u każdego pracownika").
function renderTabeleGrafiku(grupa, elementId) {
  const tbl = document.getElementById(elementId);
  const osoby = pracownicy.filter((p) => p.grupa === grupa);
  const dni = liczbaDniMiesiaca(rok, miesiac);
  let html = '<colgroup><col class="col-nazwa">';
  for (let d = 1; d <= dni; d++) html += '<col>';
  html += '</colgroup>';
  html += '<thead><tr><th class="nazwa">Pracownik</th>';
  for (let d = 1; d <= dni; d++) html += '<th' + (jestWeekend(rok, miesiac, d) ? ' class="weekend"' : '') + '>' + d + '</th>';
  html += '</tr></thead><tbody>';
  osoby.forEach((p) => {
    const opis = [p.forma, p.stanowisko].filter(Boolean).join(', ');
    const sap = (p.flagi && p.flagi.includes('starszy_asystent')) ? ' 🩺' : '';
    // wiersz PLAN — komórka nazwiska ma rowspan=2 i przykrywa też wiersz realizacji
    html += '<tr class="wiersz-plan"><td class="nazwa" rowspan="2" title="' + opis + '">' + p.imieNazwisko + sap + '</td>';
    for (let d = 1; d <= dni; d++) {
      const dataX = dataStr(rok, miesiac, d);
      const w = wpisDnia(p.id, dataX);
      html += '<td class="dzien plan-row' + (jestWeekend(rok, miesiac, d) ? ' weekend' : '') + '" data-p="' + p.id + '" data-d="' + d + '"' +
        (w && w.kod ? ' draggable="true"' : '') + '>' + chipPlanHtml(w) + '</td>';
    }
    html += '</tr>';
    // wiersz REALIZACJA — bez komórki nazwiska (przykryta rowspanem powyżej);
    // pusta, jeśli realizacja == plan (albo brak wpisu) - jak druga linia w płachcie.
    html += '<tr class="wiersz-realizacja">';
    for (let d = 1; d <= dni; d++) {
      const dataX = dataStr(rok, miesiac, d);
      const w = wpisDnia(p.id, dataX);
      html += '<td class="dzien realizacja-row' + (jestWeekend(rok, miesiac, d) ? ' weekend' : '') + '" data-p="' + p.id + '" data-d="' + d + '">' + chipRealizacjiHtml(w) + '</td>';
    }
    html += '</tr>';
  });
  html += '</tbody>';
  tbl.innerHTML = html;
  tbl.querySelectorAll('td.dzien').forEach((td) => {
    td.addEventListener('click', onOtworzPicker);
    td.addEventListener('dragover', onDragOver);
    td.addEventListener('dragleave', onDragLeave);
    td.addEventListener('drop', onDrop);
  });
  tbl.querySelectorAll('td.dzien[draggable="true"]').forEach((td) => {
    td.addEventListener('dragstart', onDragStart);
    td.addEventListener('dragend', onDragEnd);
  });
}

function renderGrafikSiatki() {
  renderTabeleGrafiku('main', 'grafik-table-main');
  renderTabeleGrafiku('opie', 'grafik-table-opie');
}

// ---- popover edycji komórki: Plan / Realizacja / Zamiana z ----
// Rozszerzony wzorem realnego arkusza „płachta": plan i realizacja to dwie
// niezależne wartości (realizacja może zostać pusta = „tak jak plan"), a
// "zamiana z" to czysta adnotacja (kto z kim się zamienił dyżurem), wybierana
// z listy kadry tej samej grupy. Każda zmiana zapisuje się od razu (jak
// dotychczas), ale popover NIE zamyka się po kliknięciu — bo trzeba ustawić
// kilka pól po kolei. Zamyka go dopiero „Gotowe" albo klik poza popover.
function onOtworzPicker(ev) {
  const td = ev.currentTarget;
  const pracownikId = td.dataset.p;
  const d = Number(td.dataset.d);
  const dataX = dataStr(rok, miesiac, d);
  const wZapisany = wpisDnia(pracownikId, dataX) || {};
  const pending = {
    kod: wZapisany.kod || '',
    kodRealizacji: wZapisany.kodRealizacji || '',
    zamianaZId: wZapisany.zamianaZId || '',
  };
  const picker = document.getElementById('kod-picker');
  const osoba = pracownicy.find((x) => x.id === pracownikId);
  const inniZGrupy = pracownicy.filter((x) => osoba && x.grupa === osoba.grupa && x.id !== pracownikId);

  function chipy(pole, lista) {
    return lista.map((k) =>
      '<span class="kod-chip k-' + (k || 'brak') + (pending[pole] === k ? ' sel' : '') + '" data-pole="' + pole + '" data-k="' + k + '"' +
        (OPISY_KODOW[k] ? ' title="' + OPISY_KODOW[k] + '"' : '') + '>' +
        (ETYKIETY_KODOW[k] || k) + '</span>'
    ).join('');
  }

  function render() {
    picker.innerHTML =
      '<div class="kp-sekcja"><div class="kp-etykieta">Plan</div><div class="kp-chipy">' + chipy('kod', KODY) + '</div></div>' +
      '<div class="kp-sekcja"><div class="kp-etykieta">Realizacja' +
        (pending.kodRealizacji ? ' <button type="button" class="kp-reset" data-akcja="reset-realizacja">jak plan</button>' : '') +
        '</div><div class="kp-chipy">' + chipy('kodRealizacji', KODY.filter((k) => k !== '')) + '</div></div>' +
      '<div class="kp-sekcja"><div class="kp-etykieta">Zamiana z</div>' +
        '<select class="kp-zamiana"><option value="">— brak —</option>' +
        inniZGrupy.map((o) => '<option value="' + o.id + '"' + (pending.zamianaZId === o.id ? ' selected' : '') + '>' + o.imieNazwisko + '</option>').join('') +
        '</select></div>' +
      '<div class="kp-akcje"><button type="button" class="btn secondary sm" data-akcja="gotowe">Gotowe</button></div>';

    picker.querySelectorAll('.kod-chip[data-pole]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const stara = pending[chip.dataset.pole];
        pending[chip.dataset.pole] = chip.dataset.k;
        zapisz(chip.dataset.pole, stara);
      });
    });
    const btnReset = picker.querySelector('[data-akcja="reset-realizacja"]');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        const stara = pending.kodRealizacji;
        pending.kodRealizacji = '';
        zapisz('kodRealizacji', stara);
      });
    }
    picker.querySelector('.kp-zamiana').addEventListener('change', (e) => {
      const stara = pending.zamianaZId;
      pending.zamianaZId = e.target.value;
      zapisz('zamianaZId', stara);
    });
    picker.querySelector('[data-akcja="gotowe"]').addEventListener('click', () => {
      picker.classList.remove('open');
    });
  }

  async function zapisz(pole, staraWartosc) {
    // Realizacja MOŻE być ustawiona bez planu (nieplanowany dyżur faktycznie
    // przepracowany - grfKodEfektywny() i tak liczy godziny/reguły wg realizacji).
    // Zamiana bez żadnego kodu (ani planu, ani realizacji) nie ma jednak sensu.
    if (!pending.kod && !pending.kodRealizacji) {
      pending.zamianaZId = '';
    }
    const ok = await zapiszKomorke(pracownikId, dataX, pending);
    if (!ok) pending[pole] = staraWartosc; // reguła twarda odrzuciła — cofnij lokalnie
    render();
  }

  render();

  // position:fixed względem viewportu (patrz komentarz w style.css przy .kod-picker) -
  // niezależne od przewijania siatki, więc okienko nigdy nie jest przycięte.
  const rect = td.getBoundingClientRect();
  const szerokosc = 340, margines = 10;
  let left = rect.left;
  if (left + szerokosc + margines > window.innerWidth) left = Math.max(margines, window.innerWidth - szerokosc - margines);
  let top = rect.bottom + 4;
  const wysokoscOkna = Math.min(420, picker.scrollHeight || 420);
  if (top + wysokoscOkna + margines > window.innerHeight) top = Math.max(margines, rect.top - 4 - wysokoscOkna);
  picker.style.left = left + 'px';
  picker.style.top = top + 'px';
  picker.classList.add('open');

  function naZewnatrz(e) {
    if (!picker.contains(e.target) && e.target !== td) {
      picker.classList.remove('open');
      document.removeEventListener('click', naZewnatrz, true);
    }
  }
  setTimeout(() => document.addEventListener('click', naZewnatrz, true), 0);
}

// zapiszKomorke(pracownikId, dataX, pola) -> Promise<boolean> (true = zapisano)
// `pola` to { kod, kodRealizacji, zamianaZId } - zawsze wysyłamy pełny stan
// komórki (jak w sgZapiszZmiane — nowy wpis zastępuje cały stary).
async function zapiszKomorke(pracownikId, dataX, pola) {
  try {
    const wynik = await api('/api/grafik', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ rok, miesiac, akcja: 'zapisz', pracownikId, data: dataX, slot: 1 }, pola)),
    });
    if (!wynik.ok) {
      alert('Zablokowane (reguła twarda):\n\n' + wynik.powod);
      return false;
    }
    await wczytajGrafik();
    return true;
  } catch (e) {
    alert('Błąd zapisu: ' + (e.dane && e.dane.error ? e.dane.error : e.message));
    return false;
  }
}

function renderWarn() {
  const list = document.getElementById('warn-list');
  const ostrzezenia = biezacyGrafik.ostrzezenia || [];
  document.getElementById('warn-miesiac-etykieta').textContent = miesiac + '.' + rok;
  const licznik = document.getElementById('nav-warn-count');
  if (ostrzezenia.length) {
    licznik.textContent = ostrzezenia.length;
    licznik.style.display = '';
  } else {
    licznik.style.display = 'none';
  }
  if (!ostrzezenia.length) { list.innerHTML = '<li class="empty">Brak ostrzeżeń.</li>'; return; }
  list.innerHTML = ostrzezenia.map((o) => {
    const p = pracownicy.find((x) => x.id === o.pracownikId);
    const kogo = p ? p.imieNazwisko : '(cały oddział)';
    return '<li class="' + o.sev + '"><b>' + o.rule + ' — ' + (o.sev === 'hard' ? 'twarde' : 'miękkie') + '</b>' +
      kogo + (o.data ? ', ' + o.data : '') + '<br>' + o.komunikat + '</li>';
  }).join('');
}

function renderObsada() {
  const wiersze = biezacyGrafik.obsada || [];
  let html = '<table class="obsada"><tr><th>Dzień</th><th>main D</th><th>main N</th><th>opie D</th><th>opie N</th></tr>';
  wiersze.forEach((w) => {
    const d = Number(w.data.slice(8, 10));
    html += '<tr><td>' + d + '</td>' +
      '<td' + (w.main.D < w.minMain.D ? ' class="brak"' : '') + '>' + w.main.D + '/' + w.minMain.D + '</td>' +
      '<td' + (w.main.N < w.minMain.N ? ' class="brak"' : '') + '>' + w.main.N + '/' + w.minMain.N + '</td>' +
      '<td' + (w.opie.D < w.minOpie.D ? ' class="brak"' : '') + '>' + w.opie.D + '/' + w.minOpie.D + '</td>' +
      '<td' + (w.opie.N < w.minOpie.N ? ' class="brak"' : '') + '>' + w.opie.N + '/' + w.minOpie.N + '</td></tr>';
  });
  html += '</table>';
  document.getElementById('obsada-wrap').innerHTML = html;
}

function renderStatus() {
  const stan = biezacyGrafik.stan;
  const badge = document.getElementById('status-badge');
  badge.textContent = stan.status;
  badge.className = 'badge ' + stan.status;
  document.getElementById('status-wersja').textContent = 'wersja ' + stan.wersja;
  document.getElementById('btn-wznow').style.display = stan.status === 'opublikowany' ? 'inline-block' : 'none';
  document.getElementById('btn-publikuj').disabled = stan.status === 'opublikowany';
}

async function wczytajGrafik() {
  biezacyGrafik = await api('/api/grafik?rok=' + rok + '&miesiac=' + miesiac);
  renderStatus();
  renderGrafikSiatki();
  renderWarn();
  renderObsada();
  ustawGrupe(aktywnaGrupa);
}

document.getElementById('btn-publikuj').addEventListener('click', async () => {
  let wynik = await api('/api/grafik', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rok, miesiac, akcja: 'publikuj' }) });
  if (!wynik.ok && wynik.powod && wynik.powod.startsWith('SG3')) {
    if (confirm(wynik.powod + '\n\nPublikować mimo to?')) {
      wynik = await api('/api/grafik', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rok, miesiac, akcja: 'publikuj', mimoOstrzezen: true }) });
    } else {
      return;
    }
  }
  if (!wynik.ok) { pokazMsg('publikuj-msg', wynik.powod, 'err'); return; }
  pokazMsg('publikuj-msg', 'Opublikowano — wersja ' + wynik.stan.wersja + '.', 'ok');
  await wczytajGrafik();
});

document.getElementById('btn-wznow').addEventListener('click', async () => {
  const wynik = await api('/api/grafik', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rok, miesiac, akcja: 'wznowEdycje' }) });
  pokazMsg('publikuj-msg', 'Wznowiono edycję (wersja ' + wynik.stan.wersja + ').', 'ok');
  await wczytajGrafik();
});

// ============================================================================
// IMPORT GOTOWEGO GRAFIKU Z EXCELA (2026-09-05, na prośbę Piotra: "nie ma
// możliwości eksportowania grafiku z Excela" - w domyśle: WCZYTANIA realnego,
// historycznego arkusza typu "płachta_2026.xlsx" do appki). Klient tu robi
// TYLKO jedną rzecz - wyciąga surową siatkę komórek z wybranego arkusza przez
// bibliotekę XLSX (już załadowaną wyżej, jak przy imporcie kadry) - CAŁA
// normalizacja kodów i dopasowanie nazwisk dzieje się na serwerze
// (api/grafik-import.js + domain/importGrafikuExcel.js + domain/
// importDopasowania.js), żeby appka nie musiała utrzymywać tej samej,
// nietrywialnej logiki w dwóch miejscach (przeglądarka i serwer).
// Dwuetapowo: akcja='parsuj' (serwer zwraca dopasowania do przejrzenia) ->
// ekran w #import-grafiku-modal -> akcja='zatwierdz' (serwer zapisuje).
// ============================================================================

let importStanRoboczy = null; // { main: {wierszeOsob, pominieciOsob, dopasowania}|null, opie: {...}|null }

function siatkaZArkusza(arkusz) {
  if (!arkusz) return null;
  return XLSX.utils.sheet_to_json(arkusz, { header: 1, raw: true, defval: null });
}

function importIdWyboru(grupaKlucz, nazwisko) {
  return 'import-wybor-' + grupaKlucz + '-' + encodeURIComponent(nazwisko);
}

function importWierszDopasowania(dopasowanie, grupaKlucz) {
  const nazwisko = dopasowanie.nazwisko;
  if (dopasowanie.wynik === 'dokladne') {
    return '<div class="regula-wiersz"><b>' + nazwisko + '</b> — dopasowano automatycznie do istniejącego pracownika.</div>';
  }
  const opcjePomin = '<option value="">— pomiń tę osobę' + (dopasowanie.wynik === 'brak' ? ' (brak dopasowania)' : '') + ' —</option>';
  const opcjeKandydaci = dopasowanie.wynik === 'kandydaci'
    ? dopasowanie.kandydaci.map((k) => '<option value="' + k.id + '">' + k.nazwisko + ' (podobieństwo ' + k.podobienstwo + ')</option>').join('')
    : '';
  return '<div class="regula-wiersz"><b>' + nazwisko + '</b> — ' +
    (dopasowanie.wynik === 'kandydaci' ? 'nazwisko z Excela, wybierz kogo to dotyczy:' : 'nazwisko nie pasuje do nikogo w kadrze:') +
    '<br><select id="' + importIdWyboru(grupaKlucz, nazwisko) + '">' + opcjePomin + opcjeKandydaci + '</select></div>';
}

function importRenderEkran() {
  const tresc = document.getElementById('import-grafiku-tresc');
  let html = '<p class="note">Import NIE tworzy nowych pracowników — nazwiska bez wybranego dopasowania zostaną pominięte przy zapisie (dodaj brakującą osobę w Kadrze i wgraj plik ponownie, jeśli trzeba jej dyżury).</p>';
  const etykietyGrup = { main: 'Pielęgniarki / ratownicy', opie: 'Opiekunowie' };
  ['main', 'opie'].forEach((grupaKlucz) => {
    const dane = importStanRoboczy[grupaKlucz];
    if (!dane) return;
    html += '<h3 style="margin:16px 0 8px">' + etykietyGrup[grupaKlucz] + '</h3>';
    if (dane.pominieciOsob && dane.pominieciOsob.length) {
      html += '<p class="note">Pominięte przy odczycie arkusza: ' +
        dane.pominieciOsob.map((p) => p.nazwisko + ' (' + p.powod + ')').join('; ') + '</p>';
    }
    if (!dane.dopasowania.length) {
      html += '<p class="note">Brak osób do zaimportowania w tym arkuszu.</p>';
    } else {
      html += dane.dopasowania.map((d) => importWierszDopasowania(d, grupaKlucz)).join('');
    }
  });
  tresc.innerHTML = html;
}

document.getElementById('btn-import-excel').addEventListener('click', () => {
  document.getElementById('input-plik-grafiku').click();
});

document.getElementById('input-plik-grafiku').addEventListener('change', async (ev) => {
  const plik = ev.target.files[0];
  if (!plik) return;
  try {
    const bufor = await plik.arrayBuffer();
    const skoroszyt = XLSX.read(bufor, { type: 'array' });
    const nazwaMiesiaca = NAZWY_MIESIECY[miesiac - 1];
    const arkuszMain = skoroszyt.Sheets[nazwaMiesiaca];
    const arkuszOpie = skoroszyt.Sheets['Opie-' + nazwaMiesiaca];
    if (!arkuszMain && !arkuszOpie) {
      alert('W pliku nie ma arkusza „' + nazwaMiesiaca + '" ani „Opie-' + nazwaMiesiaca + '" — sprawdź, czy u góry wybrany jest właściwy Rok/Miesiąc (import wczytuje arkusz DOKŁADNIE dla wybranego miesiąca).');
      return;
    }
    const wynik = await api('/api/grafik-import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rok, miesiac, akcja: 'parsuj', main: siatkaZArkusza(arkuszMain), opie: siatkaZArkusza(arkuszOpie) }),
    });
    if ((wynik.main && wynik.main.blad) || (wynik.opie && wynik.opie.blad)) {
      alert('Nie udało się odczytać arkusza: ' + ((wynik.main && wynik.main.blad) || (wynik.opie && wynik.opie.blad)));
      return;
    }
    importStanRoboczy = { main: wynik.main, opie: wynik.opie };
    importRenderEkran();
    document.getElementById('import-grafiku-modal').style.display = 'flex';
  } catch (e) {
    alert('Błąd wczytywania pliku: ' + (e.dane && e.dane.error ? e.dane.error : e.message));
  }
  ev.target.value = '';
});

document.getElementById('btn-import-anuluj').addEventListener('click', () => {
  document.getElementById('import-grafiku-modal').style.display = 'none';
  importStanRoboczy = null;
});

document.getElementById('btn-import-zatwierdz').addEventListener('click', async () => {
  const body = { rok, miesiac, akcja: 'zatwierdz' };
  ['main', 'opie'].forEach((grupaKlucz) => {
    const dane = importStanRoboczy[grupaKlucz];
    if (!dane) return;
    const przypisania = {};
    dane.dopasowania.forEach((d) => {
      if (d.wynik === 'dokladne') { przypisania[d.nazwisko] = d.id; return; }
      const select = document.getElementById(importIdWyboru(grupaKlucz, d.nazwisko));
      if (select && select.value) przypisania[d.nazwisko] = select.value;
    });
    body[grupaKlucz] = { wierszeOsob: dane.wierszeOsob, przypisania };
  });
  try {
    const wynik = await api('/api/grafik-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    document.getElementById('import-grafiku-modal').style.display = 'none';
    importStanRoboczy = null;
    let tekst = 'Zaimportowano ' + wynik.liczbaWpisow + ' ' + (wynik.liczbaWpisow === 1 ? 'wpis' : 'wpisów') + '.';
    if (wynik.doSprawdzenia && wynik.doSprawdzenia.length) {
      tekst += ' Do ręcznego sprawdzenia (' + wynik.doSprawdzenia.length + '): ' +
        wynik.doSprawdzenia.slice(0, 20).map((d) => (d.nazwisko || '?') + (d.data ? ' ' + d.data : '') + ' — ' + d.powod).join('; ') +
        (wynik.doSprawdzenia.length > 20 ? '…' : '');
    }
    pokazMsg('generuj-msg', tekst, wynik.doSprawdzenia && wynik.doSprawdzenia.length ? 'err' : 'ok');
    await wczytajGrafik();
  } catch (e) {
    alert('Błąd zapisu importu: ' + (e.dane && e.dane.error ? e.dane.error : e.message));
  }
});

// ---- generator brakującej obsady ----
document.getElementById('btn-generuj').addEventListener('click', async () => {
  if (!confirm('Uzupełnić brakujące dyżury D/N do minimalnej obsady w ' + miesiac + '.' + rok + '? Nie nadpisuje istniejących wpisów.')) return;
  try {
    const wynik = await api('/api/grafik', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rok, miesiac, akcja: 'generuj' }) });
    const braki = wynik.braki || [];
    let tekst = 'Wygenerowano ' + wynik.wygenerowano + ' ' + (wynik.wygenerowano === 1 ? 'dyżur' : 'dyżurów') + '.';
    if (braki.length) {
      tekst += ' Nie udało się w pełni obsadzić: ' +
        braki.map((b) => b.data + ' ' + b.grupa + ' ' + b.typ + ' (brakuje ' + b.brakuje + ')').join('; ') + '.';
    }
    pokazMsg('generuj-msg', tekst, braki.length ? 'err' : 'ok');
    await wczytajGrafik();
  } catch (e) {
    pokazMsg('generuj-msg', e.dane && e.dane.error ? e.dane.error : 'Błąd generowania.', 'err');
  }
});

// ---- druk (PDF przez przeglądarkę) i eksport do Excela bieżącego grafiku ----
document.getElementById('btn-drukuj').addEventListener('click', () => window.print());

// arkuszGrupy — układ dwóch wierszy na osobę (plan / realizacja), wzorem
// realnego arkusza "płachta_2026.xlsx": wiersz planu ma kod + "-Nazwisko" jeśli
// zaznaczono zamianę, wiersz pod spodem (bez nazwiska w pierwszej kolumnie) ma
// kod realizacji TYLKO w komórkach, gdzie różni się od planu (inaczej pusto).
function arkuszGrupy(grupa) {
  const osoby = pracownicy.filter((p) => p.grupa === grupa);
  const dni = liczbaDniMiesiaca(rok, miesiac);
  const naglowek = ['Pracownik'];
  for (let d = 1; d <= dni; d++) naglowek.push(String(d));
  const wiersze = [naglowek];
  osoby.forEach((p) => {
    const wierszPlan = [p.imieNazwisko];
    const wierszRealizacja = [''];
    for (let d = 1; d <= dni; d++) {
      const w = wpisDnia(p.id, dataStr(rok, miesiac, d));
      const kod = w ? w.kod || '' : '';
      const zamiana = w && w.zamianaZId ? '-' + nazwiskoPracownika(w.zamianaZId) : '';
      wierszPlan.push(kod + zamiana);
      const kodRealizacji = w && w.kodRealizacji && w.kodRealizacji !== kod ? w.kodRealizacji : '';
      wierszRealizacja.push(kodRealizacji);
    }
    wiersze.push(wierszPlan);
    if (wierszRealizacja.some((v) => v)) wiersze.push(wierszRealizacja);
  });
  return XLSX.utils.aoa_to_sheet(wiersze);
}

document.getElementById('btn-eksport-excel').addEventListener('click', () => {
  if (!biezacyGrafik) return;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, arkuszGrupy('main'), 'main');
  XLSX.utils.book_append_sheet(wb, arkuszGrupy('opie'), 'opie');
  XLSX.writeFile(wb, 'grafik-' + String(miesiac).padStart(2, '0') + '-' + rok + '.xlsx');
});

sprawdzSesje().catch(pokazBladStartu);
