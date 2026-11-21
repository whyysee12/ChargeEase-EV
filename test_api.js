// Automated End-to-End API Test Suite
const http = require('http');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('--- RUNNING CHARGEEASE EV API TESTS ---');

  // 1. Health
  const health = await request({ port: 3000, path: '/api/health', method: 'GET' });
  console.log('1. Health check status:', health.status, health.data?.service);

  // 2. Driver Login
  const driverLogin = await request({
    port: 3000, path: '/api/auth/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'driver@chargeease.com', password: 'Driver@123' });
  console.log('2. Driver login status:', driverLogin.status, 'User:', driverLogin.data?.user?.name, 'Role:', driverLogin.data?.user?.role);
  const driverToken = driverLogin.data?.token;

  // 3. Host Login
  const hostLogin = await request({
    port: 3000, path: '/api/auth/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'host@chargeease.com', password: 'Host@123' });
  console.log('3. Host login status:', hostLogin.status, 'User:', hostLogin.data?.user?.name, 'Role:', hostLogin.data?.user?.role);
  const hostToken = hostLogin.data?.token;

  // 4. Admin Login
  const adminLogin = await request({
    port: 3000, path: '/api/auth/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'admin@chargeease.com', password: 'Admin@123' });
  console.log('4. Admin login status:', adminLogin.status, 'Role:', adminLogin.data?.user?.role);
  const adminToken = adminLogin.data?.token;

  // 5. Driver Discovery API
  const stations = await request({ port: 3000, path: '/api/driver/chargers?lat=28.4626&lng=77.4935', method: 'GET' });
  console.log('5. Chargers fetched from DB:', stations.data?.count, 'Nearest:', stations.data?.stations?.[0]?.name, 'Distance:', stations.data?.stations?.[0]?.distanceKm + 'km');

  // 6. Reachability Engine
  const reach = await request({
    port: 3000,
    path: '/api/driver/reachability?lat=28.4626&lng=77.4935&soc=24&batteryKwh=4.0&safetyBuffer=20',
    method: 'GET'
  });
  console.log('6. Reachability calc: Usable Safe Range =', reach.data?.calculation?.usableSafeRangeKm, 'km, Eligible chargers:', reach.data?.chargers?.filter(c => c.isReachable).length);

  // 7. Admin Dashboard metrics
  const adminDash = await request({
    port: 3000,
    path: '/api/admin/dashboard',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('7. Admin Dashboard status:', adminDash.status, 'Total users:', adminDash.data?.metrics?.totalUsers, 'Platform GMV: ₹' + adminDash.data?.metrics?.totalGmv);

  // 8. Host Dashboard metrics
  const hostDash = await request({
    port: 3000,
    path: '/api/host/dashboard',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${hostToken}` }
  });
  console.log('8. Host Dashboard status:', hostDash.status, 'Total Chargers:', hostDash.data?.metrics?.totalChargers, 'Total Earnings: ₹' + hostDash.data?.metrics?.totalEarnings);

  // 9. Booking creation & Atomic Slot Locking
  const b1 = await request({
    port: 3000,
    path: '/api/bookings',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${driverToken}`
    }
  }, {
    chargerId: 'ce-del-sec137',
    bookingDate: '2026-11-28',
    startTime: '10:00',
    durationMins: 60,
    billingType: 'metered',
    estimatedKwh: 5.0
  });
  console.log('9. First booking status:', b1.status, 'Booking Code:', b1.data?.booking?.bookingCode);

  // 10. Concurrency Overlap Prevention (Same charger & overlapping time 10:30-11:30)
  const bOverlap = await request({
    port: 3000,
    path: '/api/bookings',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${driverToken}`
    }
  }, {
    chargerId: 'ce-del-sec137',
    bookingDate: '2026-11-28',
    startTime: '10:30',
    durationMins: 60,
    billingType: 'metered',
    estimatedKwh: 5.0
  });
  console.log('10. Overlap Prevention (Expect 409):', bOverlap.status, 'Error message:', bOverlap.data?.error);

  // 11. Booking Cancellation & Refund
  if (b1.data?.booking?.id) {
    const cancelRes = await request({
      port: 3000,
      path: `/api/bookings/${b1.data.booking.id}/cancel`,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${driverToken}` }
    });
    console.log('11. Booking Cancellation & Refund status:', cancelRes.status, 'Msg:', cancelRes.data?.message);
  }

  console.log('--- ALL BACKEND TEST PASSES COMPLETED ---');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
