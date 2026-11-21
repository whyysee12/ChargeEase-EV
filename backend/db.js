// =========================================================
// ChargeEase EV - Relational SQLite Database Architecture
// Engine: Node.js 22 Built-in node:sqlite (ACID compliant)
// =========================================================

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const DB_PATH = process.env.VERCEL
  ? path.join(os.tmpdir(), 'chargeease.db')
  : path.join(__dirname, '..', 'chargeease.db');
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode & Foreign Keys for integrity & concurrency
db.exec('PRAGMA foreign_keys = ON;');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('driver', 'host', 'admin')),
      name TEXT NOT NULL,
      phone TEXT,
      avatar_url TEXT,
      wallet_balance REAL DEFAULT 750.00,
      is_verified INTEGER DEFAULT 1,
      is_suspended INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS driver_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      license_no TEXT,
      emergency_contact TEXT,
      safety_buffer_pct REAL DEFAULT 20.0,
      favorite_chargers_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS host_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      pincode TEXT NOT NULL,
      upi_id TEXT,
      bank_account TEXT,
      ifsc_code TEXT,
      verification_status TEXT DEFAULT 'verified' CHECK(verification_status IN ('pending', 'verified', 'rejected')),
      rejection_reason TEXT,
      rating REAL DEFAULT 4.90,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      manufacturer TEXT NOT NULL,
      model TEXT NOT NULL,
      battery_capacity_kwh REAL NOT NULL,
      connector_type TEXT NOT NULL,
      registration_no TEXT,
      current_soc REAL DEFAULT 24.0,
      is_primary INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chargers (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      connector_type TEXT NOT NULL,
      power_kw REAL NOT NULL,
      vehicle_types_json TEXT DEFAULT '["2W","3W","4W"]',
      billing_type TEXT NOT NULL CHECK(billing_type IN ('metered', 'time')),
      price_per_kwh REAL DEFAULT 12.00,
      time_rate_per_hour REAL DEFAULT 20.00,
      status TEXT DEFAULT 'available' CHECK(status IN ('available', 'busy', 'offline')),
      operating_hours TEXT DEFAULT '24/7 Access',
      access_instructions TEXT,
      min_duration_mins INTEGER DEFAULT 15,
      max_duration_mins INTEGER DEFAULT 240,
      is_power_on INTEGER DEFAULT 1,
      verification_status TEXT DEFAULT 'approved' CHECK(verification_status IN ('pending', 'approved', 'rejected')),
      rejection_reason TEXT,
      rating REAL DEFAULT 4.90,
      total_sessions INTEGER DEFAULT 0,
      photo_url TEXT,
      amenities_json TEXT DEFAULT '["24/7 Access", "Security Guard", "CCTV"]',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS charger_availability (
      id TEXT PRIMARY KEY,
      charger_id TEXT NOT NULL,
      day_of_week INTEGER NOT NULL, -- 0 = Sunday, 6 = Saturday
      start_time TEXT NOT NULL,     -- '08:00'
      end_time TEXT NOT NULL,       -- '22:00'
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (charger_id) REFERENCES chargers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      booking_code TEXT UNIQUE NOT NULL,
      driver_id TEXT NOT NULL,
      host_id TEXT NOT NULL,
      charger_id TEXT NOT NULL,
      vehicle_id TEXT,
      booking_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_mins INTEGER NOT NULL,
      status TEXT DEFAULT 'confirmed' CHECK(status IN ('pending', 'confirmed', 'rejected', 'cancelled', 'active', 'completed', 'expired')),
      billing_type TEXT NOT NULL,
      estimated_kwh REAL,
      base_amount REAL NOT NULL,
      platform_fee REAL NOT NULL,
      gst_fee REAL NOT NULL,
      deposit_amount REAL DEFAULT 50.00,
      total_amount REAL NOT NULL,
      host_payout REAL NOT NULL,
      payment_status TEXT DEFAULT 'paid' CHECK(payment_status IN ('pending', 'paid', 'refunded')),
      cancellation_reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (driver_id) REFERENCES users(id),
      FOREIGN KEY (host_id) REFERENCES users(id),
      FOREIGN KEY (charger_id) REFERENCES chargers(id)
    );

    CREATE TABLE IF NOT EXISTS charging_sessions (
      id TEXT PRIMARY KEY,
      session_code TEXT UNIQUE NOT NULL,
      booking_id TEXT,
      charger_id TEXT NOT NULL,
      driver_id TEXT NOT NULL,
      host_id TEXT NOT NULL,
      start_time TEXT DEFAULT (datetime('now')),
      end_time TEXT,
      duration_seconds INTEGER DEFAULT 0,
      energy_delivered_kwh REAL DEFAULT 0.0,
      instant_power_kw REAL DEFAULT 7.4,
      voltage REAL DEFAULT 230.0,
      current_amps REAL DEFAULT 32.0,
      final_cost REAL DEFAULT 0.0,
      session_status TEXT DEFAULT 'active' CHECK(session_status IN ('active', 'paused', 'completed', 'aborted')),
      is_simulated INTEGER DEFAULT 1,
      telemetry_log_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (booking_id) REFERENCES bookings(id),
      FOREIGN KEY (charger_id) REFERENCES chargers(id),
      FOREIGN KEY (driver_id) REFERENCES users(id),
      FOREIGN KEY (host_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      booking_id TEXT,
      session_id TEXT,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'INR',
      payment_method TEXT NOT NULL, -- 'UPI', 'WALLET', 'CARD'
      transaction_ref TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'success' CHECK(status IN ('pending', 'success', 'failed', 'refunded')),
      type TEXT NOT NULL, -- 'booking_payment', 'session_debit', 'wallet_recharge', 'host_payout'
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'info' CHECK(type IN ('info', 'booking', 'session', 'payment', 'host', 'system')),
      is_read INTEGER DEFAULT 0,
      link TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      charger_id TEXT NOT NULL,
      booking_id TEXT,
      rating REAL NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (charger_id) REFERENCES chargers(id)
    );

    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      raised_by_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'open' CHECK(status IN ('open', 'under_review', 'resolved', 'dismissed')),
      resolution_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (booking_id) REFERENCES bookings(id),
      FOREIGN KEY (raised_by_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS admin_activity_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (admin_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_chargers_host ON chargers(host_id);
    CREATE INDEX IF NOT EXISTS idx_chargers_city ON chargers(city);
    CREATE INDEX IF NOT EXISTS idx_bookings_driver ON bookings(driver_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_host ON bookings(host_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
  `);
}

function seedDatabase() {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount > 0) {
    return; // Already seeded
  }

  console.log('[DB] Seeding realistic non-production accounts & chargers for Delhi NCR demonstration...');

  const passHash = hashPassword('Admin@123');
  const driverPass = hashPassword('Driver@123');
  const hostPass = hashPassword('Host@123');

  // 1. Users
  const insertUser = db.prepare(`
    INSERT INTO users (id, email, password_hash, role, name, phone, wallet_balance, is_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run('usr-admin-01', 'admin@chargeease.com', passHash, 'admin', 'Platform Super Administrator', '+91 98100 00001', 50000.00, 1);
  insertUser.run('usr-driver-01', 'driver@chargeease.com', driverPass, 'driver', 'Rahul Sharma', '+91 98765 43210', 820.00, 1);
  insertUser.run('usr-driver-02', 'priya.driver@example.com', driverPass, 'driver', 'Priya Kapoor', '+91 98111 22334', 450.00, 1);
  insertUser.run('usr-host-01', 'host@chargeease.com', hostPass, 'host', 'Amit Verma', '+91 98222 33445', 3420.00, 1);
  insertUser.run('usr-host-02', 'gaurav.host@example.com', hostPass, 'host', 'Gaurav Chhabra', '+91 99999 88888', 1950.00, 1);

  // 2. Driver Profiles
  const insertDriver = db.prepare(`
    INSERT INTO driver_profiles (id, user_id, license_no, emergency_contact, safety_buffer_pct)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertDriver.run('dp-01', 'usr-driver-01', 'DL-1420220019283', '+91 98765 00000', 20.0);
  insertDriver.run('dp-02', 'usr-driver-02', 'DL-0720230048172', '+91 98111 00000', 15.0);

  // 3. Vehicles
  const insertVehicle = db.prepare(`
    INSERT INTO vehicles (id, user_id, manufacturer, model, battery_capacity_kwh, connector_type, registration_no, current_soc, is_primary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertVehicle.run('veh-01', 'usr-driver-01', 'Ola Electric', 'Ola S1 Pro Gen 2', 4.0, '16A 3-Pin', 'DL 3S ET 4492', 24.0, 1);
  insertVehicle.run('veh-02', 'usr-driver-01', 'Tata Motors', 'Tata Nexon EV Max', 40.5, 'CCS 2 (Fast DC)', 'UP 16 BE 9012', 38.0, 0);
  insertVehicle.run('veh-03', 'usr-driver-02', 'Ather Energy', 'Ather 450X Gen 3', 3.7, 'Type 2 AC', 'DL 8S CG 1102', 45.0, 1);

  // 4. Host Profiles
  const insertHost = db.prepare(`
    INSERT INTO host_profiles (id, user_id, address, city, pincode, upi_id, verification_status, rating)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertHost.run('hp-01', 'usr-host-01', 'Wave Silver Tower, Sector 18, Noida', 'Delhi NCR', '201301', 'amitverma@oksbi', 'verified', 4.95);
  insertHost.run('hp-02', 'usr-host-02', 'Tower B, Cloud 9 Society, Sector 50, Noida', 'Delhi NCR', '201307', 'gaurav.host@paytm', 'verified', 4.92);

  // 5. Seed initial nearby Delhi NCR chargers using location sync
  // 6. Sample Bookings
  const insertBooking = db.prepare(`
    INSERT INTO bookings (
      id, booking_code, driver_id, host_id, charger_id, vehicle_id,
      booking_date, start_time, end_time, duration_mins, status,
      billing_type, estimated_kwh, base_amount, platform_fee, gst_fee,
      deposit_amount, total_amount, host_payout, payment_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  syncNearbyChargersForLocation(28.4626, 77.4935);

  insertBooking.run(
    'bk-01', 'CE-BK-8901', 'usr-driver-01', 'usr-host-01', 'ce-del-sec137', 'veh-01',
    '2026-11-21', '17:00', '18:00', 60, 'confirmed',
    'metered', 5.0, 60.00, 6.00, 1.08, 50.00, 67.08, 54.00, 'paid'
  );

  insertBooking.run(
    'bk-02', 'CE-BK-8902', 'usr-driver-01', 'usr-host-01', 'ce-del-noida-18', 'veh-01',
    '2026-11-20', '14:00', '15:30', 90, 'completed',
    'metered', 7.5, 90.00, 9.00, 1.62, 50.00, 100.62, 81.00, 'paid'
  );

  insertBooking.run(
    'bk-03', 'CE-BK-8903', 'usr-driver-02', 'usr-host-02', 'ce-del-jaypee', 'veh-03',
    '2026-11-22', '10:00', '11:00', 60, 'pending',
    'metered', 4.0, 56.00, 5.60, 1.01, 50.00, 62.61, 50.40, 'pending'
  );

  // 7. Sample Charging Session
  const insertSession = db.prepare(`
    INSERT INTO charging_sessions (
      id, session_code, booking_id, charger_id, driver_id, host_id,
      start_time, end_time, duration_seconds, energy_delivered_kwh,
      instant_power_kw, voltage, current_amps, final_cost, session_status, is_simulated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertSession.run(
    'ses-01', 'SES-88219', 'bk-02', 'ce-del-noida-18', 'usr-driver-01', 'usr-host-01',
    '2026-11-20 14:00:00', '2026-11-20 15:30:00', 5400, 7.5,
    7.4, 231.5, 32.0, 100.62, 'completed', 1
  );

  // 8. Sample Notifications
  const insertNotification = db.prepare(`
    INSERT INTO notifications (id, user_id, title, message, type, is_read)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertNotification.run('notif-01', 'usr-driver-01', 'Booking Confirmed', 'Your booking CE-BK-8901 at Noida Expressway Sector 137 is confirmed.', 'booking', 0);
  insertNotification.run('notif-02', 'usr-host-01', 'New Booking Request', 'Rahul Sharma booked a 60 min session at Sector 137 Dock.', 'host', 0);
  insertNotification.run('notif-03', 'usr-host-02', 'Pending Booking Request', 'Priya Kapoor requested a 60 min session at Jaypee Greens Villa Dock.', 'host', 0);

  // 9. Sample Payments Ledger
  const insertPayment = db.prepare(`
    INSERT INTO payments (id, user_id, booking_id, amount, payment_method, transaction_ref, status, type, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertPayment.run('pay-01', 'usr-driver-01', 'bk-02', 100.62, 'WALLET', 'TXN-99812-WAL', 'success', 'booking_payment', 'Session payment for Sector 18 Dock');
  insertPayment.run('pay-02', 'usr-driver-01', null, 500.00, 'UPI', 'UPI-PHON-44910', 'success', 'wallet_recharge', 'UPI Wallet Topup (+₹500.00)');

  // 10. Admin activity log
  const insertAdminLog = db.prepare(`
    INSERT INTO admin_activity_logs (id, admin_id, action, target_type, target_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertAdminLog.run('log-01', 'usr-admin-01', 'VERIFY_HOST', 'HOST', 'usr-host-01', 'Verified Host Amit Verma after document review');
  insertAdminLog.run('log-02', 'usr-admin-01', 'APPROVE_CHARGER', 'CHARGER', 'ce-del-sec137', 'Approved Sector 137 Eco Dock with verified power certification');

  console.log('[DB] Database successfully seeded with non-production test accounts:');
  console.log('      Admin:  admin@chargeease.com  / Admin@123');
  console.log('      Host:   host@chargeease.com   / Host@123');
  console.log('      Driver: driver@chargeease.com / Driver@123');
}

const CURATED_NEARBY_STATIONS = [
  {
    id: 'ce-del-sec137', hostId: 'usr-host-01', code: 'CE-DEL-100',
    name: 'Noida Expressway Eco Dock - Sector 137',
    description: 'Direct expressway access, nearest verified dock. Calibrated smart meter with fast 7.4 kW Pro AC charging.',
    address: 'Near Metro Station Gate 2, Paras Tierea, Sector 137, Noida Expressway, Delhi NCR',
    city: 'Delhi NCR', dLat: 0.0117, dLng: -0.0205,
    connectorType: 'Type 2 AC', powerKw: 7.4, vehicleTypes: '["2W","3W","4W"]',
    billingType: 'metered', pricePerKwh: 12.00, timeRatePerHour: 22.00,
    operatingHours: '24/7 Access',
    accessInstructions: 'Enter through Gate 2, parking bay P-04 next to security kiosk.',
    rating: 4.98, totalSessions: 312,
    photoUrl: 'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?auto=format&fit=crop&w=600&q=80',
    amenities: '["Expressway Hub", "Gated Security", "CCTV 24x7", "Power Backup", "Restrooms"]'
  },
  {
    id: 'ce-del-kp3', hostId: 'usr-host-02', code: 'CE-DEL-109',
    name: 'Knowledge Park III Campus EV Hub',
    description: 'Calibrated AC smart charger along Knowledge Park III institutional corridor.',
    address: 'Plot 22, Knowledge Park III, Greater Noida, Delhi NCR',
    city: 'Delhi NCR', dLat: 0.0184, dLng: -0.0190,
    connectorType: 'Type 2 AC', powerKw: 7.4, vehicleTypes: '["2W","3W","4W"]',
    billingType: 'metered', pricePerKwh: 12.00, timeRatePerHour: 22.00,
    operatingHours: '06:00 AM - 11:00 PM',
    accessInstructions: 'Main campus visitor bay 2, scan QR at gate post.',
    rating: 4.91, totalSessions: 215,
    photoUrl: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=600&q=80',
    amenities: '["Campus Security", "Covered Parking", "Wi-Fi", "Cafeteria"]'
  },
  {
    id: 'ce-del-parichowk', hostId: 'usr-host-02', code: 'CE-DEL-105',
    name: 'Pari Chowk Metro & Commercial EV Point',
    description: 'Convenient 16A smart plug beside Pari Chowk Metro transit hub with disclosed hourly rate.',
    address: 'Commercial Complex, Pari Chowk Roundabout, Greater Noida, Delhi NCR',
    city: 'Delhi NCR', dLat: 0.0042, dLng: 0.0313,
    connectorType: '16A 3-Pin', powerKw: 3.3, vehicleTypes: '["2W","3W"]',
    billingType: 'time', pricePerKwh: 12.00, timeRatePerHour: 20.00,
    operatingHours: '24/7 Access',
    accessInstructions: 'Two-wheeler & compact EV bay opposite Metro Gate 1.',
    rating: 4.88, totalSessions: 275,
    photoUrl: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=600&q=80',
    amenities: '["Metro 100m", "24/7 Guard", "ATM", "Illuminated Bay"]'
  },
  {
    id: 'ce-del-alpha1', hostId: 'usr-host-02', code: 'CE-DEL-108',
    name: 'Alpha 1 Commercial Belt Smart Socket',
    description: 'Standard 16A smart socket located behind Alpha 1 commercial belt.',
    address: 'Commercial Belt, Sector Alpha 1, Greater Noida, Delhi NCR',
    city: 'Delhi NCR', dLat: 0.0169, dLng: 0.0315,
    connectorType: '16A 3-Pin', powerKw: 3.3, vehicleTypes: '["2W","3W"]',
    billingType: 'time', pricePerKwh: 10.00, timeRatePerHour: 18.00,
    operatingHours: '07:00 AM - 11:00 PM',
    accessInstructions: 'Ground level shop parking behind HDFC bank branch.',
    rating: 4.82, totalSessions: 128,
    photoUrl: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=600&q=80',
    amenities: '["Convenient Parking", "CCTV", "Market Nearby"]'
  },
  {
    id: 'ce-del-jaypee', hostId: 'usr-host-02', code: 'CE-DEL-110',
    name: 'Jaypee Greens Golf Course P2P Villa Dock',
    description: 'High-capacity residential tri-phase 11 kW dock operated in Jaypee Greens gated enclave.',
    address: 'Estate Homes Villa 42, Jaypee Greens, Greater Noida, Delhi NCR',
    city: 'Delhi NCR', dLat: -0.0106, dLng: 0.0410,
    connectorType: 'Type 2 AC', powerKw: 11.0, vehicleTypes: '["2W","3W","4W"]',
    billingType: 'metered', pricePerKwh: 14.00, timeRatePerHour: 28.00,
    operatingHours: '06:00 AM - 11:30 PM',
    accessInstructions: 'Mention ChargeEase booking code at Gate 3 security desk.',
    rating: 4.94, totalSessions: 164,
    photoUrl: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=600&q=80',
    amenities: '["Gated Enclave", "Covered Driveway", "CCTV", "Solar Assisted"]'
  },
  {
    id: 'ce-del-venice', hostId: 'usr-host-01', code: 'CE-DEL-111',
    name: 'Grand Venice & Omega 1 Rapid EV Hub',
    description: 'Fast 22 kW three-phase commercial charging station near Grand Venice Mall.',
    address: 'Plot SH-3, Site IV, Near Grand Venice Mall, Omega 1, Greater Noida, Delhi NCR',
    city: 'Delhi NCR', dLat: -0.0241, dLng: 0.0415,
    connectorType: 'CCS 2 / Type 2', powerKw: 22.0, vehicleTypes: '["4W"]',
    billingType: 'metered', pricePerKwh: 15.00, timeRatePerHour: 35.00,
    operatingHours: '24/7 Access',
    accessInstructions: 'Surface parking Zone A, reserved green EV bays.',
    rating: 4.89, totalSessions: 410,
    photoUrl: 'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?auto=format&fit=crop&w=600&q=80',
    amenities: '["22 kW Fast Charge", "Mall Access", "Food Court", "Restrooms"]'
  },
  {
    id: 'ce-del-sec142', hostId: 'usr-host-01', code: 'CE-DEL-112',
    name: 'Advant Navis Business Park EV Bay - Sector 142',
    description: 'Corporate expressway corridor charger with calibrated energy metering.',
    address: 'Advant Navis Business Park, Sector 142, Noida Expressway, Delhi NCR',
    city: 'Delhi NCR', dLat: 0.0389, dLng: -0.0400,
    connectorType: 'Type 2 AC', powerKw: 7.4, vehicleTypes: '["2W","3W","4W"]',
    billingType: 'metered', pricePerKwh: 12.50, timeRatePerHour: 24.00,
    operatingHours: '07:00 AM - 11:00 PM',
    accessInstructions: 'Visitor parking Tower B, near Metro Skywalk.',
    rating: 4.90, totalSessions: 295,
    photoUrl: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=600&q=80',
    amenities: '["Expressway Access", "Corporate Security", "Cafeteria", "Wi-Fi"]'
  },
  {
    id: 'ce-del-sec150', hostId: 'usr-host-02', code: 'CE-DEL-113',
    name: 'Sector 150 Expressway Green Residency Dock',
    description: 'Low-density green sector residential host socket off Noida-Greater Noida Expressway.',
    address: 'ATS Pristine Tower 4, Sector 150, Noida, Delhi NCR',
    city: 'Delhi NCR', dLat: -0.0306, dLng: -0.0600,
    connectorType: 'Type 2 AC', powerKw: 7.4, vehicleTypes: '["2W","3W","4W"]',
    billingType: 'metered', pricePerKwh: 12.00, timeRatePerHour: 22.00,
    operatingHours: '06:00 AM - 11:00 PM',
    accessInstructions: 'Tower 4 visitor stilt bay V-08.',
    rating: 4.93, totalSessions: 148,
    photoUrl: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=600&q=80',
    amenities: '["Covered Stilt Bay", "Gated Guard", "24x7 CCTV"]'
  },
  {
    id: 'ce-del-noida-18', hostId: 'usr-host-01', code: 'CE-DEL-101',
    name: 'Wave Silver Tower P2P Dock - Sector 18',
    description: 'Expressway corridor northern hub charger connecting Sector 18 market and Metro.',
    address: 'Wave Silver Tower, Sector 18 Corridor, Noida, Delhi NCR',
    city: 'Delhi NCR', dLat: 0.0550, dLng: -0.0650,
    connectorType: 'Type 2 AC', powerKw: 7.4, vehicleTypes: '["2W","3W","4W"]',
    billingType: 'metered', pricePerKwh: 12.00, timeRatePerHour: 24.00,
    operatingHours: '24/7 Access',
    accessInstructions: 'Basement B1, Bay 14. Show booking code at the barrier.',
    rating: 4.95, totalSessions: 540,
    photoUrl: 'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?auto=format&fit=crop&w=600&q=80',
    amenities: '["Covered Stilt Bay", "CCTV 24x7", "Mall Nearby", "Restrooms", "Free WiFi"]'
  }
];

function syncNearbyChargersForLocation(baseLat = 28.4626, baseLng = 77.4935) {
  const latOrigin = Number.isFinite(Number(baseLat)) ? Number(baseLat) : 28.4626;
  const lngOrigin = Number.isFinite(Number(baseLng)) ? Number(baseLng) : 77.4935;

  const insertCharger = db.prepare(`
    INSERT INTO chargers (
      id, host_id, code, name, description, address, city, lat, lng,
      connector_type, power_kw, vehicle_types_json, billing_type,
      price_per_kwh, time_rate_per_hour, status, operating_hours,
      access_instructions, min_duration_mins, max_duration_mins, is_power_on,
      verification_status, rating, total_sessions, photo_url, amenities_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, 15, 240, 1, 'approved', ?, ?, ?, ?)
  `);

  const updateCharger = db.prepare(`
    UPDATE chargers
    SET host_id = ?, code = ?, name = ?, description = ?, address = ?, city = ?,
        lat = ?, lng = ?, connector_type = ?, power_kw = ?, vehicle_types_json = ?,
        billing_type = ?, price_per_kwh = ?, time_rate_per_hour = ?, operating_hours = ?,
        access_instructions = ?, verification_status = 'approved', rating = ?,
        total_sessions = ?, photo_url = ?, amenities_json = ?
    WHERE id = ?
  `);

  const existsStmt = db.prepare('SELECT id FROM chargers WHERE id = ?');

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Clean legacy unreferenced seed stations before inserting/updating new codes
    const legacyUnused = ['ce-del-filmcity', 'ce-del-sec62', 'ce-del-indirapuram'];
    const delStmt = db.prepare('DELETE FROM chargers WHERE id = ?');
    legacyUnused.forEach(oldId => delStmt.run(oldId));

    // 2. Clear any code collision if a legacy station held a code used by curated stations
    const clearCodeStmt = db.prepare("DELETE FROM chargers WHERE code = ? AND id NOT IN ('ce-del-sec137','ce-del-kp3','ce-del-parichowk','ce-del-alpha1','ce-del-jaypee','ce-del-venice','ce-del-sec142','ce-del-sec150','ce-del-noida-18') AND id != 'ce-del-noida-sec50'");
    CURATED_NEARBY_STATIONS.forEach(st => clearCodeStmt.run(st.code));

    // 3. Upsert all 9 curated stations relative to baseLat, baseLng
    for (const st of CURATED_NEARBY_STATIONS) {
      const lat = Number((latOrigin + st.dLat).toFixed(4));
      const lng = Number((lngOrigin + st.dLng).toFixed(4));

      if (existsStmt.get(st.id)) {
        updateCharger.run(
          st.hostId, st.code, st.name, st.description, st.address, st.city,
          lat, lng, st.connectorType, st.powerKw, st.vehicleTypes,
          st.billingType, st.pricePerKwh, st.timeRatePerHour, st.operatingHours,
          st.accessInstructions, st.rating, st.totalSessions, st.photoUrl, st.amenities,
          st.id
        );
      } else {
        insertCharger.run(
          st.id, st.hostId, st.code, st.name, st.description, st.address, st.city,
          lat, lng, st.connectorType, st.powerKw, st.vehicleTypes,
          st.billingType, st.pricePerKwh, st.timeRatePerHour, st.operatingHours,
          st.accessInstructions, st.rating, st.totalSessions, st.photoUrl, st.amenities
        );
      }
    }

    // 4. Safely migrate any FK references from legacy ce-del-noida-sec50 to ce-del-jaypee, then remove legacy row
    db.prepare("UPDATE bookings SET charger_id = 'ce-del-jaypee' WHERE charger_id = 'ce-del-noida-sec50'").run();
    db.prepare("UPDATE charging_sessions SET charger_id = 'ce-del-jaypee' WHERE charger_id = 'ce-del-noida-sec50'").run();
    db.prepare("UPDATE reviews SET charger_id = 'ce-del-jaypee' WHERE charger_id = 'ce-del-noida-sec50'").run();
    db.prepare("DELETE FROM chargers WHERE id = 'ce-del-noida-sec50'").run();

    // 5. Ensure demo reviews & disputes exist once sample bookings are present
    const hasBk01 = Boolean(db.prepare("SELECT id FROM bookings WHERE id = 'bk-01'").get());
    const hasBk02 = Boolean(db.prepare("SELECT id FROM bookings WHERE id = 'bk-02'").get());

    const reviewCount = db.prepare('SELECT COUNT(*) AS count FROM reviews').get().count;
    if (reviewCount === 0 && hasBk01 && hasBk02) {
      const insRev = db.prepare('INSERT INTO reviews (id, user_id, charger_id, booking_id, rating, comment) VALUES (?, ?, ?, ?, ?, ?)');
      insRev.run('rev-01', 'usr-driver-01', 'ce-del-sec137', 'bk-01', 5.0, 'Reliable 7.4 kW Type 2 point right off the expressway. Security desk was helpful at gate entry.');
      insRev.run('rev-02', 'usr-driver-02', 'ce-del-noida-18', 'bk-02', 4.9, 'Clean covered bay and accurate calibrated kWh billing.');
    }

    const disputeCount = db.prepare('SELECT COUNT(*) AS count FROM disputes').get().count;
    if (disputeCount === 0 && hasBk02) {
      db.prepare(`
        INSERT INTO disputes (id, booking_id, raised_by_id, reason, status, resolution_notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        'disp-01', 'bk-02', 'usr-driver-01',
        'Demo Dispute Sample: Gate access barrier delayed check-in by 12 minutes; requesting slot buffer adjustment.',
        'open', null
      );
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// Auto-initialize on import
initSchema();
seedDatabase();
syncNearbyChargersForLocation(28.4626, 77.4935);

module.exports = {
  db,
  hashPassword,
  verifyPassword,
  syncNearbyChargersForLocation
};

