# Coin Rush

Game cari coin + withdraw berbasis PWA, Express, MariaDB, dan Capacitor Android.

## Fitur

- Login Google dan email/password
- Game Coin Rush (tangkap coin)
- Roda keberuntungan dengan rewarded ad
- Misi harian dan referral
- Dompet + pencairan (18+)
- Interstitial AdMob
- PWA + Android APK
- Build APK otomatis via GitHub Actions

## Stack

- Node.js 18+ / Express
- MariaDB/MySQL
- Capacitor 6 + Android
- Google Sign-In
- AdMob (rewarded + interstitial)
- Tailscale untuk akses server

## Struktur

```
public/          # PWA (HTML, CSS, JS)
server/          # Express API
scripts/         # init DB, migrasi, patch Android
.github/         # workflow build APK
schema.sql       # skema database
.env.example     # contoh environment
```

## Setup lokal / Termux

```bash
npm ci
cp .env.example .env
# edit .env
npm run db:init
npm run db:migrate
npm start
```

Cek server:

```bash
curl http://127.0.0.1:3000/api/health
```

## Environment

File `.env` tidak masuk repo. Isi minimal:

- `PORT=3000`
- `NODE_ENV=production`
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `JWT_SECRET` (random panjang)
- `GOOGLE_CLIENT_ID`
- `ADMIN_EMAILS`
- `COIN_PER_RUPIAH`
- `MIN_WITHDRAW_IDR`
- `MAX_WITHDRAW_PER_DAY`
- `WITHDRAW_PRESETS`
- `ROUND_*`
- `WHEEL_*`
- `REFERRAL_*`
- `ONLINE_WINDOW_SECONDS`
- `HEARTBEAT_SECONDS`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (opsional)
- `INSTALL_BONUS_COIN`

## Database

```bash
npm run db:init
npm run db:migrate
```

Migrasi menambahkan `password_hash`, membuat `google_sub` nullable, dan unique index email.

## Run

```bash
npm start
```

Atau mode development:

```bash
npm run dev
```

## Build APK

### GitHub Actions (disarankan)

Buka tab **Actions** → **Coinrush** → **Run workflow**.

Input:

- `api_base_url` — URL API, contoh `https://localhost-0.tail5bd7b7.ts.net`
- `rewarded_ad_id` — rewarded ad unit ID
- `interstitial_ad_id` — interstitial ad unit ID
- `admob_app_id` — AdMob App ID
- `ad_test` — `true` untuk test ad, `false` untuk real ad

Artifact:

- `coinrush-debug-apk` — untuk tes cepat
- `coinrush-release-apk` — untuk review AdMob

### Build lokal

```bash
npx cap add android
npx cap sync android
cd android
./gradlew assembleRelease -x lintVitalRelease
```

Sign APK pakai `apksigner`.

## Tailscale

### Pakai app Tailscale Android

1. Install Tailscale dari Play Store/F-Droid.
2. Login ke tailnet yang sama.
3. Aktifkan VPN.
4. Jalankan server di `0.0.0.0:3000`.

### Pakai CLI di Ubuntu/Termux

```bash
tailscale up --hostname=localhost-0
tailscale serve --bg --https=443 http://127.0.0.1:3000
```

Cek:

```bash
tailscale status
```

## Pindah ke RDP

### 1. Akses & OS

- RDP bisa login, ada akses internet, bisa install software.
- Ubuntu 22.04/24.04 atau Windows Server.
- Ubuntu: install `git`, `curl`, `nodejs`, `npm`, `mariadb-server`.
- Windows: install Node.js LTS, Git, MariaDB/MySQL.

### 2. Source code

```bash
git clone https://github.com/williamcassanova/coinrush.git
cd coinrush
git checkout main
```

`.env` dan `android/` tidak ada di repo. Keduanya harus dibuat manual.

### 3. File `.env`

Buat dari `.env.example`, isi semua nilai yang diperlukan.

Catatan:

- `JWT_SECRET` harus sama dengan server lama kalau data user ikut dipindah, supaya session tidak logout semua.
- `ADMIN_EMAILS` menentukan role admin.
- `GOOGLE_CLIENT_ID` harus sesuai dengan OAuth client di Google Cloud Console.

### 4. Database

```bash
npm ci
npm run db:init
npm run db:migrate
```

Kalau ada data lama:

```bash
# di server lama
mysqldump -u root -p coin_game > coin_game.sql

# di RDP
mysql -u root -p coin_game < coin_game.sql
```

### 5. Node.js app

```bash
npm ci
npm start
```

Agar tetap hidup:

- Ubuntu: PM2 atau systemd service.
- Windows: PM2, NSSM, atau Task Scheduler.

Contoh PM2:

```bash
npm install -g pm2
pm2 start server/index.js --name coinrush
pm2 save
pm2 startup
```

### 6. Reverse proxy / HTTPS

- Pakai Nginx/Caddy + Let's Encrypt kalau pakai domain.
- Atau pakai Tailscale Serve:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3000
```

Jangan expose port MariaDB ke internet.

### 7. Tailscale

- Install Tailscale di RDP.
- Login ke tailnet yang sama.
- Hostname mesin harus cocok dengan `API_BASE_URL` di APK.
- Kalau hostname beda, ganti hostname Tailscale atau rebuild APK dengan URL baru.

### 8. Build APK

Cara paling mudah: tetap pakai GitHub Actions.

Kalau build lokal:

- Install Java 17.
- Install Android SDK dan set `ANDROID_HOME`/`ANDROID_SDK_ROOT`.
- Jalankan `npx cap add android`, `npx cap sync android`, lalu `assembleRelease`.

### 9. Google Sign-In & keystore

- Google OAuth client Android harus punya SHA-1 dari keystore APK.
- Kalau keystore berubah, Google Sign-In bisa gagal.
- Di GitHub Actions, set secret:
  - `ANDROID_KEYSTORE_BASE64`
  - `ANDROID_KEYSTORE_PASSWORD`
  - `ANDROID_KEY_ALIAS`
- Daftarkan SHA-1 keystore tersebut di Google Cloud Console.

### 10. AdMob & privacy

- App ID: `ca-app-pub-9652943365143964~2114970865`
- Rewarded: `ca-app-pub-9652943365143964/1296713218`
- Interstitial: `ca-app-pub-9652943365143964/8029963321`
- Privacy policy harus bisa diakses publik, contoh `https://domain-kamu/privacy.html`.
- `app-ads.txt` harus ada di domain developer.
- Kalau pindah domain, update URL privacy policy di AdMob dan `app-ads.txt`.

### 11. Timezone

- Withdraw harian memakai `CURDATE()`.
- Kalau RDP UTC, reset harian bisa jam 07:00 WIB.
- Set timezone OS/MariaDB ke `Asia/Jakarta` atau sesuaikan.

### 12. Monitoring & backup

- `pm2 status`, `pm2 logs`.
- Cek `/api/health` berkala.
- Backup DB rutin dengan `mysqldump`.
- Backup `.env` dan keystore.
- Jangan masukkan `.env` atau keystore ke repo.

## Checklist singkat

1. Siapkan RDP + Node.js + MariaDB.
2. Clone repo.
3. Buat `.env`.
4. `npm ci`.
5. `npm run db:init` dan `npm run db:migrate`.
6. Import DB lama kalau ada.
7. `npm start` / PM2.
8. Pasang Tailscale + serve.
9. Build APK via GitHub Actions.
10. Tes login, game, wheel, interstitial, withdraw.
11. Update privacy policy dan `app-ads.txt` kalau domain berubah.

## Catatan penting

- `.env` dan `android/` tidak masuk repo.
- Jangan commit secret atau keystore.
- Real money withdrawal berisiko ditolak AdMob karena kebijakan real-money gaming.
- Pakai test ads sampai app di-approve AdMob.