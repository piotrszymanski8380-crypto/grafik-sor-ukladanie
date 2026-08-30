# Jak wdrożyć — Render

Appka to jeden, cały czas działający proces Node (`server.js`) — bez Vercela,
bez funkcji serverless. To sam w sobie eliminuje bug z poprzedniej wersji
(niespójne dane między panelem admina a podglądem): jest tylko jeden proces,
więc każde żądanie widzi te same, aktualne dane.

## 1. Wrzuć kod na GitHub

Tak jak poprzednio — nowe repo (albo nowa gałąź w istniejącym), upload przez
GitHub w przeglądarce albo `git push`.

## 2. Utwórz Web Service na Render

1. Render → **New** → **Web Service** → połącz repo z GitHuba.
2. **Build Command**: `npm install`
3. **Start Command**: `node server.js`
4. **Instance Type**: dowolny płatny plan (masz już płatne konto) — potrzebny
   do trwałego dysku, patrz krok 3.

## 3. Podłącz trwały dysk (Persistent Disk)

To zastępuje Upstash Redis z poprzedniej wersji — appka i tak umie zapisywać
lokalnie (`lib/store.js`), tylko trzeba dać jej dysk, który przetrwa restart.

1. W ustawieniach usługi → **Disks** → **Add Disk**.
2. **Mount Path**: `/var/data` (albo dowolna inna ścieżka — ważne, żeby
   pasowała do zmiennej `DATA_DIR` w kroku 4).
3. **Size**: 1 GB w zupełności wystarczy (same pliki JSON).

## 4. Zmienne środowiskowe (Render → Environment)

| Zmienna | Wartość | Uwagi |
|---|---|---|
| `ADMIN_PASSWORD` | (Twoje hasło startowe) | Tylko przy PIERWSZYM uruchomieniu — potem hasło żyje w zapisanych danych, zmieniasz je z panelu admina. |
| `SESSION_SECRET` | (długi losowy ciąg, np. wygenerowany `openssl rand -hex 32`) | Bez tego wszyscy wylogowują się przy każdym redeployu. |
| `DATA_DIR` | `/var/data` | MUSI być identyczna ze ścieżką z kroku 3. |
| `NODE_ENV` | `production` | Drobna optymalizacja (appka nie czyści cache require() na każde żądanie). |

## 5. Deploy

Render sam zbuduje i uruchomi appkę po pierwszym pushu, a potem przy każdym
kolejnym (auto-deploy z GitHuba, jak poprzednio na Vercelu). Adres appki
znajdziesz w Render → usługa → u góry strony.

- Panel admina: `https://twoja-appka.onrender.com/admin.html`
- Podgląd: `https://twoja-appka.onrender.com/podglad.html`

## 6. Test po wdrożeniu

1. Zaloguj się do panelu admina (`ADMIN_PASSWORD` z kroku 4).
2. Dodaj testowego pracownika, zapisz.
3. Otwórz podgląd w drugiej karcie (albo incognito) — powinien widzieć tego
   samego pracownika od razu, bez rozjazdu jak wcześniej.
4. Opublikuj grafik i sprawdź, że podgląd pokazuje wersję opublikowaną.
5. Poczekaj chwilę i odśwież panel/podgląd jeszcze raz — dane powinny zostać
   (to jest właśnie test na to, czy dysk faktycznie jest podłączony poprawnie).

## Lokalny development (bez Render)

```
ADMIN_PASSWORD=test1234 SESSION_SECRET=dowolny-sekret npm run dev
```

Otwiera się na `http://localhost:3000`. Dane lądują w `./data/` (katalog w
repo, ale w `.gitignore` — nigdy nie trafia do GitHuba).
