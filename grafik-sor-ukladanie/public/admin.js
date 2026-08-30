// public/admin.js — panel administratora v2 (boczna nawigacja, kolorowa
// siatka grafiku z edycją jednym kliknięciem). Logika API/danych w dużej
// mierze przeniesiona bez zmian z poprzedniej wersji - zmienia się głównie
// budowanie DOM (nowy układ) i sposób edycji komórek grafiku.
// Kody dopisane 2026-08-30 (SW/Op/Us/Uo/Ub/Um/Nn/Nun/Nup/Zr/Wn/Ws) na podstawie
// wytyczne_grafik_oddzialowa.docx i legendy z arkuszy "maj-czerwiec ... 2026.xlsx" —
// patrz komentarz przy GRF_KODY_WG_STAWKI_OSOBY w domain/grafik.js.
const KODY = [
  '', 'D', 'N', 'DOBA', 'W', 'UW', 'CH', 'DCH', 'NCH', 'S',
  'SW', 'Op', 'Us', 'Uo', 'Ub', 'Um', 'Nn', 'Nun', 'Nup', 'Zr', 'Wn', 'Ws',
];
const ETYKIETY_KODOW = {
  '': '—', D: 'D', N: 'N', DOBA: 'DOBA', W: 'W', UW: 'UW', CH: 'CH', DCH: 'DCH', NCH: 'NCH', S: 'S',
  SW: 'SW', Op: 'Op', Us: 'Us', Uo: 'Uo', Ub: 'Ub', Um: 'Um', Nn: 'Nn', Nun: 'Nun', Nup: 'Nup', Zr: 'Zr', Wn: 'Wn', Ws: 'Ws',
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
    await wystartuj();
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

// Kolumny SAP/Bez nocek/Opt-out 48h dotyczą tylko grupy main - w tabeli opie ich
// nie ma. Za to tylko opie ma kolumny "Typ dyżuru" (dzień/noc/tylko dzień/doba).
function wierszPracownika(p, pokazPolaMain) {
  p = p || { id: '', imieNazwisko: '', forma: 'etat', etat: 1, grupa: 'main', stanowisko: '', flagi: [], optOutZgoda: false, typyDyzuru: [] };
  if (pokazPolaMain == null) pokazPolaMain = p.grupa !== 'opie';
  const flagi = p.flagi || [];
  const typyDyzuru = p.typyDyzuru || [];
  const tr = document.createElement('tr');
  tr.innerHTML =
    '<td><input type="text" class="p-nazwa" value="' + (p.imieNazwisko || '').replace(/"/g, '&quot;') + '" placeholder="Imię i nazwisko" style="width:160px"></td>' +
    '<td><select class="p-forma"><option value="etat"' + (p.forma === 'etat' ? ' selected' : '') + '>etat</option>' +
      '<option value="kontrakt"' + (p.forma === 'kontrakt' ? ' selected' : '') + '>kontrakt</option>' +
      '<option value="zlecenie"' + (p.forma === 'zlecenie' ? ' selected' : '') + '>zlecenie</option></select></td>' +
    '<td><input type="number" class="p-etat" value="' + (p.etat == null ? 1 : p.etat) + '" min="0" max="1" step="0.05" style="width:60px"></td>' +
    '<td><select class="p-grupa"><option value="main"' + (p.grupa === 'main' ? ' selected' : '') + '>main</option>' +
      '<option value="opie"' + (p.grupa === 'opie' ? ' selected' : '') + '>opie</option></select></td>' +
    '<td><select class="p-stanowisko">' + opcjeStanowiska(p.grupa, p.stanowisko) + '</select></td>' +
    '<td><input type="number" class="p-godz-min" value="' + (p.zlecenieMinGodzin == null ? '' : p.zlecenieMinGodzin) + '" min="0" step="1" style="width:70px" placeholder="—"' + (p.forma === 'etat' ? ' disabled' : '') + '></td>' +
    '<td><input type="number" class="p-godz-max" value="' + (p.zlecenieMaxGodzin == null ? '' : p.zlecenieMaxGodzin) + '" min="0" step="1" style="width:70px" placeholder="—"' + (p.forma === 'etat' ? ' disabled' : '') + '></td>' +
    // SW/Op - jednostka rocznego limitu (2 dni LUB 16 godz.) - dotyczy tylko etatu
    // (wytyczne_grafik_oddzialowa.docx pkt 3: "Wytyczne obejmują personel etatowy").
    '<td><select class="p-sw-jednostka" title="Jednostka rocznego limitu siły wyższej (SW)"' + (p.forma !== 'etat' ? ' disabled' : '') + '>' +
      '<option value="dni"' + (p.silaWyzszaJednostka !== 'godziny' ? ' selected' : '') + '>SW: dni</option>' +
      '<option value="godziny"' + (p.silaWyzszaJednostka === 'godziny' ? ' selected' : '') + '>SW: godz.</option></select></td>' +
    '<td><select class="p-op-jednostka" title="Jednostka rocznego limitu opieki nad dzieckiem (Op)"' + (p.forma !== 'etat' ? ' disabled' : '') + '>' +
      '<option value="dni"' + (p.opiekaJednostka !== 'godziny' ? ' selected' : '') + '>Op: dni</option>' +
      '<option value="godziny"' + (p.opiekaJednostka === 'godziny' ? ' selected' : '') + '>Op: godz.</option></select></td>' +
    (pokazPolaMain
      ? '<td style="text-align:center"><input type="checkbox" class="p-sap"' + (flagi.indexOf('starszy_asystent') !== -1 ? ' checked' : '') + '></td>' +
        '<td style="text-align:center"><input type="checkbox" class="p-beznocek"' + (flagi.indexOf('bez_nocek') !== -1 ? ' checked' : '') + '></td>' +
        '<td style="text-align:center"><input type="checkbox" class="p-optout"' + (p.optOutZgoda ? ' checked' : '') + '></td>'
      : '<td style="text-align:center"><input type="checkbox" class="p-dyzur-dzien"' + (typyDyzuru.indexOf('dzien') !== -1 ? ' checked' : '') + '></td>' +
        '<td style="text-align:center"><input type="checkbox" class="p-dyzur-noc"' + (typyDyzuru.indexOf('noc') !== -1 ? ' checked' : '') + '></td>' +
        '<td style="text-align:center"><input type="checkbox" class="p-dyzur-tylko-dzien"' + (typyDyzuru.indexOf('tylko_dzien') !== -1 ? ' checked' : '') + '></td>' +
        '<td style="text-align:center"><input type="checkbox" class="p-dyzur-doba"' + (typyDyzuru.indexOf('doba') !== -1 ? ' checked' : '') + '></td>') +
    '<td><button type="button" class="icon-btn btn-usun-p" title="Usuń"><i class="ti ti-trash"></i></button></td>';
  tr.dataset.id = p.id || '';
  tr.querySelector('.btn-usun-p').addEventListener('click', () => tr.remove());
  tr.querySelector('.p-grupa').addEventListener('change', (ev) => {
    tr.querySelector('.p-stanowisko').innerHTML = opcjeStanowiska(ev.target.value, '');
  });
  tr.querySelector('.p-forma').addEventListener('change', (ev) => {
    const jestEtat = ev.target.value === 'etat';
    const polMin = tr.querySelector('.p-godz-min');
    const polMax = tr.querySelector('.p-godz-max');
    polMin.disabled = jestEtat;
    polMax.disabled = jestEtat;
    if (jestEtat) { polMin.value = ''; polMax.value = ''; }
    tr.querySelector('.p-sw-jednostka').disabled = !jestEtat;
    tr.querySelector('.p-op-jednostka').disabled = !jestEtat;
  });
  return tr;
}

function renderTabelePracownikow() {
  const tbodyMain = document.getElementById('tabela-pracownicy-main-body');
  const tbodyOpie = document.getElementById('tabela-pracownicy-opie-body');
  tbodyMain.innerHTML = '';
  tbodyOpie.innerHTML = '';
  pracownicy.forEach((p) => {
    const jestOpie = p.grupa === 'opie';
    const tr = wierszPracownika(p, !jestOpie);
    (jestOpie ? tbodyOpie : tbodyMain).appendChild(tr);
  });
}

document.getElementById('btn-dodaj-pracownika').addEventListener('click', () => {
  const tbody = document.getElementById(aktywnaGrupa === 'opie' ? 'tabela-pracownicy-opie-body' : 'tabela-pracownicy-main-body');
  const nowyId = 'p' + (Date.now().toString(36));
  const tr = wierszPracownika({ id: nowyId, forma: 'etat', etat: 1, grupa: aktywnaGrupa }, aktywnaGrupa !== 'opie');
  tbody.appendChild(tr);
});

document.getElementById('btn-zapisz-pracownikow').addEventListener('click', async () => {
  const wiersze = Array.from(document.querySelectorAll('#tabela-pracownicy-main-body tr, #tabela-pracownicy-opie-body tr'));
  const nowaLista = wiersze.map((tr, i) => {
    const flagi = [];
    const polSap = tr.querySelector('.p-sap');
    const polBeznocek = tr.querySelector('.p-beznocek');
    const polOptout = tr.querySelector('.p-optout');
    if (polSap && polSap.checked) flagi.push('starszy_asystent');
    if (polBeznocek && polBeznocek.checked) flagi.push('bez_nocek');
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
    if (!pending.kod) {
      // brak planu = pusta komórka, realizacja/zamiana bez planu nie mają sensu
      pending.kodRealizacji = '';
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

sprawdzSesje();
