// =========================================================
// ChargeEase EV - Authentication, Security & RBAC Middleware
// =========================================================

const crypto = require('crypto');
const { db, hashPassword, verifyPassword } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'chargeease-ev-hackathon-secure-secret-key-2026';
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Base64URL encoding/decoding helpers
function base64UrlEncode(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return JSON.parse(Buffer.from(str, 'base64').toString('utf8'));
}

// Generate secure signed JWT
function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(header);
  const now = Date.now();
  const tokenPayload = {
    ...payload,
    iat: now,
    exp: now + TOKEN_EXPIRY_MS
  };
  const encodedPayload = base64UrlEncode(tokenPayload);
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${signature}`;
}

// Verify and decode JWT
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const data = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (signature !== expectedSig) return null;

  try {
    const payload = base64UrlDecode(encodedPayload);
    if (Date.now() > payload.exp) return null; // Token expired
    return payload;
  } catch (e) {
    return null;
  }
}

function rehydrateUserFromToken(tokenOrDecoded) {
  const decoded = typeof tokenOrDecoded === 'string' ? verifyToken(tokenOrDecoded) : tokenOrDecoded;
  if (!decoded || !decoded.userId || !decoded.email || !decoded.role) return null;

  const cleanEmail = String(decoded.email).toLowerCase().trim();
  const hasValidHash = typeof decoded.password_hash === 'string' && decoded.password_hash.includes(':');
  let user = db.prepare('SELECT id, email, role, name, phone, wallet_balance, is_verified, is_suspended, password_hash FROM users WHERE id = ?').get(decoded.userId);
  if (!user) {
    user = db.prepare('SELECT id, email, role, name, phone, wallet_balance, is_verified, is_suspended, password_hash FROM users WHERE email = ?').get(cleanEmail);
  }

  if (user && hasValidHash && user.password_hash !== decoded.password_hash) {
    try {
      db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(decoded.password_hash, user.id);
      user.password_hash = decoded.password_hash;
    } catch (_) {}
  }

  if (!user) {
    try {
      const safeRole = ['driver', 'host', 'admin'].includes(decoded.role) ? decoded.role : 'driver';
      const defaultBal = typeof decoded.wallet_balance === 'number'
        ? decoded.wallet_balance
        : (safeRole === 'driver' ? 500.00 : 0.00);
      const storedPassHash = hasValidHash
        ? decoded.password_hash
        : hashPassword('rehydrated-' + decoded.userId);

      db.prepare(`
        INSERT OR IGNORE INTO users (id, email, password_hash, role, name, phone, wallet_balance, is_verified, is_suspended)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)
      `).run(
        decoded.userId,
        cleanEmail,
        storedPassHash,
        safeRole,
        decoded.name || 'ChargeEase User',
        decoded.phone || '+91 98000 00000',
        defaultBal
      );

      if (safeRole === 'driver') {
        db.prepare(`
          INSERT OR IGNORE INTO driver_profiles (id, user_id, license_no, emergency_contact, safety_buffer_pct)
          VALUES (?, ?, ?, ?, 20.0)
        `).run('dp-' + decoded.userId, decoded.userId, 'DL-REHYD-01', decoded.phone || '');

        if (decoded.vehicle) {
          const v = decoded.vehicle;
          db.prepare(`
            INSERT OR IGNORE INTO vehicles (id, user_id, manufacturer, model, battery_capacity_kwh, connector_type, registration_no, current_soc, is_primary)
            VALUES (?, ?, ?, ?, ?, ?, ?, 50.0, 1)
          `).run(
            v.id || ('veh-' + decoded.userId),
            decoded.userId,
            v.manufacturer || 'Ola Electric',
            v.model || 'Ola S1 Pro',
            parseFloat(v.battery_capacity_kwh) || 4.0,
            v.connector_type || '16A 3-Pin',
            v.registration_no || 'DL 3S ET 1001'
          );
        }
      } else if (safeRole === 'host') {
        const hp = decoded.hostProfile || {};
        db.prepare(`
          INSERT OR IGNORE INTO host_profiles (id, user_id, address, city, pincode, upi_id, verification_status, rating)
          VALUES (?, ?, ?, ?, ?, ?, 'verified', 5.0)
        `).run(
          'hp-' + decoded.userId,
          decoded.userId,
          hp.address || 'Verified Host Site',
          hp.city || 'Delhi NCR',
          hp.pincode || '201301',
          hp.upi_id || ''
        );
      }

      user = db.prepare('SELECT id, email, role, name, phone, wallet_balance, is_verified, is_suspended, password_hash FROM users WHERE id = ? OR email = ?').get(decoded.userId, cleanEmail);
    } catch (_) {
      // Non-fatal fallback
    }
  }

  return user || null;
}

function rehydrateChargerFromToken(tokenOrDecoded) {
  const decoded = typeof tokenOrDecoded === 'string' ? verifyToken(tokenOrDecoded) : tokenOrDecoded;
  if (!decoded || decoded.kind !== 'charger' || !decoded.charger || !decoded.charger.id) return null;

  const c = decoded.charger;
  const hostObj = decoded.host || {};
  const hostId = c.host_id || hostObj.userId || 'usr-host-01';

  try {
    if (hostObj.userId && hostObj.email) {
      rehydrateUserFromToken(hostObj);
    }
    db.prepare(`
      INSERT OR IGNORE INTO host_profiles (id, user_id, address, city, pincode, upi_id, verification_status, rating)
      VALUES (?, ?, ?, ?, '201301', '', 'verified', 5.0)
    `).run('hp-' + hostId, hostId, c.address || 'Verified P2P Host Site', c.city || 'Delhi NCR');

    db.prepare(`
      INSERT OR IGNORE INTO chargers (
        id, host_id, code, name, description, address, city, lat, lng,
        connector_type, power_kw, billing_type, price_per_kwh, time_rate_per_hour,
        status, operating_hours, access_instructions, is_power_on, verification_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      c.id,
      hostId,
      c.code || ('CE-DEL-' + Math.floor(200 + Math.random() * 800)),
      c.name || 'Community EV Charger',
      c.description || '',
      c.address || 'Nearby Host Driveway',
      c.city || 'Delhi NCR',
      parseFloat(c.lat) || 28.4638,
      parseFloat(c.lng) || 77.4948,
      c.connector_type || 'Type 2 AC',
      parseFloat(c.power_kw) || 7.4,
      c.billing_type === 'time' ? 'time' : 'metered',
      parseFloat(c.price_per_kwh) || 12.00,
      parseFloat(c.time_rate_per_hour) || 20.00,
      c.status || 'available',
      c.operating_hours || '24/7 Access',
      c.access_instructions || 'Host instructions provided after booking.',
      c.is_power_on === 0 ? 0 : 1,
      c.verification_status === 'rejected' ? 'rejected' : 'approved'
    );
    return db.prepare('SELECT * FROM chargers WHERE id = ?').get(c.id);
  } catch (_) {
    return null;
  }
}

function parseTokenListHeader(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  const str = String(val).trim();
  if (!str) return [];
  if (str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (_) {}
  }
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

function rehydrateVaultFromRequest(req, body = null) {
  const userTokens = [
    ...parseTokenListHeader(req.headers['x-chargeease-vault']),
    ...(body?.vaultToken ? [body.vaultToken] : []),
    ...parseTokenListHeader(body?.vaultTokens)
  ];
  for (const tok of userTokens) {
    rehydrateUserFromToken(tok);
  }

  const chargerTokens = [
    ...parseTokenListHeader(req.headers['x-chargeease-chargers']),
    ...parseTokenListHeader(body?.chargerTokens)
  ];
  for (const tok of chargerTokens) {
    rehydrateChargerFromToken(tok);
  }
}

// Authenticate request and attach user record
function authenticateUser(req) {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  if (!authHeader) return null;

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const decoded = verifyToken(token);
  if (!decoded) return null;

  const user = rehydrateUserFromToken(decoded);
  if (!user || user.is_suspended) return null;

  return user;
}

// Permission checking helper
function checkRole(user, allowedRoles) {
  if (!user) return false;
  if (Array.isArray(allowedRoles)) {
    return allowedRoles.includes(user.role);
  }
  return user.role === allowedRoles;
}

module.exports = {
  signToken,
  verifyToken,
  rehydrateUserFromToken,
  rehydrateChargerFromToken,
  rehydrateVaultFromRequest,
  authenticateUser,
  checkRole,
  hashPassword,
  verifyPassword
};

