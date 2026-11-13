import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const manifestPath = join(root, 'android/app/src/main/AndroidManifest.xml');
const stringsPath = join(root, 'android/app/src/main/res/values/strings.xml');
const configPath = join(root, 'capacitor.config.json');

if (!existsSync(manifestPath)) {
  console.error('[patch] AndroidManifest tidak ditemukan. Jalankan `npx cap add android` dulu.');
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
const appId = cfg.appId || 'com.coingame.coinrush';
const admobTest = process.env.AD_TEST !== 'false';
const admobAppId =
  process.env.ADMOB_APP_ID ||
  (admobTest ? 'ca-app-pub-3940256099942544~3347511713' : 'ca-app-pub-9652943365143964~2114970865');

let manifest = readFileSync(manifestPath, 'utf8');

const admobMeta = `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${admobAppId}" />`;
if (manifest.includes('com.google.android.gms.ads.APPLICATION_ID')) {
  manifest = manifest.replace(
    /<meta-data\s+android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"\s+android:value="[^"]*"\s*\/>/,
    admobMeta,
  );
} else {
  manifest = manifest.replace('</application>', `        ${admobMeta}\n    </application>`);
}

if (!manifest.includes(`android:scheme="${appId}"`)) {
  const schemeIntent =
    `<intent-filter>\n` +
    `                <action android:name="android.intent.action.VIEW" />\n` +
    `                <category android:name="android.intent.category.DEFAULT" />\n` +
    `                <category android:name="android.intent.category.BROWSABLE" />\n` +
    `                <data android:scheme="${appId}" />\n` +
    `            </intent-filter>`;
  manifest = manifest.replace('</activity>', `            ${schemeIntent}\n        </activity>`);
}

if (!manifest.includes('com.google.android.gms.permission.AD_ID')) {
  manifest = manifest.replace(
    '</manifest>',
    `    <uses-permission android:name="com.google.android.gms.permission.AD_ID" />\n</manifest>`,
  );
}

writeFileSync(manifestPath, manifest);

if (existsSync(stringsPath)) {
  let strings = readFileSync(stringsPath, 'utf8');
  if (strings.includes('name="admob_app_id"')) {
    strings = strings.replace(
      /<string name="admob_app_id">[^<]*<\/string>/,
      `<string name="admob_app_id">${admobAppId}</string>`,
    );
  } else {
    strings = strings.replace('</resources>', `    <string name="admob_app_id">${admobAppId}</string>\n</resources>`);
  }
  writeFileSync(stringsPath, strings);
}

console.log(`[patch] AndroidManifest siap (appId=${appId}, admob=${admobAppId})`);