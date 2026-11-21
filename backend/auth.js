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

  const user = db.prepare('SELECT id, email, role, name, phone, wallet_balance, is_verified, is_suspended FROM users WHERE id = ?').get(decoded.userId);
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

