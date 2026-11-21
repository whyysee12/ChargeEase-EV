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

// Authenticate request and attach user record
function authenticateUser(req) {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  if (!authHeader) return null;

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const decoded = verifyToken(token);
  if (!decoded) return null;

  let user = db.prepare('SELECT id, email, role, name, phone, wallet_balance, is_verified, is_suspended FROM users WHERE id = ?').get(decoded.userId);
  if (!user && decoded.email) {
    user = db.prepare('SELECT id, email, role, name, phone, wallet_balance, is_verified, is_suspended FROM users WHERE email = ?').get(String(decoded.email).toLowerCase().trim());
  }

  // Auto-rehydrate valid JWT users in fresh serverless instances (e.g. Vercel /tmp cold start)
  if (!user && decoded.userId && decoded.email && decoded.role) {
    try {
      const safeRole = ['driver', 'host', 'admin'].includes(decoded.role) ? decoded.role : 'driver';
      const defaultBal = typeof decoded.wallet_balance === 'number'
        ? decoded.wallet_balance
        : (safeRole === 'driver' ? 500.00 : 0.00);
      db.prepare(`
        INSERT OR IGNORE INTO users (id, email, password_hash, role, name, phone, wallet_balance, is_verified, is_suspended)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)
      `).run(
        decoded.userId,
        String(decoded.email).toLowerCase().trim(),
        hashPassword('rehydrated-' + decoded.userId),
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

      user = db.prepare('SELECT id, email, role, name, phone, wallet_balance, is_verified, is_suspended FROM users WHERE id = ?').get(decoded.userId);
    } catch (_) {
      // Non-fatal fallback
    }
  }

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
  authenticateUser,
  checkRole,
  hashPassword,
  verifyPassword
};

