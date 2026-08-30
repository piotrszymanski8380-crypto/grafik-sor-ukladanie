// public/podglad.js — publiczny, tylko-do-odczytu widok OPUBLIKOWANEGO grafiku.
// Bez logowania. Nigdy nie pokazuje wersji roboczej ani ostrzeżeń administratora.
const NAZWY_MIESIECY = ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'];
const ETYKIETY_KODOW = {
  '': '—', D: 'D', N: 'N', DOBA: 'DOBA', W: 'W', UW: 'UW', CH: 'CH', DCH: 'DCH', NCH: 'NCH', S: 'S',
  SW: 'SW', Op: 'Op', Us: 'Us', Uo: 'Uo', Ub: 'Ub', Um: 'Um', Nn: 'Nn', Nun: 'Nun', Nup: 'Nup', Zr: 'Zr', Wn: 'Wn', Ws: 'Ws',
};
const OPISY_KODOW = {
  D: 'dyżur 12h - dzień', N: 'dyżur 12h - noc', DOBA: 'dyżur 24h', W: 'wolne',
  UW: 'urlop wypoczynkowy', CH: 'zwolnienie lekarskie', S: 'szkolenie obowiązkowe',
  SW: 'siła wyższa', Op: 'opieka nad dzieckiem do lat 14', Us: 'urlop szkoleniowy',
  Uo: 'urlop okolicznościowy', Ub: 'urlop bezpłatny', Um: 'urlop macierzyński/rodzicielski',
  Nn: 'nieobecność NIEusprawiedliwiona', Nun: 'nieobecność usprawiedliwiona niepłatna',
  Nup: 'nieobecność usprawiedliwiona płatna', Zr: 'zasiłek rehabilitacyjny',
  Wn: 'odbiór za niedzielę/święto', Ws: 'odbiór za sobotę',
};

function liczbaDniMiesiaca(r, m) { return new Date(r, m, 0).getDate(); }
function dataStr(r, m, d) { return r + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
function jestWeekend(r, m, d) { const dz = new Date(r, m - 1, d).getDay(); return dz === 0 || dz === 6; }

let ostatnieDane = null, ostatniRok = null, ostatniMiesiac = null;

function nazwiskoPo(pracownicy, id) {
  const p = pracownicy.find((x) => x.id === id);
  return p ? p.imieNazwisko : '?';
}

// chipPlanHtml/chipRealizacjiHtml — ta sama logika co w panelu admina (public/admin.js):
// siatka jest na stałe dwuwierszowa na osobę (plan / realizacja, wzorem płachty).
// Podgląd jest tylko-do-odczytu, bez obsługi kliknięcia/przeciągania.
function chipPlanHtml(w, pracownicy) {
  const kod = w ? w.kod : '';
  let html = '<span class="kod-chip k-' + (kod || 'brak') + '"' + (OPISY_KODOW[kod] ? ' title="' + OPISY_KODOW[kod] + '"' : '') + '>' + (ETYKIETY_KODOW[kod] || kod || '—') + '</span>';
  if (w && w.zamianaZId) {
    html += '<span class="zamiana-dot" title="Zamiana z ' + nazwiskoPo(pracownicy, w.zamianaZId) + '">⇄</span>';
  }
  return html;
}
function chipRealizacjiHtml(w) {
  const kod = w ? w.kod : '';
  const kodRealizacji = w && w.kodRealizacji ? w.kodRealizacji : '';
  if (!kodRealizacji || kodRealizacji === kod) return '';
  return '<span class="kod-chip small k-' + kodRealizacji + '"' + (OPISY_KODOW[kodRealizacji] ? ' title="' + OPISY_KODOW[kodRealizacji] + '"' : '') + '>' + (ETYKIETY_KODOW[kodRealizacji] || kodRealizacji) + '</span>';
}

function tabelaGrafiku(grupa, tytul, rok, miesiac, pracownicy, wpisy) {
  const osoby = pracownicy.filter((p) => p.grupa === grupa);
  if (!osoby.length) return '';
  const dni = liczbaDniMiesiaca(rok, miesiac);
  let html = '<h3 style="margin:18px 0 8px; text-transform:none; font-size:14px; color:var(--text)">' + tytul + '</h3>';
  html += '<div class="grid-scroll"><table class="grid"><colgroup><col class="col-nazwa">';
  for (let d = 1; d <= dni; d++) html += '<col>';
  html += '</colgroup><thead><tr><th class="nazwa">Pracownik</th>';
  for (let d = 1; d <= dni; d++) html += '<th' + (jestWeekend(rok, miesiac, d) ? ' class="weekend"' : '') + '>' + d + '</th>';
  html += '</tr></thead><tbody>';
  osoby.forEach((p) => {
    const sap = (p.flagi && p.flagi.includes('starszy_asystent')) ? ' 🩺' : '';
    html += '<tr class="wiersz-plan"><td class="nazwa" rowspan="2">' + p.imieNazwisko + sap + '</td>';
    for (let d = 1; d <= dni; d++) {
      const dataX = dataStr(rok, miesiac, d);
      const wpis = wpisy.find((w) => w.pracownikId === p.id && w.data === dataX && w.slot === 1);
      html += '<td class="dzien' + (jestWeekend(rok, miesiac, d) ? ' weekend' : '') + '">' + chipPlanHtml(wpis, pracownicy) + '</td>';
    }
    html += '</tr><tr class="wiersz-realizacja">';
    for (let d = 1; d <= dni; d++) {
      const dataX = dataStr(rok, miesiac, d);
      const wpis = wpisy.find((w) => w.pracownikId === p.id && w.data === dataX && w.slot === 1);
      html += '<td class="dzien' + (jestWeekend(rok, miesiac, d) ? ' weekend' : '') + '">' + chipRealizacjiHtml(wpis) + '</td>';
    }
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

// arkuszGrupy — jak w panelu admina: dwa wiersze na osobę (plan z adnotacją
// zamiany / realizacja tylko tam, gdzie różni się od planu).
function arkuszGrupy(grupa, pracownicy, wpisy, rok, miesiac) {
  const osoby = pracownicy.filter((p) => p.grupa === grupa);
  const dni = liczbaDniMiesiaca(rok, miesiac);
  const naglowek = ['Pracownik'];
  for (let d = 1; d <= dni; d++) naglowek.push(String(d));
  const wiersze = [naglowek];
  osoby.forEach((p) => {
    const wierszPlan = [p.imieNazwisko];
    const wierszRealizacja = [''];
    for (let d = 1; d <= dni; d++) {
      const dataX = dataStr(rok, miesiac, d);
      const w = wpisy.find((x) => x.pracownikId === p.id && x.data === dataX && x.slot === 1);
      const kod = w ? w.kod || '' : '';
      const zamiana = w && w.zamianaZId ? '-' + nazwiskoPo(pracownicy, w.zamianaZId) : '';
      wierszPlan.push(kod + zamiana);
      const kodRealizacji = w && w.kodRealizacji && w.kodRealizacji !== kod ? w.kodRealizacji : '';
      wierszRealizacja.push(kodRealizacji);
    }
    wiersze.push(wierszPlan);
    if (wierszRealizacja.some((v) => v)) wiersze.push(wierszRealizacja);
  });
  return XLSX.utils.aoa_to_sheet(wiersze);
}

document.getElementById('btn-drukuj').addEventListener('click', () => window.print());

document.getElementById('btn-eksport-excel').addEventListener('click', () => {
  if (!ostatnieDane) { alert('Najpierw wczytaj opublikowany grafik przyciskiem „Pokaż".'); return; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, arkuszGrupy('main', ostatnieDane.pracownicy, ostatnieDane.stan.wpisy, ostatniRok, ostatniMiesiac), 'main');
  XLSX.utils.book_append_sheet(wb, arkuszGrupy('opie', ostatnieDane.pracownicy, ostatnieDane.stan.wpisy, ostatniRok, ostatniMiesiac), 'opie');
  XLSX.writeFile(wb, 'grafik-' + String(ostatniMiesiac).padStart(2, '0') + '-' + ostatniRok + '.xlsx');
});

function formularzHasla(blad) {
  return '<div class="card login-box" style="margin:40px auto">' +
    '<h2 style="text-align:center">Wymagane hasło</h2>' +
    '<p class="subtitle" style="text-align:center">Administrator włączył ochronę hasłem dla tego podglądu.</p>' +
    (blad ? '<div class="msg err">' + blad + '</div>' : '') +
    '<form id="form-haslo-podgladu-widok">' +
    '<div class="row" style="flex-direction:column; align-items:stretch; gap:8px">' +
    '<input type="password" id="haslo-podgladu-pole" placeholder="Hasło dostępu" autocomplete="current-password">' +
    '<button class="btn" type="submit">Pokaż grafik</button>' +
    '</div></form></div>';
}

async function onLoginPodglad(ev) {
  ev.preventDefault();
  const haslo = document.getElementById('haslo-podgladu-pole').value;
  const res = await fetch('/api/login-podglad', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ haslo }),
  });
  const dane = await res.json().catch(() => ({}));
  if (!res.ok) {
    document.getElementById('tresc').innerHTML = formularzHasla(dane.error || 'Błędne hasło.');
    document.getElementById('form-haslo-podgladu-widok').addEventListener('submit', onLoginPodglad);
    return;
  }
  pokazGrafik();
}

async function pokazGrafik() {
  const rok = Number(document.getElementById('pole-rok').value);
  const miesiac = Number(document.getElementById('pole-miesiac').value);
  const tresc = document.getElementById('tresc');
  tresc.innerHTML = '<p class="note">Wczytywanie…</p>';

  // widok=podglad - patrz komentarz w api/grafik.js (2026-08-30): wymusza
  // publiczną gałąź odpowiedzi (pole opublikowany), nawet gdy w tej samej
  // przeglądarce jest aktywna sesja admina (np. wejście z panelu admina
  // przełącznikiem "Podgląd (personel)").
  const res = await fetch('/api/grafik?rok=' + rok + '&miesiac=' + miesiac + '&widok=podglad', { credentials: 'same-origin' });

  if (res.status === 401) {
    ostatnieDane = null;
    tresc.innerHTML = formularzHasla();
    document.getElementById('form-haslo-podgladu-widok').addEventListener('submit', onLoginPodglad);
    return;
  }

  const dane = await res.json();

  if (!dane.opublikowany) {
    ostatnieDane = null;
    // Dopisane 2026-08-30 ("nie widzę opublikowanego grafiku") - najczęstsza
    // przyczyna to po prostu inny miesiąc/rok niż ten, który układający
    // opublikował, więc jawna podpowiedź, żeby sprawdzić pola Rok/Miesiąc wyżej.
    tresc.innerHTML = '<div class="card"><p class="note" style="font-style:italic">Grafik na ' + miesiac + '.' + rok + ' nie został jeszcze opublikowany.</p>' +
      '<p class="note">Sprawdź, czy wybrany jest właściwy rok i miesiąc (pola wyżej) - grafik mógł zostać opublikowany na inny okres.</p></div>';
    return;
  }

  ostatnieDane = dane;
  ostatniRok = rok;
  ostatniMiesiac = miesiac;

  const html =
    '<div class="card">' +
    '<h2 style="display:flex; align-items:center; gap:10px">Grafik ' + NAZWY_MIESIECY[miesiac - 1] + ' ' + rok + ' <span class="badge opublikowany">opublikowany</span></h2>' +
    tabelaGrafiku('main', 'Pielęgniarki / ratownicy', rok, miesiac, dane.pracownicy, dane.stan.wpisy) +
    tabelaGrafiku('opie', 'Opiekunowie', rok, miesiac, dane.pracownicy, dane.stan.wpisy) +
    '</div>';
  tresc.innerHTML = html;
}

(function start() {
  const teraz = new Date();
  document.getElementById('pole-rok').value = teraz.getFullYear();
  const selMies = document.getElementById('pole-miesiac');
  selMies.innerHTML = NAZWY_MIESIECY.map((n, i) => '<option value="' + (i + 1) + '">' + (i + 1) + ' — ' + n + '</option>').join('');
  selMies.value = teraz.getMonth() + 1;
  document.getElementById('btn-wczytaj').addEventListener('click', pokazGrafik);
  pokazGrafik();
})();
