// =========================================================
// ChargeEase EV - Firebase Cloud Messaging (FCM) Push Service
// =========================================================

const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const ANDROID_CHANNEL_ID = 'chargeease_booking_updates';
const ANDROID_CHANNEL_NAME = 'ChargeEase Booking Updates';

let firebaseAdmin = null;
let fcmState = {
  initialized: false,
  configured: false,
  source: null,
  projectId: null,
  reason: 'Firebase Admin SDK has not been initialized yet.'
};

function parseFirebaseCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      if (parsed && parsed.project_id && parsed.private_key && parsed.client_email) {
        parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
        return { cert: parsed, source: 'FIREBASE_SERVICE_ACCOUNT_JSON' };
      }
    } catch (err) {
      return { error: `Invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${err.message}` };
    }
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    try {
      const jsonStr = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
      const parsed = JSON.parse(jsonStr);
      if (parsed && parsed.project_id && parsed.private_key && parsed.client_email) {
        parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
        return { cert: parsed, source: 'FIREBASE_SERVICE_ACCOUNT_BASE64' };
      }
    } catch (err) {
      return { error: `Invalid FIREBASE_SERVICE_ACCOUNT_BASE64: ${err.message}` };
    }
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      cert: {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: String(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, '\n')
      },
      source: 'FIREBASE_PROJECT_ID+CLIENT_EMAIL+PRIVATE_KEY'
    };
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    if (fs.existsSync(credPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        if (parsed && parsed.project_id && parsed.private_key && parsed.client_email) {
          parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
          return { cert: parsed, source: 'GOOGLE_APPLICATION_CREDENTIALS' };
        }
      } catch (err) {
        return { error: `Invalid GOOGLE_APPLICATION_CREDENTIALS JSON: ${err.message}` };
      }
    } else {
      return { error: `GOOGLE_APPLICATION_CREDENTIALS file not found at ${credPath}` };
    }
  }

  return {
    error: 'Missing Firebase Admin credentials. Set FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_BASE64, FIREBASE_PROJECT_ID+FIREBASE_CLIENT_EMAIL+FIREBASE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS.'
  };
}

function initializeFirebase() {
  if (fcmState.initialized) return fcmState;
  fcmState.initialized = true;

  try {
    firebaseAdmin = require('firebase-admin');
  } catch (err) {
    fcmState.configured = false;
    fcmState.reason = `firebase-admin package not available: ${err.message}`;
    console.warn('[FCM CONFIG]', fcmState.reason);
    return fcmState;
  }

  const credResult = parseFirebaseCredential();
  if (credResult.error || !credResult.cert) {
    fcmState.configured = false;
    fcmState.reason = credResult.error;
    console.warn('[FCM CONFIG]', fcmState.reason, 'In-app notifications will still be saved.');
    return fcmState;
  }

  try {
    if (!firebaseAdmin.apps.length) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(credResult.cert)
      });
    }
    fcmState.configured = true;
    fcmState.source = credResult.source;
    fcmState.projectId = credResult.cert.project_id || credResult.cert.projectId || null;
    fcmState.reason = null;
    console.log(`[FCM] Firebase Admin initialized cleanly (${fcmState.source}, project: ${fcmState.projectId})`);
  } catch (err) {
    fcmState.configured = false;
    fcmState.reason = `Firebase Admin initialization failed: ${err.message}`;
    console.error('[FCM CONFIG ERROR]', fcmState.reason);
  }

  return fcmState;
}

function getFcmStatus() {
  const status = initializeFirebase();
  const activeCountRow = db.prepare('SELECT COUNT(*) AS count FROM device_tokens WHERE is_active = 1').get();
  return {
    configured: Boolean(status.configured),
    source: status.source,
    projectId: status.projectId,
    reason: status.reason,
    channelId: ANDROID_CHANNEL_ID,
    channelName: ANDROID_CHANNEL_NAME,
    storageMode: process.env.VERCEL ? 'ephemeral-tmp-sqlite' : 'persistent-local-sqlite',
    activeRegisteredDevices: activeCountRow ? activeCountRow.count : 0
  };
}

function registerDeviceToken(userId, payload = {}) {
  const token = String(payload.fcmToken || payload.token || '').trim();
  if (!userId) throw new Error('User ID is required to register device token');
  if (!token || token.length < 16) {
    throw new Error('A valid FCM registration token is required');
  }

  const platform = String(payload.platform || 'android').toLowerCase().slice(0, 24);
  const deviceId = payload.deviceId ? String(payload.deviceId).slice(0, 128) : null;
  const deviceName = payload.deviceName ? String(payload.deviceName).slice(0, 128) : 'Android Device';
  const appVersion = payload.appVersion ? String(payload.appVersion).slice(0, 64) : null;

  const existing = db.prepare('SELECT id FROM device_tokens WHERE fcm_token = ?').get(token);
  let id = existing ? existing.id : ('devtok-' + Date.now() + '-' + Math.floor(100 + Math.random() * 900));

  if (existing) {
    db.prepare(`
      UPDATE device_tokens
      SET user_id = ?,
          platform = ?,
          device_id = COALESCE(?, device_id),
          device_name = COALESCE(?, device_name),
          app_version = COALESCE(?, app_version),
          is_active = 1,
          last_seen_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(userId, platform, deviceId, deviceName, appVersion, id);
  } else {
    db.prepare(`
      INSERT INTO device_tokens (id, user_id, fcm_token, platform, device_id, device_name, app_version, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(id, userId, token, platform, deviceId, deviceName, appVersion);
  }

  return db.prepare('SELECT id, user_id, platform, device_id, device_name, app_version, is_active, created_at, updated_at FROM device_tokens WHERE id = ?').get(id);
}

function unregisterDeviceToken(userId, payload = {}) {
  const token = String(payload.fcmToken || payload.token || '').trim();
  const deviceId = payload.deviceId ? String(payload.deviceId).trim() : null;

  if (token) {
    const info = db.prepare(`
      UPDATE device_tokens
      SET is_active = 0, updated_at = datetime('now')
      WHERE fcm_token = ? AND user_id = ?
    `).run(token, userId);
    return { deactivated: info.changes || 0 };
  }

  if (deviceId) {
    const info = db.prepare(`
      UPDATE device_tokens
      SET is_active = 0, updated_at = datetime('now')
      WHERE device_id = ? AND user_id = ?
    `).run(deviceId, userId);
    return { deactivated: info.changes || 0 };
  }

  const info = db.prepare(`
    UPDATE device_tokens
    SET is_active = 0, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(userId);
  return { deactivated: info.changes || 0 };
}

function getUserActiveTokens(userId) {
  return db.prepare('SELECT id, fcm_token, platform, device_name FROM device_tokens WHERE user_id = ? AND is_active = 1').all(userId);
}

function deactivateInvalidToken(fcmToken) {
  try {
    db.prepare("UPDATE device_tokens SET is_active = 0, updated_at = datetime('now') WHERE fcm_token = ?").run(fcmToken);
  } catch (_) {}
}

function serializeDataMap(data = {}) {
  const out = {};
  Object.entries(data).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      out[k] = String(v);
    }
  });
  return out;
}

async function sendUserPushNotification(userId, payload) {
  const status = initializeFirebase();
  const deviceRows = getUserActiveTokens(userId);

  if (!status.configured) {
    return {
      sent: 0,
      failed: 0,
      totalDevices: deviceRows.length,
      configured: false,
      status: 'not_configured',
      reason: status.reason
    };
  }

  if (!deviceRows.length) {
    return {
      sent: 0,
      failed: 0,
      totalDevices: 0,
      configured: true,
      status: 'no_registered_devices'
    };
  }

  const tokens = deviceRows.map(d => d.fcm_token);
  const messaging = firebaseAdmin.messaging();
  const dataPayload = serializeDataMap({
    type: payload.type || 'BOOKING_UPDATE',
    bookingId: payload.bookingId || '',
    bookingReference: payload.bookingReference || '',
    action: payload.action || 'OPEN_BOOKING',
    route: payload.route || 'driver-bookings',
    targetRole: payload.targetRole || 'driver',
    channelId: ANDROID_CHANNEL_ID,
    notificationId: payload.notificationId || '',
    eventKey: payload.eventKey || ''
  });

  const message = {
    tokens,
    notification: {
      title: String(payload.title || 'ChargeEase EV'),
      body: String(payload.body || '')
    },
    data: dataPayload,
    android: {
      priority: 'high',
      collapseKey: payload.bookingReference || payload.bookingId || undefined,
      notification: {
        channelId: ANDROID_CHANNEL_ID,
        title: String(payload.title || 'ChargeEase EV'),
        body: String(payload.body || ''),
        tag: String(payload.eventKey || payload.bookingReference || payload.notificationId || 'chargeease'),
        visibility: 'private',
        sound: 'default'
      }
    }
  };

  try {
    const batchRes = await messaging.sendEachForMulticast(message);
    let deactivated = 0;

    (batchRes.responses || []).forEach((resp, idx) => {
      if (!resp.success && resp.error) {
        const code = resp.error.code || '';
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/mismatched-credential'
        ) {
          deactivateInvalidToken(tokens[idx]);
          deactivated += 1;
        } else {
          console.warn(`[FCM SEND WARN] token[${idx}] failed (${code}): ${resp.error.message}`);
        }
      }
    });

    const deliveryStatus = batchRes.successCount > 0 ? 'sent' : 'failed';
    return {
      sent: batchRes.successCount || 0,
      failed: batchRes.failureCount || 0,
      deactivated,
      totalDevices: tokens.length,
      configured: true,
      status: deliveryStatus
    };
  } catch (err) {
    console.error('[FCM MULTICAST ERROR]', err.message);
    return {
      sent: 0,
      failed: tokens.length,
      totalDevices: tokens.length,
      configured: true,
      status: 'failed',
      reason: err.message
    };
  }
}

async function createAndPushNotification(userId, opts = {}) {
  const {
    title,
    message,
    type = 'booking',
    bookingId = null,
    bookingReference = null,
    eventKey = null,
    action = 'OPEN_BOOKING',
    route = 'driver-bookings',
    targetRole = 'driver',
    link = null
  } = opts;

  if (!userId || !title || !message) return null;

  // Duplicate notification guard on identical (user_id, event_key)
  if (eventKey) {
    const dup = db.prepare('SELECT id, push_status FROM notifications WHERE user_id = ? AND event_key = ? LIMIT 1').get(userId, eventKey);
    if (dup) {
      return { deduplicated: true, notificationId: dup.id, pushStatus: dup.push_status };
    }
  }

  const notifId = 'notif-' + Date.now() + '-' + Math.floor(100 + Math.random() * 900);
  const payloadObj = {
    type,
    bookingId,
    bookingReference,
    action,
    route,
    targetRole,
    channelId: ANDROID_CHANNEL_ID,
    notificationId: notifId
  };

  try {
    db.prepare(`
      INSERT INTO notifications (
        id, user_id, title, message, type, is_read, link,
        booking_id, booking_code, event_key, action_route, payload_json, push_status
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      notifId,
      userId,
      title,
      message,
      type,
      link || route,
      bookingId,
      bookingReference,
      eventKey,
      route,
      JSON.stringify(payloadObj)
    );
  } catch (err) {
    console.error('[NOTIF DB ERROR]', err.message);
    return { error: err.message };
  }

  let pushResult = { status: 'failed', sent: 0 };
  try {
    pushResult = await sendUserPushNotification(userId, {
      title,
      body: message,
      type: type === 'host' ? 'BOOKING_REQUEST' : 'BOOKING_UPDATE',
      bookingId,
      bookingReference,
      action,
      route,
      targetRole,
      notificationId: notifId,
      eventKey
    });
    db.prepare('UPDATE notifications SET push_status = ? WHERE id = ?').run(pushResult.status || 'pending', notifId);
  } catch (err) {
    console.error('[FCM DISPATCH ERROR]', err.message);
  }

  return {
    deduplicated: false,
    notificationId: notifId,
    pushResult
  };
}

module.exports = {
  ANDROID_CHANNEL_ID,
  ANDROID_CHANNEL_NAME,
  initializeFirebase,
  getFcmStatus,
  registerDeviceToken,
  unregisterDeviceToken,
  getUserActiveTokens,
  sendUserPushNotification,
  createAndPushNotification
};
