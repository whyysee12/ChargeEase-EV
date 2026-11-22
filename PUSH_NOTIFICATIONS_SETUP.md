# ChargeEase EV — Firebase Cloud Messaging (FCM) & Native Android Push Setup

This guide walks through configuring **real Android phone push notifications** (notification shade, lock screen, foreground, background, and terminated/closed-app states) for ChargeEase EV (`com.chargeease.ev`) using Capacitor 8 and Firebase Admin SDK.

---

## 1. Create a Firebase Project

1. Open the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** (or **Create a project**) and enter a name such as `ChargeEase EV`.
3. Choose whether to enable Google Analytics and click **Create project**.

---

## 2. Register Android Package `com.chargeease.ev`

1. In your Firebase project overview, click the **Android** icon (`Add app > Android`).
2. Enter **Android package name** **exact match**:
   ```
   com.chargeease.ev
   ```
3. Enter app nickname `ChargeEase EV`.
4. (Optional) Add your debug SHA-1 from `~/.android/debug.keystore` using `keytool -list -v -alias androiddebugkey -keystore ~/.android/debug.keystore`.
5. Click **Register app**.

---

## 3. Enable Firebase Cloud Messaging (FCM)

1. In the Firebase Console left sidebar, open **Build > Messaging** (or **Engage > Messaging**).
2. Also open **Project settings (gear icon) > Cloud Messaging** and confirm **Firebase Cloud Messaging API (V1)** is **Enabled** (`firebase-admin` uses the HTTP v1 Messaging API).

---

## 4. Download `google-services.json`

1. During the Android app setup (or anytime under **Project settings > Your apps > ChargeEase EV (Android)**), click **Download `google-services.json`**.
2. Do **not** commit `google-services.json` to public GitHub repositories (`google-services.json` is already ignored in `.gitignore`).

---

## 5. Put `google-services.json` in Android App Module

Copy the downloaded file into your Capacitor Android project at:

```text
android/app/google-services.json
```

---

## 6. Configure Android Gradle (`google-services`, FCM, Notification Permission)

In your Capacitor Android Gradle files:

1. **Root `android/build.gradle`**:
   Ensure the Google Services classpath is present under `buildscript.dependencies`:
   ```groovy
   dependencies {
       classpath 'com.android.tools.build:gradle:8.13.0'
       classpath 'com.google.gms:google-services:4.4.2'
   }
   ```
2. **App `android/app/build.gradle`**:
   Apply the Google Services plugin (at top or bottom of `android/app/build.gradle`):
   ```groovy
   apply plugin: 'com.google.gms.google-services'
   ```
   Ensure `compileSdkVersion >= 34` and `targetSdkVersion >= 33` so Android 13+ `POST_NOTIFICATIONS` runtime permissions work cleanly.
3. **Manifest `android/app/src/main/AndroidManifest.xml`**:
   Ensure internet + notification permissions exist inside `<manifest>`:
   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
   ```
   And optionally declare the default notification icon/color/channel inside `<application>`:
   ```xml
   <meta-data
       android:name="com.google.firebase.messaging.default_notification_channel_id"
       android:value="chargeease_booking_updates" />
   ```

---

## 7. Configure Firebase Admin Service Account on Backend

1. In Firebase Console, go to **Project settings > Service accounts**.
2. Click **Generate new private key** and download the JSON file safely (never commit this file to GitHub).
3. Configure **one** of these environment variables in your backend `.env` (for local `node server.js`) AND in **Vercel Dashboard > Project > Settings > Environment Variables**:
   - **Recommended for Vercel (`FIREBASE_SERVICE_ACCOUNT_BASE64`)**:
     Base64-encode your service-account JSON file cleanly and set `FIREBASE_SERVICE_ACCOUNT_BASE64`.
     - PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json"))`
     - macOS/Linux: `base64 -w 0 service-account.json`
   - **Or `FIREBASE_SERVICE_ACCOUNT_JSON`**:
     Single-line JSON string of the service account key.
   - **Or discrete variables**:
     ```env
     FIREBASE_PROJECT_ID=your-project-id
     FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
     FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
     ```
   - **Or local file path (`GOOGLE_APPLICATION_CREDENTIALS`)**:
     ```env
     GOOGLE_APPLICATION_CREDENTIALS=./firebase-adminsdk.json
     ```

> **Production Persistence Note:** Local `node server.js` persists `device_tokens` and `bookings` permanently in `chargeease.db`. On Vercel serverless deployments, SQLite lives in ephemeral `/tmp/chargeease.db` per container instance; migrating to a persistent cloud database (such as Supabase Postgres or Turso LibSQL) is recommended for production multi-container push token persistence.

---

## 8. Install Capacitor 8 Push & Local Notification Plugins

In your Capacitor Android workspace root (matching your installed Capacitor 8 version):

```bash
npm install firebase-admin @capacitor/push-notifications@^8.0.0 @capacitor/local-notifications@^8.0.0
```

Also verify `capacitor.config.json` includes `server.url` (or bundled `www/`), and ensure `LocalNotifications` + `PushNotifications` permissions/channel setup match `chargeease_booking_updates`.

---

## 9. Sync and Rebuild the Android APK

1. Copy the updated frontend assets (`index.html`, `styles.css`, `app.js`, `app-config.js`) into `www/` (if building bundled assets) and sync native plugins:
   ```bash
   npx cap sync android
   ```
2. Open Android Studio (`npx cap open android`) or run Gradle CLI build:
   ```bash
   cd android
   ./gradlew assembleDebug
   ```
3. Install `android/app/build/outputs/apk/debug/app-debug.apk` on a real Android phone or Google Play Services Android emulator (`adb install -r android/app/build/outputs/apk/debug/app-debug.apk`).

---

## 10. Test Real Phone Push Notifications End-to-End

1. Sign in as **Host** (`host@chargeease.com` / `Host@123`) on Android Phone A and accept the Android 13+ notification permission prompt. Verify `GET /api/notifications/push-status` shows `configured: true` and `myDeviceCount >= 1`.
2. Sign in as **Driver** (`driver@chargeease.com` / `Driver@123`) on Phone B (or web), accept notifications, and submit a booking request on Host's charger (`ce-del-sec137` / any dock owned by `usr-host-01`).
3. Verify:
   - **Host Phone (even closed/swiped from recents):** Receives `"New Charging Booking Request"` in the Android notification shade. Tapping it opens **Host Console > Booking requests** highlighted.
   - **Host taps Accept Booking (with contact consent checked):** Both **Driver Phone** (`"Your EV Charging Session Is Confirmed! ✅"`) and **Host Phone** (`"Charging Session Scheduled! ✅"`) receive real Android system notifications.
   - **Foreground check:** Keep ChargeEase open in the foreground while triggering Accept/Reject/Request — `@capacitor/local-notifications` schedules an Android system-tray banner on channel `chargeease_booking_updates`.
   - **Contact Sharing:** Both Driver (**My Bookings**) and Host (**Host Console**) see **Call**, **Copy Phone Number**, and **WhatsApp Contact** links once confirmed & consented.
   - **Host rejects pending booking:** Driver receives `"Booking Request Declined"` push notification and a single wallet refund.
