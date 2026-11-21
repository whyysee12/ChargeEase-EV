// =========================================================
// ChargeEase EV - Unified REST API Controller & Business Logic
// =========================================================

const { db, hashPassword, verifyPassword, syncNearbyChargersForLocation } = require('./db');
const { signToken, authenticateUser, checkRole } = require('./auth');

// Utility: parse JSON body from request stream (supports pre-parsed req.body on Vercel)
function parseBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return Promise.resolve(req.body);
    try {
      return Promise.resolve(req.body ? JSON.parse(req.body) : {});
    } catch (err) {
      return Promise.reject(new Error('Invalid JSON payload'));
    }
  }
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

// Utility: Send standard JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-auth-token'
  });
  res.end(JSON.stringify(data));
}

// Distance formula (Haversine km)
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(1));
}

// Main API Handler Router
async function handleApiRequest(req, res, pathname, queryParams) {
  try {
    const user = authenticateUser(req);

    // =========================================================
    // 1. PUBLIC & AUTHENTICATION ENDPOINTS
    // =========================================================

    // Health Check
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'online',
        service: 'ChargeEase EV API Engine',
        version: '5.0.0',
        db: 'SQLite Connected',
        timestamp: new Date().toISOString()
      });
    }

    // Driver Registration
    if (pathname === '/api/auth/register-driver' && req.method === 'POST') {
      const body = await parseBody(req);
      const { name, email, password, phone, manufacturer, model, batteryCapacity, connectorType, registrationNo } = body;

      if (!name || !email || !password) {
        return sendJson(res, 400, { error: 'Name, email, and password are required' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return sendJson(res, 400, { error: 'Please enter a valid email address' });
      }
      if (String(password).length < 6) {
        return sendJson(res, 400, { error: 'Password must be at least 6 characters long' });
      }

      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
      if (existing) {
        return sendJson(res, 409, { error: 'An account with this email already exists' });
      }

      const userId = 'usr-drv-' + Date.now();
      const passHash = hashPassword(password);

      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare(`
          INSERT INTO users (id, email, password_hash, role, name, phone, wallet_balance, is_verified)
          VALUES (?, ?, ?, 'driver', ?, ?, 500.00, 1)
        `).run(userId, email.toLowerCase().trim(), passHash, name.trim(), phone || '+91 98000 00000');

        db.prepare(`
          INSERT INTO driver_profiles (id, user_id, license_no, emergency_contact, safety_buffer_pct)
          VALUES (?, ?, ?, ?, 20.0)
        `).run('dp-' + Date.now(), userId, 'DL-NEW-' + Math.floor(1000 + Math.random() * 9000), phone || '');

        const vehId = 'veh-' + Date.now();
        db.prepare(`
          INSERT INTO vehicles (id, user_id, manufacturer, model, battery_capacity_kwh, connector_type, registration_no, current_soc, is_primary)
          VALUES (?, ?, ?, ?, ?, ?, ?, 50.0, 1)
        `).run(
          vehId,
          userId,
          manufacturer || 'Ola Electric',
          model || 'Ola S1 Pro',
          parseFloat(batteryCapacity) || 4.0,
          connectorType || '16A 3-Pin',
          registrationNo || 'DL 3S ET 1001'
        );

        db.prepare(`
          INSERT INTO notifications (id, user_id, title, message, type)
          VALUES (?, ?, ?, ?, 'system')
        `).run('notif-' + Date.now(), userId, 'Welcome to ChargeEase EV', 'Your driver account has been activated with ₹500 welcome bonus wallet balance.');

        db.exec('COMMIT;');

        const token = signToken({ userId, email: email.toLowerCase().trim(), role: 'driver', name });
        return sendJson(res, 201, {
          success: true,
          message: 'Driver registration successful',
          verifiedRole: 'driver',
          token,
          user: { id: userId, email: email.toLowerCase().trim(), role: 'driver', name, wallet_balance: 500.00 },
          vehicle: {
            id: vehId,
            manufacturer: manufacturer || 'Ola Electric',
            model: model || 'Ola S1 Pro',
            battery_capacity_kwh: parseFloat(batteryCapacity) || 4.0,
            connector_type: connectorType || '16A 3-Pin',
            registration_no: registrationNo || 'DL 3S ET 1001'
          }
        });
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }

    // Host Registration
    if (pathname === '/api/auth/register-host' && req.method === 'POST') {
      const body = await parseBody(req);
      const { name, email, password, phone, address, city, pincode, upiId } = body;

      if (!name || !email || !password || !address || !city) {
        return sendJson(res, 400, { error: 'Name, email, password, address, and city are required' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return sendJson(res, 400, { error: 'Please enter a valid email address' });
      }
      if (String(password).length < 6) {
        return sendJson(res, 400, { error: 'Password must be at least 6 characters long' });
      }

      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
      if (existing) {
        return sendJson(res, 409, { error: 'An account with this email already exists' });
      }

      const userId = 'usr-host-' + Date.now();
      const passHash = hashPassword(password);

      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare(`
          INSERT INTO users (id, email, password_hash, role, name, phone, wallet_balance, is_verified)
          VALUES (?, ?, ?, 'host', ?, ?, 0.00, 1)
        `).run(userId, email.toLowerCase().trim(), passHash, name.trim(), phone || '+91 98000 00000');

        db.prepare(`
          INSERT INTO host_profiles (id, user_id, address, city, pincode, upi_id, verification_status, rating)
          VALUES (?, ?, ?, ?, ?, ?, 'verified', 5.0)
        `).run('hp-' + Date.now(), userId, address.trim(), city.trim(), pincode || '201301', upiId || '');

        db.prepare(`
          INSERT INTO notifications (id, user_id, title, message, type)
          VALUES (?, ?, ?, ?, 'host')
        `).run('notif-' + Date.now(), userId, 'Host Account Activated', 'Welcome to ChargeEase Host Network! You can now list and monetize your EV chargers.');

        db.exec('COMMIT;');

        const token = signToken({ userId, email: email.toLowerCase().trim(), role: 'host', name });
        return sendJson(res, 201, {
          success: true,
          message: 'Host registration successful',
          verifiedRole: 'host',
          verificationStatus: 'verified',
          token,
          user: { id: userId, email: email.toLowerCase().trim(), role: 'host', name, wallet_balance: 0.00 }
        });
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }

    // Login (Driver, Host, Admin)
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const { email, password } = body;

      if (!email || !password) {
        return sendJson(res, 400, { error: 'Email and password are required' });
      }

      const userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
      if (!userRow) {
        return sendJson(res, 401, { error: 'Invalid email or password' });
      }

      if (userRow.is_suspended) {
        return sendJson(res, 403, { error: 'Your account has been suspended by the platform administrator. Please contact support.' });
      }

      const isMatch = verifyPassword(password, userRow.password_hash);
      if (!isMatch) {
        return sendJson(res, 401, { error: 'Invalid email or password' });
      }

      if (body.expectedRole && userRow.role !== body.expectedRole) {
        return sendJson(res, 403, {
          error: `Account role mismatch: this email is registered as a ${userRow.role}, not ${body.expectedRole}.`
        });
      }

      const token = signToken({
        userId: userRow.id,
        email: userRow.email,
        role: userRow.role,
        name: userRow.name
      });

      return sendJson(res, 200, {
        success: true,
        message: 'Login successful',
        token,
        user: {
          id: userRow.id,
          email: userRow.email,
          role: userRow.role,
          name: userRow.name,
          phone: userRow.phone,
          wallet_balance: userRow.wallet_balance,
          is_verified: userRow.is_verified
        }
      });
    }

    // Current User Profile (`/api/auth/me`)
    if (pathname === '/api/auth/me' && req.method === 'GET') {
      if (!user) {
        return sendJson(res, 401, { error: 'Authentication required' });
      }

      let extra = {};
      if (user.role === 'driver') {
        const profile = db.prepare('SELECT * FROM driver_profiles WHERE user_id = ?').get(user.id);
        const vehicle = db.prepare('SELECT * FROM vehicles WHERE user_id = ? AND is_primary = 1').get(user.id) ||
                        db.prepare('SELECT * FROM vehicles WHERE user_id = ?').get(user.id);
        extra = { driverProfile: profile, vehicle };
      } else if (user.role === 'host') {
        const hostProfile = db.prepare('SELECT * FROM host_profiles WHERE user_id = ?').get(user.id);
        const chargersCount = db.prepare('SELECT COUNT(*) AS count FROM chargers WHERE host_id = ?').get(user.id).count;
        extra = { hostProfile, chargersCount };
      }

      const unreadNotifs = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).count;

      return sendJson(res, 200, {
        success: true,
        user: {
          ...user,
          unreadNotifications: unreadNotifs,
          ...extra
        }
      });
    }

    // Update Profile
    if (pathname === '/api/auth/profile' && req.method === 'PUT') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const body = await parseBody(req);
      const { name, phone, licenseNo, emergencyContact, safetyBufferPct, address, city, pincode, upiId } = body;

      if (name) {
        db.prepare("UPDATE users SET name = ?, phone = ?, updated_at = datetime('now') WHERE id = ?").run(name.trim(), phone || user.phone, user.id);
      }

      if (user.role === 'driver') {
        db.prepare(`
          UPDATE driver_profiles
          SET license_no = COALESCE(?, license_no),
              emergency_contact = COALESCE(?, emergency_contact),
              safety_buffer_pct = COALESCE(?, safety_buffer_pct)
          WHERE user_id = ?
        `).run(licenseNo || null, emergencyContact || null, safetyBufferPct ? parseFloat(safetyBufferPct) : null, user.id);
      } else if (user.role === 'host') {
        db.prepare(`
          UPDATE host_profiles
          SET address = COALESCE(?, address),
              city = COALESCE(?, city),
              pincode = COALESCE(?, pincode),
              upi_id = COALESCE(?, upi_id)
          WHERE user_id = ?
        `).run(address || null, city || null, pincode || null, upiId || null, user.id);
      }

      return sendJson(res, 200, { success: true, message: 'Profile updated successfully' });
    }

    // Change Password
    if (pathname === '/api/auth/change-password' && req.method === 'PUT') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const body = await parseBody(req);
      const { currentPassword, newPassword } = body;

      if (!currentPassword || !newPassword) {
        return sendJson(res, 400, { error: 'Current password and new password are required' });
      }

      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
      if (!verifyPassword(currentPassword, row.password_hash)) {
        return sendJson(res, 400, { error: 'Current password does not match' });
      }

      const newHash = hashPassword(newPassword);
      db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(newHash, user.id);

      return sendJson(res, 200, { success: true, message: 'Password updated successfully' });
    }

    // =========================================================
    // 2. DRIVER DISCOVERY & REACHABILITY ENGINE
    // =========================================================

    function maskPrivateAddress(fullAddress) {
      const parts = (fullAddress || '').split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
        return parts.slice(-3).join(', ');
      }
      return fullAddress || 'Delhi NCR Corridor';
    }

    function getStationsForLocation(uLat, uLng, filters = {}, currentUser = null) {
      const search = (filters.search || '').toLowerCase().trim();
      const connector = filters.connector || '';
      const billing = filters.billing || '';
      const statusFilter = filters.status || '';
      const minPower = parseFloat(filters.minPower) || 0;
      const maxPrice = parseFloat(filters.maxPrice) || 0;
      const sortBy = filters.sortBy || 'distance';

      let unlockedSet = new Set();
      if (currentUser && currentUser.role === 'driver') {
        const unlockedRows = db.prepare(`
          SELECT DISTINCT charger_id
          FROM bookings
          WHERE driver_id = ? AND status IN ('confirmed', 'active', 'completed')
        `).all(currentUser.id);
        unlockedRows.forEach(row => unlockedSet.add(row.charger_id));
      }

      const rows = db.prepare(`
        SELECT c.*, u.name AS host_name, hp.rating AS host_rating, hp.verification_status AS host_verified
        FROM chargers c
        JOIN users u ON c.host_id = u.id
        LEFT JOIN host_profiles hp ON u.id = hp.user_id
        WHERE c.verification_status = 'approved'
        ORDER BY c.created_at DESC
      `).all();

      let stations = rows.map(r => {
        const dist = calculateDistanceKm(uLat, uLng, r.lat, r.lng);
        let amenities = [];
        let vehicleTypes = [];
        try { amenities = JSON.parse(r.amenities_json || '[]'); } catch (e) {}
        try { vehicleTypes = JSON.parse(r.vehicle_types_json || '[]'); } catch (e) {}

        const isUnlocked = !!(
          currentUser &&
          (currentUser.role === 'admin' || currentUser.id === r.host_id || unlockedSet.has(r.id))
        );
        const approximateAddress = maskPrivateAddress(r.address);

        return {
          id: r.id,
          code: r.code,
          name: r.name,
          host: r.host_name,
          hostRating: r.host_rating || 4.9,
          hostVerified: r.host_verified === 'verified',
          hostId: r.host_id,
          city: r.city,
          approximateAddress,
          isAddressUnlocked: isUnlocked,
          address: isUnlocked ? r.address : approximateAddress,
          lat: r.lat,
          lng: r.lng,
          distanceKm: dist,
          type: r.power_kw >= 7.4 ? `ChargeEase Pro AC (${r.power_kw} kW)` : `ChargeEase Lite AC (${r.power_kw} kW)`,
          powerKw: r.power_kw,
          connectorType: r.connector_type,
          connectors: [r.connector_type],
          vehicleTypes: vehicleTypes,
          billingType: r.billing_type,
          pricePerKwh: r.price_per_kwh,
          timeRatePerHour: r.time_rate_per_hour,
          status: r.is_power_on ? r.status : 'offline',
          rating: r.rating,
          totalSessions: r.total_sessions,
          operatingHours: r.operating_hours,
          accessInstructions: isUnlocked ? r.access_instructions : 'Exact bay and gate access instructions are unlocked once your booking is confirmed.',
          isPowerOn: !!r.is_power_on,
          isP2P: true,
          photo: r.photo_url || 'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?auto=format&fit=crop&w=600&q=80',
          amenities: amenities,
          description: r.description
        };
      });

      if (search) {
        stations = stations.filter(s =>
          s.name.toLowerCase().includes(search) ||
          s.address.toLowerCase().includes(search) ||
          s.approximateAddress.toLowerCase().includes(search) ||
          s.host.toLowerCase().includes(search) ||
          s.code.toLowerCase().includes(search)
        );
      }
      if (connector && connector !== 'all') {
        stations = stations.filter(s => s.connectorType.toLowerCase().includes(connector.toLowerCase()));
      }
      if (billing && billing !== 'all') {
        stations = stations.filter(s => s.billingType === billing);
      }
      if (statusFilter && statusFilter !== 'all') {
        stations = stations.filter(s => s.status === statusFilter);
      }
      if (minPower > 0) {
        stations = stations.filter(s => s.powerKw >= minPower);
      }
      if (maxPrice > 0) {
        stations = stations.filter(s => (s.billingType === 'time' ? s.timeRatePerHour : s.pricePerKwh) <= maxPrice);
      }

      if (sortBy === 'price') {
        stations.sort((a, b) => a.pricePerKwh - b.pricePerKwh);
      } else if (sortBy === 'power') {
        stations.sort((a, b) => b.powerKw - a.powerKw);
      } else if (sortBy === 'rating') {
        stations.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      } else {
        stations.sort((a, b) => a.distanceKm - b.distanceKm);
      }

      return stations;
    }

    // List Chargers with Filters & Distance Calculation
    if (pathname === '/api/driver/chargers' && req.method === 'GET') {
      const uLat = parseFloat(queryParams.lat) || 28.4626;
      const uLng = parseFloat(queryParams.lng) || 77.4935;
      const stations = getStationsForLocation(uLat, uLng, {
        search: queryParams.search,
        connector: queryParams.connector,
        billing: queryParams.billing,
        status: queryParams.status,
        minPower: queryParams.minPower,
        maxPrice: queryParams.maxPrice,
        sortBy: queryParams.sortBy
      }, user);

      return sendJson(res, 200, { success: true, count: stations.length, stations });
    }

    // Charger Full Detail (with Availability Calendar, Reviews, Privacy Protection)
    if (pathname.match(/^\/api\/chargers\/([a-zA-Z0-9_-]+)\/details$/) && req.method === 'GET') {
      const chargerId = pathname.split('/')[3];
      const uLat = parseFloat(queryParams.lat) || 28.4626;
      const uLng = parseFloat(queryParams.lng) || 77.4935;
      const dateStr = queryParams.date || new Date().toISOString().split('T')[0];

      const stations = getStationsForLocation(uLat, uLng, {}, user);
      const station = stations.find(s => s.id === chargerId);
      if (!station) return sendJson(res, 404, { error: 'Charger not found' });

      const bookedSlots = db.prepare(`
        SELECT start_time, end_time, status, booking_date
        FROM bookings
        WHERE charger_id = ? AND booking_date = ? AND status IN ('pending', 'confirmed', 'active')
        ORDER BY start_time ASC
      `).all(chargerId, dateStr);

      const reviews = db.prepare(`
        SELECT r.id, r.rating, r.comment, r.created_at, u.name AS reviewer_name
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.charger_id = ?
        ORDER BY r.created_at DESC
        LIMIT 20
      `).all(chargerId);

      return sendJson(res, 200, {
        success: true,
        station,
        date: dateStr,
        bookedSlots,
        reviews
      });
    }

    // Submit Review for Charger
    if (pathname.match(/^\/api\/chargers\/([a-zA-Z0-9_-]+)\/reviews$/) && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const chargerId = pathname.split('/')[3];
      const body = await parseBody(req);
      const rating = parseFloat(body.rating);
      const comment = (body.comment || '').trim();

      if (!rating || rating < 1 || rating > 5) {
        return sendJson(res, 400, { error: 'Rating between 1 and 5 is required' });
      }

      const chg = db.prepare('SELECT id FROM chargers WHERE id = ?').get(chargerId);
      if (!chg) return sendJson(res, 404, { error: 'Charger not found' });

      db.prepare(`
        INSERT INTO reviews (id, user_id, charger_id, booking_id, rating, comment)
        VALUES (?, ?, ?, NULL, ?, ?)
      `).run('rev-' + Date.now(), user.id, chargerId, rating, comment || 'Verified charging session feedback.');

      const avg = db.prepare('SELECT ROUND(AVG(rating), 2) AS avg_rating FROM reviews WHERE charger_id = ?').get(chargerId).avg_rating;
      if (avg) {
        db.prepare('UPDATE chargers SET rating = ? WHERE id = ?').run(avg, chargerId);
      }

      const reviews = db.prepare(`
        SELECT r.id, r.rating, r.comment, r.created_at, u.name AS reviewer_name
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.charger_id = ?
        ORDER BY r.created_at DESC
      `).all(chargerId);

      return sendJson(res, 201, { success: true, message: 'Review published', avgRating: avg, reviews });
    }

    // Dynamically analyze & calibrate nearby chargers around driver's GPS location
    if (pathname === '/api/driver/analyze-location' && req.method === 'POST') {
      const body = await parseBody(req);
      const lat = parseFloat(body.lat);
      const lng = parseFloat(body.lng);
      const locality = (body.locality || 'Detected GPS Corridor').trim();

      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return sendJson(res, 400, { error: 'Valid latitude and longitude coordinates are required' });
      }

      syncNearbyChargersForLocation(lat, lng);
      const stations = getStationsForLocation(lat, lng, {}, user);

      return sendJson(res, 200, {
        success: true,
        lat,
        lng,
        locality,
        count: stations.length,
        stations
      });
    }

    // Reachability & Safety Matcher Engine (National Hackathon Core USP)
    if (pathname === '/api/driver/reachability' && req.method === 'GET') {
      const uLat = parseFloat(queryParams.lat) || 28.4626;
      const uLng = parseFloat(queryParams.lng) || 77.4935;
      const soc = parseFloat(queryParams.soc) || 24.0;
      const batteryKwh = parseFloat(queryParams.batteryKwh) || 4.0;
      const safetyBufferPct = parseFloat(queryParams.safetyBuffer) || 20.0;
      const connectorReq = (queryParams.connector || '').trim();
      const minPowerKw = parseFloat(queryParams.minPowerKw) || 0;
      const directRangeOverride = parseFloat(queryParams.remainingRangeKm);

      // Real EV energy consumption: ~0.035 kWh/km for 2W scooter, ~0.15 kWh/km for 4W EV
      const is4W = batteryKwh > 10.0;
      const efficiencyKwhPerKm = is4W ? 0.15 : 0.035;

      const remainingKwh = batteryKwh * (soc / 100);
      const grossRangeKm = Number.isFinite(directRangeOverride) && directRangeOverride > 0
        ? parseFloat(directRangeOverride.toFixed(1))
        : parseFloat((remainingKwh / efficiencyKwhPerKm).toFixed(1));
      const usableSafeRangeKm = parseFloat((grossRangeKm * (1 - (safetyBufferPct / 100))).toFixed(1));

      const chargers = db.prepare(`
        SELECT c.*, u.name AS host_name, hp.verification_status AS host_verified
        FROM chargers c
        JOIN users u ON c.host_id = u.id
        LEFT JOIN host_profiles hp ON u.id = hp.user_id
        WHERE c.verification_status = 'approved'
      `).all();

      const evaluated = chargers.map(c => {
        const straightDistance = calculateDistanceKm(uLat, uLng, c.lat, c.lng);
        const estimatedRoadDistance = parseFloat((straightDistance * 1.25).toFixed(1));

        const isReachable = estimatedRoadDistance <= usableSafeRangeKm;
        const reqLower = connectorReq.toLowerCase();
        const stLower = c.connector_type.toLowerCase();
        const isConnectorMatch = !reqLower || reqLower === 'all' ||
          stLower.includes(reqLower) ||
          (reqLower.includes('type 2') && stLower.includes('type 2')) ||
          (reqLower.includes('ccs') && stLower.includes('ccs')) ||
          (reqLower.includes('16a') && stLower.includes('16a'));
        const isPowerOk = c.power_kw >= minPowerKw;
        const isOnline = !!(c.is_power_on && c.status === 'available');

        let category = 'safe';
        let recommendationReason = '';
        let exclusionReason = null;

        if (!isReachable) {
          category = 'beyond_range';
          exclusionReason = `Estimated corridor distance (${estimatedRoadDistance} km) exceeds usable safe range (${usableSafeRangeKm} km). Excluded to prevent stranding.`;
        } else if (!isConnectorMatch) {
          category = 'incompatible';
          exclusionReason = `Connector mismatch: Dock provides ${c.connector_type}; selected filter requires ${connectorReq}.`;
        } else if (!isPowerOk) {
          category = 'incompatible';
          exclusionReason = `Power output (${c.power_kw} kW) is below minimum required (${minPowerKw} kW).`;
        } else if (!isOnline) {
          category = 'busy_or_offline';
          exclusionReason = `Charger is currently occupied or switched offline by host.`;
        } else {
          const marginKm = (usableSafeRangeKm - estimatedRoadDistance).toFixed(1);
          recommendationReason = `Reachable with ${marginKm} km spare buffer inside your ${usableSafeRangeKm} km threshold (${c.connector_type}, ${c.power_kw} kW).`;
        }

        return {
          id: c.id,
          name: c.name,
          host: c.host_name,
          hostVerified: c.host_verified === 'verified',
          address: maskPrivateAddress(c.address),
          powerKw: c.power_kw,
          connectorType: c.connector_type,
          billingType: c.billing_type,
          pricePerKwh: c.price_per_kwh,
          timeRatePerHour: c.time_rate_per_hour,
          rating: c.rating,
          straightDistanceKm: straightDistance,
          estimatedRoadDistanceKm: estimatedRoadDistance,
          isReachable,
          category,
          recommendationReason,
          exclusionReason,
          score: (isReachable ? 100 : 0) + (isConnectorMatch ? 50 : 0) + (isOnline ? 30 : 0) + (c.rating || 4.8) - estimatedRoadDistance
        };
      });

      evaluated.sort((a, b) => b.score - a.score);

      return sendJson(res, 200, {
        success: true,
        calculation: {
          currentSocPercent: soc,
          batteryCapacityKwh: batteryKwh,
          usableKwh: parseFloat(remainingKwh.toFixed(2)),
          grossRangeKm,
          safetyBufferPct,
          usableSafeRangeKm,
          disclaimer: 'Corridor estimate applies a 1.25x urban detour factor to straight-line distance when live route telemetry is unavailable.'
        },
        chargers: evaluated
      });
    }

    // Driver Dashboard Aggregates
    if (pathname === '/api/driver/dashboard' && req.method === 'GET') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });

      const activeBooking = db.prepare(`
        SELECT b.*, c.name AS charger_name, c.address AS charger_address, c.access_instructions,
               c.power_kw, c.connector_type, u.name AS host_name, u.phone AS host_phone
        FROM bookings b
        JOIN chargers c ON b.charger_id = c.id
        JOIN users u ON b.host_id = u.id
        WHERE b.driver_id = ? AND b.status IN ('confirmed', 'active')
        ORDER BY b.booking_date ASC, b.start_time ASC
        LIMIT 1
      `).get(user.id);

      const recentBookings = db.prepare(`
        SELECT b.*, c.name AS charger_name
        FROM bookings b
        JOIN chargers c ON b.charger_id = c.id
        WHERE b.driver_id = ?
        ORDER BY b.created_at DESC
        LIMIT 5
      `).all(user.id);

      const recentSessions = db.prepare(`
        SELECT s.*, c.name AS charger_name, c.code AS charger_code
        FROM charging_sessions s
        JOIN chargers c ON s.charger_id = c.id
        WHERE s.driver_id = ?
        ORDER BY s.created_at DESC
        LIMIT 10
      `).all(user.id);

      const stats = db.prepare(`
        SELECT 
          COUNT(*) AS total_bookings,
          COALESCE(SUM(total_amount), 0) AS total_expenditure,
          COALESCE(SUM(estimated_kwh), 0) AS total_kwh
        FROM bookings
        WHERE driver_id = ? AND status = 'completed'
      `).get(user.id);

      const driverProfile = db.prepare('SELECT * FROM driver_profiles WHERE user_id = ?').get(user.id);
      let favoriteChargers = [];
      try { favoriteChargers = JSON.parse(driverProfile?.favorite_chargers_json || '[]'); } catch (e) {}

      const vehicles = db.prepare('SELECT * FROM vehicles WHERE user_id = ? ORDER BY is_primary DESC, created_at DESC').all(user.id);
      const vehicle = vehicles.find(v => v.is_primary) || vehicles[0] || null;

      return sendJson(res, 200, {
        success: true,
        driverName: user.name,
        walletBalance: user.wallet_balance,
        safetyBufferPct: driverProfile?.safety_buffer_pct ?? 20,
        favoriteChargers,
        stats,
        vehicle,
        vehicles,
        activeBooking: activeBooking || null,
        recentBookings,
        recentSessions
      });
    }

    // Driver Vehicles CRUD
    if (pathname === '/api/driver/vehicles' && req.method === 'GET') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const vehicles = db.prepare('SELECT * FROM vehicles WHERE user_id = ? ORDER BY is_primary DESC, created_at DESC').all(user.id);
      return sendJson(res, 200, { success: true, vehicles });
    }

    if (pathname === '/api/driver/vehicles' && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const body = await parseBody(req);
      const { manufacturer, model, batteryCapacityKwh, connectorType, registrationNo, currentSoc } = body;

      if (!manufacturer || !model || !connectorType) {
        return sendJson(res, 400, { error: 'Manufacturer, model, and connector type are required' });
      }

      const vehId = 'veh-' + Date.now();
      const hasVehicles = db.prepare('SELECT COUNT(*) AS count FROM vehicles WHERE user_id = ?').get(user.id).count > 0;
      const isPrimary = body.setPrimary || !hasVehicles ? 1 : 0;

      db.exec('BEGIN TRANSACTION;');
      try {
        if (isPrimary) {
          db.prepare('UPDATE vehicles SET is_primary = 0 WHERE user_id = ?').run(user.id);
        }
        db.prepare(`
          INSERT INTO vehicles (id, user_id, manufacturer, model, battery_capacity_kwh, connector_type, registration_no, current_soc, is_primary)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          vehId, user.id, manufacturer.trim(), model.trim(),
          parseFloat(batteryCapacityKwh) || 4.0,
          connectorType.trim(),
          (registrationNo || '').trim() || 'UP 16 EV 0001',
          parseFloat(currentSoc) || 50.0,
          isPrimary
        );
        db.exec('COMMIT;');
        const vehicles = db.prepare('SELECT * FROM vehicles WHERE user_id = ? ORDER BY is_primary DESC, created_at DESC').all(user.id);
        return sendJson(res, 201, { success: true, message: 'Vehicle added to garage', vehicles });
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }

    if (pathname.match(/^\/api\/driver\/vehicles\/([a-zA-Z0-9_-]+)\/primary$/) && req.method === 'PUT') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const vehId = pathname.split('/')[4];
      const existing = db.prepare('SELECT * FROM vehicles WHERE id = ? AND user_id = ?').get(vehId, user.id);
      if (!existing) return sendJson(res, 404, { error: 'Vehicle not found' });

      const body = await parseBody(req);
      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare('UPDATE vehicles SET is_primary = 0 WHERE user_id = ?').run(user.id);
        db.prepare('UPDATE vehicles SET is_primary = 1, current_soc = COALESCE(?, current_soc) WHERE id = ? AND user_id = ?')
          .run(body.currentSoc ? parseFloat(body.currentSoc) : null, vehId, user.id);
        db.exec('COMMIT;');
        const vehicles = db.prepare('SELECT * FROM vehicles WHERE user_id = ? ORDER BY is_primary DESC, created_at DESC').all(user.id);
        return sendJson(res, 200, { success: true, message: 'Primary vehicle updated', vehicles });
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }

    if (pathname.match(/^\/api\/driver\/vehicles\/([a-zA-Z0-9_-]+)$/) && req.method === 'DELETE') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const vehId = pathname.split('/')[4];
      db.prepare('DELETE FROM vehicles WHERE id = ? AND user_id = ?').run(vehId, user.id);
      const vehicles = db.prepare('SELECT * FROM vehicles WHERE user_id = ? ORDER BY is_primary DESC, created_at DESC').all(user.id);
      return sendJson(res, 200, { success: true, message: 'Vehicle removed from garage', vehicles });
    }

    // Driver Favorite Chargers Toggle
    if (pathname.match(/^\/api\/driver\/favorites\/([a-zA-Z0-9_-]+)$/) && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const chargerId = pathname.split('/')[4];
      const prof = db.prepare('SELECT favorite_chargers_json FROM driver_profiles WHERE user_id = ?').get(user.id);
      let favs = [];
      try { favs = JSON.parse(prof?.favorite_chargers_json || '[]'); } catch (e) {}

      let added = false;
      if (favs.includes(chargerId)) {
        favs = favs.filter(id => id !== chargerId);
      } else {
        favs.push(chargerId);
        added = true;
      }

      db.prepare('UPDATE driver_profiles SET favorite_chargers_json = ? WHERE user_id = ?').run(JSON.stringify(favs), user.id);
      return sendJson(res, 200, {
        success: true,
        added,
        favorites: favs,
        message: added ? 'Charger saved to favorites' : 'Charger removed from favorites'
      });
    }

    // Driver Charging History
    if (pathname === '/api/driver/sessions' && req.method === 'GET') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const sessions = db.prepare(`
        SELECT s.*, c.name AS charger_name, c.code AS charger_code, c.connector_type, c.billing_type
        FROM charging_sessions s
        JOIN chargers c ON s.charger_id = c.id
        WHERE s.driver_id = ?
        ORDER BY s.created_at DESC
        LIMIT 30
      `).all(user.id);
      return sendJson(res, 200, { success: true, count: sessions.length, sessions });
    }

    // =========================================================
    // 3. BOOKINGS & CONCURRENCY SLOT LOCKING
    // =========================================================

    // Create Booking (with Overlap Prevention & Slot Lock)
    if (pathname === '/api/bookings' && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });

      const body = await parseBody(req);
      const { chargerId, vehicleId, bookingDate, startTime, durationMins, billingType, estimatedKwh } = body;

      if (!chargerId || !bookingDate || !startTime || !durationMins) {
        return sendJson(res, 400, { error: 'Charger, date, start time, and duration are required' });
      }

      const charger = db.prepare('SELECT * FROM chargers WHERE id = ?').get(chargerId);
      if (!charger) {
        return sendJson(res, 404, { error: 'Charging dock not found' });
      }

      // Compute end time
      const [startH, startM] = startTime.split(':').map(Number);
      const endTotalMins = (startH * 60 + startM) + parseInt(durationMins);
      const endH = Math.floor(endTotalMins / 60) % 24;
      const endM = endTotalMins % 60;
      const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

      // ATOMIC CONCURRENCY CHECK: Prevent Overlapping Bookings on the Same Charger
      const overlap = db.prepare(`
        SELECT id, booking_code, start_time, end_time
        FROM bookings
        WHERE charger_id = ?
          AND booking_date = ?
          AND status IN ('pending', 'confirmed', 'active')
          AND NOT (end_time <= ? OR start_time >= ?)
      `).get(chargerId, bookingDate, startTime, endTime);

      if (overlap) {
        return sendJson(res, 409, {
          error: `Slot unavailable: Time overlaps with existing booking ${overlap.booking_code} (${overlap.start_time} - ${overlap.end_time})`,
          conflictingBooking: overlap
        });
      }

      // Calculate transparent billing
      const hours = parseInt(durationMins) / 60;
      let baseAmount = 0;
      const isTime = billingType === 'time' || charger.billing_type === 'time';

      if (isTime) {
        baseAmount = parseFloat((hours * (charger.time_rate_per_hour || 20.00)).toFixed(2));
      } else {
        const kwh = parseFloat(estimatedKwh) || (charger.power_kw * hours * 0.75);
        baseAmount = parseFloat((kwh * (charger.price_per_kwh || 12.00)).toFixed(2));
      }

      const platformFee = parseFloat((baseAmount * 0.10).toFixed(2)); // 10% Platform fee
      const gstFee = parseFloat((platformFee * 0.18).toFixed(2));     // 18% GST on platform fee
      const depositAmount = 50.00; // Refundable deposit
      const totalAmount = parseFloat((baseAmount + platformFee + gstFee).toFixed(2));
      const hostPayout = parseFloat((baseAmount).toFixed(2));

      // Wallet check
      if (user.wallet_balance < totalAmount) {
        return sendJson(res, 402, {
          error: `Insufficient wallet balance. Required: ₹${totalAmount.toFixed(2)}, Available: ₹${user.wallet_balance.toFixed(2)}. Please recharge your wallet.`
        });
      }

      const bookingId = 'bk-' + Date.now();
      const bookingCode = 'CE-BK-' + Math.floor(1000 + Math.random() * 9000);

      db.exec('BEGIN TRANSACTION;');
      try {
        // Deduct from driver wallet
        db.prepare("UPDATE users SET wallet_balance = wallet_balance - ?, updated_at = datetime('now') WHERE id = ?")
          .run(totalAmount, user.id);

        // Insert booking
        db.prepare(`
          INSERT INTO bookings (
            id, booking_code, driver_id, host_id, charger_id, vehicle_id,
            booking_date, start_time, end_time, duration_mins, status,
            billing_type, estimated_kwh, base_amount, platform_fee, gst_fee,
            deposit_amount, total_amount, host_payout, payment_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, 'paid')
        `).run(
          bookingId, bookingCode, user.id, charger.host_id, charger.id, vehicleId || null,
          bookingDate, startTime, endTime, parseInt(durationMins),
          isTime ? 'time' : 'metered',
          isTime ? null : (parseFloat(estimatedKwh) || 5.0),
          baseAmount, platformFee, gstFee, depositAmount, totalAmount, hostPayout
        );

        // Transaction record
        db.prepare(`
          INSERT INTO payments (id, user_id, booking_id, amount, payment_method, transaction_ref, status, type, description)
          VALUES (?, ?, ?, ?, 'WALLET', ?, 'success', 'booking_payment', ?)
        `).run('pay-' + Date.now(), user.id, bookingId, totalAmount, 'TXN-' + Date.now(), `Slot booking ${bookingCode} for ${charger.name}`);

        // Driver notification
        db.prepare(`
          INSERT INTO notifications (id, user_id, title, message, type)
          VALUES (?, ?, ?, ?, 'booking')
        `).run('notif-' + Date.now(), user.id, 'Booking Confirmed', `Your slot ${bookingCode} at ${charger.name} is confirmed for ${bookingDate} at ${startTime}.`);

        // Host notification
        db.prepare(`
          INSERT INTO notifications (id, user_id, title, message, type)
          VALUES (?, ?, ?, ?, 'host')
        `).run('notif-' + (Date.now() + 1), charger.host_id, 'New Confirmed Booking', `Driver ${user.name} booked ${charger.name} for ${bookingDate} (${startTime} - ${endTime}).`);

        db.exec('COMMIT;');

        return sendJson(res, 201, {
          success: true,
          message: 'Booking successfully confirmed with slot lock',
          booking: {
            id: bookingId,
            bookingCode,
            chargerName: charger.name,
            bookingDate,
            startTime,
            endTime,
            durationMins,
            totalAmount,
            platformFee,
            gstFee,
            billingType: isTime ? 'time' : 'metered',
            walletBalanceRemaining: user.wallet_balance - totalAmount
          }
        });
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }

    // Driver Bookings List
    if (pathname === '/api/driver/bookings' && req.method === 'GET') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });

      const list = db.prepare(`
        SELECT b.*, c.name AS charger_name,
               CASE WHEN b.status IN ('confirmed', 'active', 'completed') THEN c.address ELSE c.city || ' (Protected until confirmed)' END AS charger_address,
               CASE WHEN b.status IN ('confirmed', 'active', 'completed') THEN c.access_instructions ELSE 'Unlocked upon host confirmation' END AS access_instructions,
               c.code AS charger_code,
               c.power_kw, c.connector_type, u.name AS host_name,
               CASE WHEN b.status IN ('confirmed', 'active', 'completed') THEN u.phone ELSE NULL END AS host_phone
        FROM bookings b
        JOIN chargers c ON b.charger_id = c.id
        JOIN users u ON b.host_id = u.id
        WHERE b.driver_id = ?
        ORDER BY b.created_at DESC
      `).all(user.id);

      return sendJson(res, 200, { success: true, count: list.length, bookings: list });
    }

    // Cancel Booking
    if (pathname.match(/^\/api\/bookings\/([a-zA-Z0-9_-]+)\/cancel$/) && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const bookingId = pathname.split('/')[3];

      const bk = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
      if (!bk) return sendJson(res, 404, { error: 'Booking not found' });
      if (bk.driver_id !== user.id && user.role !== 'admin') {
        return sendJson(res, 403, { error: 'Unauthorized to cancel this booking' });
      }

      if (['cancelled', 'completed', 'rejected'].includes(bk.status)) {
        return sendJson(res, 400, { error: `Cannot cancel a booking that is already ${bk.status}` });
      }

      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare("UPDATE bookings SET status = 'cancelled', cancellation_reason = 'Cancelled by user' WHERE id = ?").run(bookingId);

        // Refund driver
        db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?').run(bk.total_amount, bk.driver_id);

        db.prepare(`
          INSERT INTO payments (id, user_id, booking_id, amount, payment_method, transaction_ref, status, type, description)
          VALUES (?, ?, ?, ?, 'WALLET', ?, 'success', 'refund', ?)
        `).run('pay-' + Date.now(), bk.driver_id, bookingId, bk.total_amount, 'REF-' + Date.now(), `Refund for cancelled booking ${bk.booking_code}`);

        db.prepare(`
          INSERT INTO notifications (id, user_id, title, message, type)
          VALUES (?, ?, ?, ?, 'booking')
        `).run('notif-' + Date.now(), bk.driver_id, 'Booking Cancelled & Refunded', `Your booking ${bk.booking_code} was cancelled. ₹${bk.total_amount.toFixed(2)} refunded to wallet.`);

        db.exec('COMMIT;');

        return sendJson(res, 200, { success: true, message: 'Booking cancelled and refunded successfully' });
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }

    // =========================================================
    // 4. HOST DASHBOARD & CHARGER MANAGEMENT
    // =========================================================

    // Host Dashboard Aggregates
    if (pathname === '/api/host/dashboard' && req.method === 'GET') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      if (user.role !== 'host' && user.role !== 'admin') {
        return sendJson(res, 403, { error: 'Host privileges required' });
      }

      const totalChargers = db.prepare('SELECT COUNT(*) AS count FROM chargers WHERE host_id = ?').get(user.id).count;
      const activeChargers = db.prepare("SELECT COUNT(*) AS count FROM chargers WHERE host_id = ? AND is_power_on = 1 AND status = 'available'").get(user.id).count;

      const pendingBookings = db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE host_id = ? AND status = 'pending'").get(user.id).count;
      const confirmedBookings = db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE host_id = ? AND status = 'confirmed'").get(user.id).count;
      const completedSessions = db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE host_id = ? AND status = 'completed'").get(user.id).count;

      const earnings = db.prepare(`
        SELECT 
          COALESCE(SUM(host_payout), 0) AS total_earnings,
          COALESCE(SUM(CASE WHEN created_at >= date('now', 'start of month') THEN host_payout ELSE 0 END), 0) AS monthly_earnings
        FROM bookings
        WHERE host_id = ? AND status = 'completed'
      `).get(user.id);

      const hostChargers = db.prepare('SELECT * FROM chargers WHERE host_id = ? ORDER BY created_at DESC').all(user.id);

      const recentHostBookings = db.prepare(`
        SELECT b.*, c.name AS charger_name, u.name AS driver_name, u.phone AS driver_phone
        FROM bookings b
        JOIN chargers c ON b.charger_id = c.id
        JOIN users u ON b.driver_id = u.id
        WHERE b.host_id = ?
        ORDER BY b.created_at DESC
        LIMIT 10
      `).all(user.id);

      return sendJson(res, 200, {
        success: true,
        hostName: user.name,
        metrics: {
          totalChargers,
          activeChargers,
          pendingBookings,
          confirmedBookings,
          completedSessions,
          totalEarnings: earnings.total_earnings,
          monthlyEarnings: earnings.monthly_earnings,
          utilizationPercent: totalChargers > 0 ? Math.min(100, Math.round((completedSessions * 8) / (totalChargers * 30) * 100)) : 0
        },
        chargers: hostChargers,
        bookings: recentHostBookings
      });
    }

    // Host Chargers List
    if (pathname === '/api/host/chargers' && req.method === 'GET') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const list = db.prepare('SELECT * FROM chargers WHERE host_id = ? ORDER BY created_at DESC').all(user.id);
      return sendJson(res, 200, { success: true, count: list.length, chargers: list });
    }

    // Host Add Charger
    if (pathname === '/api/host/chargers' && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      if (user.role !== 'host' && user.role !== 'admin') {
        return sendJson(res, 403, { error: 'Host privileges required' });
      }

      const body = await parseBody(req);
      const { name, address, city, lat, lng, connectorType, powerKw, billingType, pricePerKwh, timeRatePerHour, operatingHours, accessInstructions, description } = body;

      if (!name || !address || !connectorType) {
        return sendJson(res, 400, { error: 'Name, address, and connector type are required' });
      }

      const chargerId = 'ce-chg-' + Date.now();
      const code = 'CE-DEL-' + Math.floor(200 + Math.random() * 800);

      db.prepare(`
        INSERT INTO chargers (
          id, host_id, code, name, description, address, city, lat, lng,
          connector_type, power_kw, billing_type, price_per_kwh, time_rate_per_hour,
          status, operating_hours, access_instructions, is_power_on, verification_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, 1, 'approved')
      `).run(
        chargerId, user.id, code, name.trim(), description || '',
        address.trim(), city || 'Delhi NCR',
        parseFloat(lat) || 28.5355, parseFloat(lng) || 77.3910,
        connectorType, parseFloat(powerKw) || 7.4,
        billingType === 'time' ? 'time' : 'metered',
        parseFloat(pricePerKwh) || 12.00,
        parseFloat(timeRatePerHour) || 20.00,
        operatingHours || '24/7 Access',
        accessInstructions || 'Host instructions provided after booking.'
      );

      return sendJson(res, 201, {
        success: true,
        message: 'Charger listed successfully and published to network',
        chargerId,
        code
      });
    }

    // Host Edit Charger
    if (pathname.match(/^\/api\/host\/chargers\/([a-zA-Z0-9_-]+)$/) && req.method === 'PUT') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const chargerId = pathname.split('/')[4];

      const chg = db.prepare('SELECT * FROM chargers WHERE id = ?').get(chargerId);
      if (!chg) return sendJson(res, 404, { error: 'Charger not found' });
      if (chg.host_id !== user.id && user.role !== 'admin') {
        return sendJson(res, 403, { error: 'Unauthorized to modify this charger' });
      }

      const body = await parseBody(req);
      db.prepare(`
        UPDATE chargers
        SET name = COALESCE(?, name),
            description = COALESCE(?, description),
            address = COALESCE(?, address),
            connector_type = COALESCE(?, connector_type),
            power_kw = COALESCE(?, power_kw),
            billing_type = COALESCE(?, billing_type),
            price_per_kwh = COALESCE(?, price_per_kwh),
            time_rate_per_hour = COALESCE(?, time_rate_per_hour),
            operating_hours = COALESCE(?, operating_hours),
            access_instructions = COALESCE(?, access_instructions),
            status = COALESCE(?, status)
        WHERE id = ?
      `).run(
        body.name || null,
        body.description || null,
        body.address || null,
        body.connectorType || null,
        body.powerKw ? parseFloat(body.powerKw) : null,
        body.billingType || null,
        body.pricePerKwh ? parseFloat(body.pricePerKwh) : null,
        body.timeRatePerHour ? parseFloat(body.timeRatePerHour) : null,
        body.operatingHours || null,
        body.accessInstructions || null,
        body.status || null,
        chargerId
      );

      return sendJson(res, 200, { success: true, message: 'Charger updated successfully' });
    }

    // Host Earnings & Payout Ledger
    if (pathname === '/api/host/earnings' && req.method === 'GET') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      if (user.role !== 'host' && user.role !== 'admin') {
        return sendJson(res, 403, { error: 'Host privileges required' });
      }

      const summary = db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END), 0) AS total_gross,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN platform_fee + gst_fee ELSE 0 END), 0) AS total_commission_deducted,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN host_payout ELSE 0 END), 0) AS net_host_earnings,
          COALESCE(SUM(CASE WHEN status IN ('confirmed', 'active') THEN host_payout ELSE 0 END), 0) AS pending_confirmed_payouts
        FROM bookings
        WHERE host_id = ?
      `).get(user.id);

      const payoutLedger = db.prepare(`
        SELECT b.id, b.booking_code, b.booking_date, b.start_time, b.end_time, b.status,
               b.billing_type, b.base_amount, b.platform_fee, b.gst_fee, b.total_amount, b.host_payout,
               c.name AS charger_name, u.name AS driver_name
        FROM bookings b
        JOIN chargers c ON b.charger_id = c.id
        JOIN users u ON b.driver_id = u.id
        WHERE b.host_id = ? AND b.status IN ('confirmed', 'active', 'completed')
        ORDER BY b.created_at DESC
        LIMIT 30
      `).all(user.id);

      return sendJson(res, 200, {
        success: true,
        summary,
        payoutLedger
      });
    }

    // Host Remote Power Toggle (Hardware IoT Simulation)
    if (pathname.match(/^\/api\/host\/chargers\/([a-zA-Z0-9_-]+)\/toggle-power$/) && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const chargerId = pathname.split('/')[4];

      const chg = db.prepare('SELECT * FROM chargers WHERE id = ?').get(chargerId);
      if (!chg) return sendJson(res, 404, { error: 'Charger not found' });
      if (chg.host_id !== user.id && user.role !== 'admin') {
        return sendJson(res, 403, { error: 'Unauthorized to switch power for this charger' });
      }

      const newPower = chg.is_power_on ? 0 : 1;
      const newStatus = newPower ? 'available' : 'offline';

      db.prepare('UPDATE chargers SET is_power_on = ?, status = ? WHERE id = ?').run(newPower, newStatus, chargerId);

      return sendJson(res, 200, {
        success: true,
        isPowerOn: !!newPower,
        status: newStatus,
        message: `Remote IoT switch ${newPower ? 'ACTIVATED (Power ON)' : 'DEACTIVATED (Power OFF)'} for ${chg.name}`
      });
    }

    // Host Accept / Reject Booking
    if (pathname.match(/^\/api\/host\/bookings\/([a-zA-Z0-9_-]+)\/(accept|reject)$/) && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const parts = pathname.split('/');
      const bookingId = parts[4];
      const action = parts[5]; // 'accept' or 'reject'

      const bk = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
      if (!bk) return sendJson(res, 404, { error: 'Booking not found' });
      if (bk.host_id !== user.id && user.role !== 'admin') {
        return sendJson(res, 403, { error: 'Unauthorized to manage this booking' });
      }

      if (action === 'accept') {
        db.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ?").run(bookingId);
        db.prepare(`
          INSERT INTO notifications (id, user_id, title, message, type)
          VALUES (?, ?, ?, ?, 'booking')
        `).run('notif-' + Date.now(), bk.driver_id, 'Booking Accepted', `Host approved your booking ${bk.booking_code}. You are good to charge.`);
        return sendJson(res, 200, { success: true, message: 'Booking accepted' });
      } else {
        db.exec('BEGIN TRANSACTION;');
        try {
          db.prepare("UPDATE bookings SET status = 'rejected', cancellation_reason = 'Host declined request' WHERE id = ?").run(bookingId);
          // Refund driver
          db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?').run(bk.total_amount, bk.driver_id);
          db.prepare(`
            INSERT INTO notifications (id, user_id, title, message, type)
            VALUES (?, ?, ?, ?, 'booking')
          `).run('notif-' + Date.now(), bk.driver_id, 'Booking Declined & Refunded', `Host was unable to accept booking ${bk.booking_code}. Full refund credited to your wallet.`);
          db.exec('COMMIT;');
          return sendJson(res, 200, { success: true, message: 'Booking rejected and driver refunded' });
        } catch (e) {
          db.exec('ROLLBACK;');
          throw e;
        }
      }
    }

    // =========================================================
    // 5. LIVE CHARGING SESSION TELEMETRY ENGINE
    // =========================================================

    // Start Live Session
    if (pathname === '/api/sessions/start' && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const body = await parseBody(req);
      const { chargerCode, bookingId } = body;

      let charger = null;
      if (chargerCode) {
        charger = db.prepare('SELECT * FROM chargers WHERE UPPER(code) = ?').get(chargerCode.toUpperCase().trim());
      }
      if (!charger) {
        charger = db.prepare("SELECT * FROM chargers WHERE status = 'available' AND verification_status = 'approved' LIMIT 1").get();
      }

      if (!charger) {
        return sendJson(res, 400, { error: 'No available charging dock found' });
      }

      const sessionId = 'ses-' + Date.now();
      const sessionCode = 'SES-' + Math.floor(10000 + Math.random() * 90000);

      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare("UPDATE chargers SET status = 'busy' WHERE id = ?").run(charger.id);

        db.prepare(`
          INSERT INTO charging_sessions (
            id, session_code, booking_id, charger_id, driver_id, host_id,
            instant_power_kw, voltage, current_amps, session_status, is_simulated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 231.5, ?, 'active', 1)
        `).run(
          sessionId, sessionCode, bookingId || null, charger.id, user.id, charger.host_id,
          charger.power_kw, parseFloat(((charger.power_kw * 1000) / 231.5).toFixed(1))
        );

        db.exec('COMMIT;');

        return sendJson(res, 201, {
          success: true,
          message: 'Hardware handshake initiated. Charging started.',
          session: {
            id: sessionId,
            sessionCode,
            chargerId: charger.id,
            chargerName: charger.name,
            powerKw: charger.power_kw,
            billingType: charger.billing_type,
            pricePerKwh: charger.price_per_kwh,
            timeRatePerHour: charger.time_rate_per_hour,
            isSimulated: true,
            status: 'active'
          }
        });
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }

    // Stop Session & Settle Billing
    if (pathname.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/stop$/) && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const sessionId = pathname.split('/')[3];
      const body = await parseBody(req);
      const { energyKwh, elapsedSeconds } = body;

      const ses = db.prepare('SELECT * FROM charging_sessions WHERE id = ?').get(sessionId);
      if (!ses) return sendJson(res, 404, { error: 'Session not found' });

      const chg = db.prepare('SELECT * FROM chargers WHERE id = ?').get(ses.charger_id);

      const kwh = parseFloat(energyKwh) || ses.energy_delivered_kwh || 5.0;
      const durationSecs = parseInt(elapsedSeconds) || ses.duration_seconds || 1800;
      const hours = durationSecs / 3600;

      let baseCost = 0;
      const isTime = chg.billing_type === 'time';
      if (isTime) {
        baseCost = parseFloat((hours * chg.time_rate_per_hour).toFixed(2));
      } else {
        baseCost = parseFloat((kwh * chg.price_per_kwh).toFixed(2));
      }

      const platformFee = parseFloat((baseCost * 0.10).toFixed(2));
      const gst = parseFloat((platformFee * 0.18).toFixed(2));
      const totalCost = parseFloat((baseCost + platformFee + gst).toFixed(2));
      const hostPayout = baseCost;

      db.exec('BEGIN TRANSACTION;');
      try {
        // Complete session
        db.prepare(`
          UPDATE charging_sessions
          SET end_time = datetime('now'),
              duration_seconds = ?,
              energy_delivered_kwh = ?,
              final_cost = ?,
              session_status = 'completed'
          WHERE id = ?
        `).run(durationSecs, kwh, totalCost, sessionId);

        // Release charger
        db.prepare("UPDATE chargers SET status = 'available', total_sessions = total_sessions + 1 WHERE id = ?").run(chg.id);

        // Debit driver wallet if not already prepaid
        if (!ses.booking_id) {
          db.prepare('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?').run(totalCost, user.id);
          db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?').run(hostPayout, chg.host_id);

          db.prepare(`
            INSERT INTO payments (id, user_id, session_id, amount, payment_method, transaction_ref, status, type, description)
            VALUES (?, ?, ?, ?, 'WALLET', ?, 'success', 'session_debit', ?)
          `).run('pay-' + Date.now(), user.id, sessionId, totalCost, 'TXN-SES-' + Date.now(), `Charging session ${ses.session_code}`);
        } else {
          // If booked, mark booking complete and credit host
          db.prepare("UPDATE bookings SET status = 'completed' WHERE id = ?").run(ses.booking_id);
          db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?').run(hostPayout, chg.host_id);
        }

        // Notifications
        db.prepare(`
          INSERT INTO notifications (id, user_id, title, message, type)
          VALUES (?, ?, ?, ?, 'session')
        `).run('notif-' + Date.now(), user.id, 'Session Completed', `Charging finished! ${kwh.toFixed(2)} kWh delivered. Total: ₹${totalCost.toFixed(2)}.`);

        db.prepare(`
          INSERT INTO notifications (id, user_id, title, message, type)
          VALUES (?, ?, ?, ?, 'host')
        `).run('notif-' + (Date.now() + 1), chg.host_id, 'Host Payout Credited', `Session on ${chg.name} completed. Payout of ₹${hostPayout.toFixed(2)} credited to your account.`);

        db.exec('COMMIT;');

        return sendJson(res, 200, {
          success: true,
          receipt: {
            sessionCode: ses.session_code,
            chargerName: chg.name,
            kwhDelivered: kwh,
            durationSeconds: durationSecs,
            billingType: chg.billing_type,
            baseCost,
            platformFee,
            gst,
            totalCost,
            hostPayout,
            isSimulated: true,
            disclaimer: isTime ? 'Time billing is not an exact energy measure.' : null
          }
        });
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }

    // =========================================================
    // 6. ADMIN DASHBOARD & PLATFORM OVERSIGHT
    // =========================================================

    // Admin Dashboard Summary
    if (pathname === '/api/admin/dashboard' && req.method === 'GET') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      if (user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });

      const totalUsers = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'driver'").get().count;
      const totalHosts = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'host'").get().count;
      const totalChargers = db.prepare('SELECT COUNT(*) AS count FROM chargers').get().count;
      const pendingHosts = db.prepare("SELECT COUNT(*) AS count FROM host_profiles WHERE verification_status = 'pending'").get().count;
      const activeBookings = db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE status IN ('confirmed', 'active')").get().count;
      const completedSessions = db.prepare("SELECT COUNT(*) AS count FROM charging_sessions WHERE session_status = 'completed'").get().count;

      const finance = db.prepare(`
        SELECT 
          COALESCE(SUM(total_amount), 0) AS total_gmv,
          COALESCE(SUM(platform_fee), 0) AS platform_revenue,
          COALESCE(SUM(gst_fee), 0) AS total_gst
        FROM bookings
        WHERE status = 'completed'
      `).get();

      const recentLogs = db.prepare(`
        SELECT l.*, u.name AS admin_name
        FROM admin_activity_logs l
        JOIN users u ON l.admin_id = u.id
        ORDER BY l.created_at DESC
        LIMIT 10
      `).all();

      return sendJson(res, 200, {
        success: true,
        metrics: {
          totalUsers,
          totalHosts,
          totalChargers,
          pendingHosts,
          activeBookings,
          completedSessions,
          totalGmv: finance.total_gmv,
          platformRevenue: finance.platform_revenue,
          totalGst: finance.total_gst
        },
        logs: recentLogs
      });
    }

    // Admin Users Management
    if (pathname === '/api/admin/users' && req.method === 'GET') {
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });

      const usersList = db.prepare(`
        SELECT id, email, role, name, phone, wallet_balance, is_verified, is_suspended, created_at
        FROM users
        ORDER BY created_at DESC
      `).all();

      return sendJson(res, 200, { success: true, count: usersList.length, users: usersList });
    }

    // Admin Toggle User Suspension
    if (pathname.match(/^\/api\/admin\/users\/([a-zA-Z0-9_-]+)\/toggle-suspend$/) && req.method === 'POST') {
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });
      const targetUserId = pathname.split('/')[4];

      const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
      if (!target) return sendJson(res, 404, { error: 'User not found' });
      if (target.role === 'admin') return sendJson(res, 400, { error: 'Cannot suspend an administrator' });

      const newSuspended = target.is_suspended ? 0 : 1;
      db.prepare('UPDATE users SET is_suspended = ? WHERE id = ?').run(newSuspended, targetUserId);

      db.prepare(`
        INSERT INTO admin_activity_logs (id, admin_id, action, target_type, target_id, details)
        VALUES (?, ?, ?, 'USER', ?, ?)
      `).run('log-' + Date.now(), user.id, newSuspended ? 'SUSPEND_USER' : 'UNSUSPEND_USER', targetUserId, `Suspension status changed to ${newSuspended}`);

      return sendJson(res, 200, {
        success: true,
        isSuspended: !!newSuspended,
        message: `User ${target.name} (${target.email}) has been ${newSuspended ? 'suspended' : 'reinstated'}`
      });
    }

    // Admin Hosts List & Verification
    if (pathname === '/api/admin/hosts' && req.method === 'GET') {
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });

      const hosts = db.prepare(`
        SELECT u.id AS user_id, u.name, u.email, u.phone, u.wallet_balance,
               hp.address, hp.city, hp.pincode, hp.upi_id, hp.verification_status, hp.rating, hp.created_at
        FROM users u
        JOIN host_profiles hp ON u.id = hp.user_id
        ORDER BY hp.created_at DESC
      `).all();

      return sendJson(res, 200, { success: true, count: hosts.length, hosts });
    }

    // Admin Verify Host
    if (pathname.match(/^\/api\/admin\/hosts\/([a-zA-Z0-9_-]+)\/verify$/) && req.method === 'POST') {
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });
      const targetHostId = pathname.split('/')[4];
      const body = await parseBody(req);
      const { status, reason } = body; // 'verified' or 'rejected'

      db.prepare(`
        UPDATE host_profiles
        SET verification_status = ?, rejection_reason = ?
        WHERE user_id = ?
      `).run(status === 'rejected' ? 'rejected' : 'verified', reason || null, targetHostId);

      db.prepare(`
        INSERT INTO notifications (id, user_id, title, message, type)
        VALUES (?, ?, ?, ?, 'system')
      `).run('notif-' + Date.now(), targetHostId, 'Host Verification Status Updated', `Your host account verification is now: ${status.toUpperCase()}.`);

      db.prepare(`
        INSERT INTO admin_activity_logs (id, admin_id, action, target_type, target_id, details)
        VALUES (?, ?, 'VERIFY_HOST', 'HOST', ?, ?)
      `).run('log-' + Date.now(), user.id, targetHostId, `Set verification status to ${status}`);

      return sendJson(res, 200, { success: true, message: `Host verification set to ${status}` });
    }

    // Admin Chargers Audit
    if (pathname === '/api/admin/chargers' && req.method === 'GET') {
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });

      const allChargers = db.prepare(`
        SELECT c.*, u.name AS host_name, u.email AS host_email
        FROM chargers c
        JOIN users u ON c.host_id = u.id
        ORDER BY c.created_at DESC
      `).all();

      return sendJson(res, 200, { success: true, count: allChargers.length, chargers: allChargers });
    }

    // Admin Verify Charger
    if (pathname.match(/^\/api\/admin\/chargers\/([a-zA-Z0-9_-]+)\/verify$/) && req.method === 'POST') {
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });
      const chargerId = pathname.split('/')[4];
      const body = await parseBody(req);
      const { status } = body; // 'approved' or 'rejected'

      db.prepare('UPDATE chargers SET verification_status = ? WHERE id = ?').run(status === 'rejected' ? 'rejected' : 'approved', chargerId);

      return sendJson(res, 200, { success: true, message: `Charger listing status updated to ${status}` });
    }

    // Admin Platform Bookings Monitor
    if (pathname === '/api/admin/bookings' && req.method === 'GET') {
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });
      const bookings = db.prepare(`
        SELECT b.*, c.name AS charger_name, d.name AS driver_name, h.name AS host_name
        FROM bookings b
        JOIN chargers c ON b.charger_id = c.id
        JOIN users d ON b.driver_id = d.id
        JOIN users h ON b.host_id = h.id
        ORDER BY b.created_at DESC
        LIMIT 50
      `).all();
      return sendJson(res, 200, { success: true, bookings });
    }

    // Admin Platform Transactions Monitor
    if (pathname === '/api/admin/transactions' && req.method === 'GET') {
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });
      const transactions = db.prepare(`
        SELECT p.*, u.name AS user_name, u.email AS user_email
        FROM payments p
        JOIN users u ON p.user_id = u.id
        ORDER BY p.created_at DESC
        LIMIT 50
      `).all();
      return sendJson(res, 200, { success: true, transactions });
    }

    // Admin Disputes List
    if (pathname === '/api/admin/disputes' && req.method === 'GET') {
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });
      const disputes = db.prepare(`
        SELECT d.*, b.booking_code, b.total_amount, c.name AS charger_name, u.name AS raised_by_name, u.role AS raised_by_role
        FROM disputes d
        JOIN bookings b ON d.booking_id = b.id
        JOIN chargers c ON b.charger_id = c.id
        JOIN users u ON d.raised_by_id = u.id
        ORDER BY d.created_at DESC
      `).all();
      return sendJson(res, 200, { success: true, disputes });
    }

    // Admin Resolve / Dismiss Dispute
    if (pathname.match(/^\/api\/admin\/disputes\/([a-zA-Z0-9_-]+)\/resolve$/) && req.method === 'POST') {
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });
      const disputeId = pathname.split('/')[4];
      const body = await parseBody(req);
      const status = body.status === 'dismissed' ? 'dismissed' : 'resolved';
      const resolutionNotes = (body.resolutionNotes || 'Reviewed by platform operations.').trim();

      const disp = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId);
      if (!disp) return sendJson(res, 404, { error: 'Dispute record not found' });

      db.prepare('UPDATE disputes SET status = ?, resolution_notes = ? WHERE id = ?').run(status, resolutionNotes, disputeId);
      db.prepare(`
        INSERT INTO notifications (id, user_id, title, message, type)
        VALUES (?, ?, ?, ?, 'system')
      `).run('notif-' + Date.now(), disp.raised_by_id, 'Dispute Update', `Your reported issue has been marked as ${status}: ${resolutionNotes}`);
      db.prepare(`
        INSERT INTO admin_activity_logs (id, admin_id, action, target_type, target_id, details)
        VALUES (?, ?, 'RESOLVE_DISPUTE', 'DISPUTE', ?, ?)
      `).run('log-' + Date.now(), user.id, disputeId, `${status.toUpperCase()}: ${resolutionNotes}`);

      return sendJson(res, 200, { success: true, message: `Dispute ${status}` });
    }

    // Raise Booking Dispute (Driver / Host)
    if (pathname === '/api/disputes' && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const body = await parseBody(req);
      const { bookingId, reason } = body;
      if (!bookingId || !reason || !reason.trim()) {
        return sendJson(res, 400, { error: 'Booking ID and dispute reason are required' });
      }

      const bk = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
      if (!bk) return sendJson(res, 404, { error: 'Booking not found' });
      if (bk.driver_id !== user.id && bk.host_id !== user.id && user.role !== 'admin') {
        return sendJson(res, 403, { error: 'Unauthorized to dispute this booking' });
      }

      const dispId = 'disp-' + Date.now();
      db.prepare("INSERT INTO disputes (id, booking_id, raised_by_id, reason, status) VALUES (?, ?, ?, ?, 'open')")
        .run(dispId, bookingId, user.id, reason.trim());

      return sendJson(res, 201, { success: true, message: 'Issue report submitted to platform administrators', disputeId: dispId });
    }

    // =========================================================
    // 7. WALLET & NOTIFICATIONS
    // =========================================================

    // Top-up Wallet (Simulated UPI Payment Gateway)
    if (pathname === '/api/wallet/topup' && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const body = await parseBody(req);
      const amount = parseFloat(body.amount);

      if (!amount || amount <= 0) {
        return sendJson(res, 400, { error: 'Valid recharge amount required' });
      }

      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?').run(amount, user.id);

        const ref = 'UPI-' + Date.now() + '-' + Math.floor(100 + Math.random() * 900);
        db.prepare(`
          INSERT INTO payments (id, user_id, amount, payment_method, transaction_ref, status, type, description)
          VALUES (?, ?, ?, 'UPI', ?, 'success', 'wallet_recharge', ?)
        `).run('pay-' + Date.now(), user.id, amount, ref, `UPI Instant Wallet Topup (+₹${amount.toFixed(2)})`);

        db.prepare(`
          INSERT INTO notifications (id, user_id, title, message, type)
          VALUES (?, ?, ?, ?, 'payment')
        `).run('notif-' + Date.now(), user.id, 'Wallet Recharged', `₹${amount.toFixed(2)} has been credited to your ChargeEase wallet.`);

        db.exec('COMMIT;');

        const updatedUser = db.prepare('SELECT wallet_balance FROM users WHERE id = ?').get(user.id);
        return sendJson(res, 200, {
          success: true,
          message: `Recharge of ₹${amount.toFixed(2)} successful via simulated UPI`,
          transactionRef: ref,
          newBalance: updatedUser.wallet_balance
        });
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }

    // User Transactions Ledger
    if (pathname === '/api/wallet/transactions' && req.method === 'GET') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });

      const txns = db.prepare(`
        SELECT * FROM payments
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 30
      `).all(user.id);

      return sendJson(res, 200, { success: true, count: txns.length, transactions: txns });
    }

    // Notifications List
    if (pathname === '/api/notifications' && req.method === 'GET') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });

      const notifs = db.prepare(`
        SELECT * FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 20
      `).all(user.id);

      return sendJson(res, 200, { success: true, notifications: notifs });
    }

    // Mark Notification Read
    if (pathname.match(/^\/api\/notifications\/([a-zA-Z0-9_-]+)\/read$/) && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });
      const notifId = pathname.split('/')[3];

      db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(notifId, user.id);
      return sendJson(res, 200, { success: true });
    }

    // Mark All Notifications Read
    if (pathname === '/api/notifications/read-all' && req.method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Authentication required' });

      db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(user.id);
      return sendJson(res, 200, { success: true });
    }

    // 404 for unknown API routes
    return sendJson(res, 404, { error: `Endpoint ${req.method} ${pathname} not found` });

  } catch (err) {
    console.error('[API ERROR]', err);
    return sendJson(res, 500, { error: 'Internal Server Error', details: err.message });
  }
}

module.exports = {
  handleApiRequest
};
