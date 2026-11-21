/* ==========================================================================
   ChargeEase EV - Frontend Application Controller (Full-Stack Integration)
   EV Mobility Graphite Architecture - Zero Emojis - Strict Privacy & Transparency
   ========================================================================== */

const API_BASE = '/api';

// Catalog of common Indian EVs used alongside driver's own garage vehicles
const EV_CATALOG = [
  { id: 'cat-nexon', name: 'Tata Nexon EV MR (30.2 kWh)', capacity: 30.2, connector: 'CCS 2' },
  { id: 'cat-tiago', name: 'Tata Tiago EV (24.0 kWh)', capacity: 24.0, connector: 'Type 2' },
  { id: 'cat-zs', name: 'MG ZS EV (50.3 kWh)', capacity: 50.3, connector: 'CCS 2' },
  { id: 'cat-ola', name: 'Ola S1 Pro (4.0 kWh)', capacity: 4.0, connector: '16A' },
  { id: 'cat-ather', name: 'Ather 450X (3.7 kWh)', capacity: 3.7, connector: '16A' },
  { id: 'cat-atto3', name: 'BYD Atto 3 (60.5 kWh)', capacity: 60.5, connector: 'CCS 2' }
];

const state = {
  authToken: localStorage.getItem('ce_token') || null,
  currentUser: null,
  currentRole: 'driver',
  currentTab: 'driver-dash',
  userLocation: {
    lat: 28.4626,
    lng: 77.4935,
    locality: 'Sector 137 / Greater Noida Expressway Corridor'
  },
  batterySoc: 72,
  safetyBufferPct: 20,
  stations: [],
  favoriteIds: [],
  vehicles: [],
  activeVehicle: null,
  selectedStationId: null,
  activeFilter: 'all',
  searchQuery: '',
  map: null,
  mapMarkersLayer: null,
  userMarker: null,
  routeLayer: null,
  mapLightMode: true,
  hostFilter: 'all',
  hostCache: { chargers: [], bookings: [] },
  adminCache: { hosts: [], chargers: [], users: [], bookings: [], transactions: [], disputes: [], logs: [] },
  driverDashboard: null,
  activeBookingStation: null,
  activeSession: null,
  telemetryInterval: null,
  telemetryPaused: false,
  authPageRole: 'driver',
  authPageMode: 'signup',
  currentStage: 'landing'
};

const HERO_SHOWCASES = [
  {
    title: '94% Charged',
    meta: '+22.4 kWh | Safe Reserve +16.8 km | Host Earns Rs 403',
    pct: 94
  },
  {
    title: '68% Charged',
    meta: '+4.8 kWh (16A Timed) | Safe Reserve +11.4 km | Host Earns Rs 90',
    pct: 68
  },
  {
    title: '88% Charged',
    meta: '+18.6 kWh (25 kW DC) | Safe Reserve +28.2 km | Host Earns Rs 409',
    pct: 88
  }
];

// -------------------- Utilities & API Client --------------------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInr(amount, decimals = 2) {
  const num = Number(amount || 0);
  return 'Rs ' + num.toFixed(decimals);
}

function getEl(id) {
  return document.getElementById(id);
}

function showToast(message, type = 'info') {
  const container = getEl('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast-item ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s ease';
    setTimeout(() => el.remove(), 220);
  }, 3400);
}

async function apiFetch(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (state.authToken) {
    headers['Authorization'] = `Bearer ${state.authToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data.error || `Request failed (${res.status})`;
    if (res.status === 401 && state.authToken) {
      localStorage.removeItem('ce_token');
      state.authToken = null;
      state.currentUser = null;
      updateAuthUI();
    }
    throw new Error(errMsg);
  }
  return data;
}

function statusDotClass(status) {
  if (status === 'available' || status === 'approved' || status === 'verified' || status === 'completed' || status === 'resolved') return 'green';
  if (status === 'pending' || status === 'busy' || status === 'active' || status === 'open') return 'amber';
  if (status === 'confirmed') return 'blue';
  if (status === 'offline' || status === 'rejected' || status === 'cancelled' || status === 'suspended') return 'red';
  return 'muted';
}

function badgeClass(status) {
  if (status === 'available' || status === 'approved' || status === 'verified' || status === 'completed' || status === 'resolved') return 'status-available';
  if (status === 'busy' || status === 'pending' || status === 'active' || status === 'open') return 'status-busy';
  if (status === 'confirmed') return 'status-available';
  return 'status-offline';
}

function formatStatusLabel(status) {
  if (!status) return 'Unknown';
  const s = String(status).toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

// -------------------- Stage Management (Landing -> Auth -> Workspace) --------------------
function showLandingPage() {
  state.currentStage = 'landing';
  if (getEl('landing-stage')) getEl('landing-stage').style.display = 'block';
  if (getEl('auth-stage')) getEl('auth-stage').style.display = 'none';
  if (getEl('app-stage')) getEl('app-stage').style.display = 'none';
  updateLandingWorkspaceButtons();
  updateLandingEstimator();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openAuthPage(mode = 'signup', role = 'driver') {
  state.currentStage = 'auth';
  if (getEl('landing-stage')) getEl('landing-stage').style.display = 'none';
  if (getEl('auth-stage')) getEl('auth-stage').style.display = 'block';
  if (getEl('app-stage')) getEl('app-stage').style.display = 'none';
  clearAuthPageStatus();
  selectAuthPageRole(role);
  selectAuthPageMode(mode);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function enterAppWorkspace() {
  state.currentStage = 'app';
  if (getEl('landing-stage')) getEl('landing-stage').style.display = 'none';
  if (getEl('auth-stage')) getEl('auth-stage').style.display = 'none';
  if (getEl('app-stage')) getEl('app-stage').style.display = 'block';

  if (state.authToken && state.currentUser) {
    switchRoleExperience(state.currentRole || state.currentUser.role || 'driver', true);
  } else {
    try {
      await switchDemoAccount('driver', true);
    } catch (_) {
      switchRoleExperience('driver', true);
    }
  }
  if (state.currentTab === 'explore') {
    requestAnimationFrame(() => ensureMapReady());
  }
}

function scrollToLandingSection(id) {
  const target = getEl(id);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectHeroShowcase(idx) {
  const item = HERO_SHOWCASES[idx] || HERO_SHOWCASES[0];
  [0, 1, 2].forEach(i => {
    const pill = getEl(`lp-pill-${i}`);
    if (pill) pill.classList.toggle('active', i === idx);
  });
  if (getEl('lp-sim-title')) getEl('lp-sim-title').textContent = item.title;
  if (getEl('lp-sim-meta')) getEl('lp-sim-meta').textContent = item.meta;
  if (getEl('lp-sim-bar')) getEl('lp-sim-bar').style.width = `${item.pct}%`;
}

function updateLandingEstimator() {
  const hwSelect = getEl('lp-est-hardware');
  const hoursEl = getEl('lp-est-hours');
  const rateEl = getEl('lp-est-rate');
  if (!hwSelect || !hoursEl || !rateEl) return;

  const opt = hwSelect.options[hwSelect.selectedIndex];
  const kw = parseFloat(hwSelect.value || '7.4');
  const mode = opt?.dataset?.mode || 'kwh';
  const hours = parseInt(hoursEl.value || '4', 10);

  if (mode === 'hr') {
    rateEl.min = '40';
    rateEl.max = '120';
    if (parseInt(rateEl.value, 10) < 40) rateEl.value = '60';
  } else {
    rateEl.min = '10';
    rateEl.max = '30';
    if (parseInt(rateEl.value, 10) > 30) rateEl.value = opt?.dataset?.defaultRate || '18';
  }

  const rate = parseFloat(rateEl.value || '18');
  if (getEl('lp-est-hours-val')) getEl('lp-est-hours-val').textContent = `${hours} hrs / day`;
  if (getEl('lp-est-rate-val')) getEl('lp-est-rate-val').textContent = mode === 'hr' ? `₹${rate} / hr` : `₹${rate} / kWh`;

  // Monthly estimate assumes 30 days at ~78% avg slot utilization
  const dailyEarnings = mode === 'hr' ? (hours * rate * 0.78) : (hours * kw * 0.78 * rate);
  const monthly = Math.round(dailyEarnings * 30);
  const annual = monthly * 12;

  if (getEl('lp-est-monthly')) getEl('lp-est-monthly').textContent = '₹' + monthly.toLocaleString('en-IN');
  if (getEl('lp-est-annual')) getEl('lp-est-annual').textContent = '₹' + annual.toLocaleString('en-IN') + ' projected annual offset (~78% utilization)';
}

function updateLandingWorkspaceButtons() {
  const navBtn = getEl('lp-nav-workspace-btn');
  const heroBtn = getEl('lp-hero-workspace-btn');
  if (state.currentUser) {
    const first = state.currentUser.name.split(' ')[0];
    if (navBtn) navBtn.textContent = `Open ${first}'s App`;
    if (heroBtn) heroBtn.textContent = `Continue as ${first} ->`;
  } else {
    if (navBtn) navBtn.textContent = 'Launch Workspace';
    if (heroBtn) heroBtn.textContent = 'Enter Demo App ->';
  }
}

function selectAuthPageRole(role) {
  const validRole = ['driver', 'host', 'admin'].includes(role) ? role : 'driver';
  state.authPageRole = validRole;

  if (getEl('auth-role-card-driver')) getEl('auth-role-card-driver').classList.toggle('active', validRole === 'driver');
  if (getEl('auth-role-card-host')) getEl('auth-role-card-host').classList.toggle('active', validRole === 'host');
  if (getEl('ap-login-role')) getEl('ap-login-role').value = validRole;

  if (validRole === 'admin') {
    selectAuthPageMode('login');
  } else {
    syncAuthPageVisibility();
  }
  syncAsideFromLoginRole(validRole);
}

function selectAuthPageMode(mode) {
  if (state.authPageRole === 'admin' && mode === 'signup') {
    setAuthPageStatus('Admin accounts are provisioned securely by operations and cannot be publicly registered. Use verified Sign In.', 'info');
    mode = 'login';
  }
  state.authPageMode = mode;
  if (getEl('auth-mode-tab-signup')) getEl('auth-mode-tab-signup').classList.toggle('active', mode === 'signup');
  if (getEl('auth-mode-tab-login')) getEl('auth-mode-tab-login').classList.toggle('active', mode === 'login');
  syncAuthPageVisibility();
}

function syncAuthPageVisibility() {
  const drvForm = getEl('auth-page-form-driver');
  const hostForm = getEl('auth-page-form-host');
  const loginForm = getEl('auth-page-form-login');
  if (!drvForm || !hostForm || !loginForm) return;

  if (state.authPageMode === 'login') {
    drvForm.style.display = 'none';
    hostForm.style.display = 'none';
    loginForm.style.display = 'block';
  } else {
    loginForm.style.display = 'none';
    drvForm.style.display = state.authPageRole === 'driver' ? 'block' : 'none';
    hostForm.style.display = state.authPageRole === 'host' ? 'block' : 'none';
  }
}

function syncAsideFromLoginRole(role) {
  const badge = getEl('auth-aside-badge');
  const title = getEl('auth-aside-title');
  const desc = getEl('auth-aside-desc');
  const list = getEl('auth-aside-list');
  if (!badge || !title || !desc || !list) return;

  if (role === 'host') {
    badge.innerHTML = '<span class="status-dot green"></span> CHARGER HOST ACCOUNT';
    title.textContent = 'Monetize idle residential or society chargers.';
    desc.textContent = 'Verify your site details, set metered kWh or 16A time pricing, and retain 100% of every base tariff rupee.';
    list.innerHTML = `
      <li>Host profile &amp; UPI handle stored cleanly in SQLite</li>
      <li>Full address stays privacy-masked until slot confirmation</li>
      <li>Approve or reject reservations &amp; toggle charger online status</li>
      <li>Real-time payout ledger separated from platform commission</li>`;
  } else if (role === 'admin') {
    badge.innerHTML = '<span class="status-dot amber"></span> PLATFORM OPERATIONS';
    title.textContent = 'Govern KYC, disputes &amp; network audit.';
    desc.textContent = 'Admin sign-in verifies elevated role tokens strictly against SQLite user records.';
    list.innerHTML = `
      <li>Verify or reject host KYC and charger listings</li>
      <li>Arbitrate open driver/host disputes &amp; review receipts</li>
      <li>Monitor GMV, GST ledger &amp; full activity logs</li>`;
  } else {
    badge.innerHTML = '<span class="status-dot green"></span> EV DRIVER ACCOUNT';
    title.textContent = 'Charge anywhere with range certainty.';
    desc.textContent = 'Verify your EV driver profile to run road-distance reachability calculations, reserve conflict-free residential sockets, and stream charging telemetry.';
    list.innerHTML = `
      <li>Vehicle pack size &amp; connector compatibility saved in garage</li>
      <li>20% emergency reserve reachability protection</li>
      <li>Privacy-gated host addresses unlocked on confirmation</li>
      <li>Instant ₹500 hackathon demo welcome wallet credit</li>`;
  }
}

function setAuthPageStatus(msg, type = 'info') {
  const banner = getEl('auth-page-status');
  if (!banner) return;
  banner.textContent = msg;
  banner.className = `auth-status-banner ${type}`;
  banner.style.display = 'block';
}

function clearAuthPageStatus() {
  const banner = getEl('auth-page-status');
  if (banner) banner.style.display = 'none';
}

async function verifyAndEnterWithToken(token, expectedRoleLabel) {
  localStorage.setItem('ce_token', token);
  localStorage.removeItem('ce_logged_out');
  state.authToken = token;

  // Verify token cleanly against backend /api/auth/me before launching workspace
  const verifiedMe = await apiFetch('/auth/me');
  state.currentUser = verifiedMe.user;
  state.currentRole = verifiedMe.user.role;
  if (verifiedMe.vehicle) state.activeVehicle = verifiedMe.vehicle;

  setAuthPageStatus(`Verified with backend (${expectedRoleLabel}: ${verifiedMe.user.name}). Opening workspace...`, 'success');
  updateAuthUI();
  updateLandingWorkspaceButtons();

  setTimeout(() => {
    enterAppWorkspace();
    hydrateAuthenticatedSession();
  }, 450);
}

async function handleAuthPageDriverSignup(e) {
  e.preventDefault();
  setAuthPageStatus('Registering EV Driver & verifying credentials with backend...', 'info');
  const payload = {
    name: getEl('ap-drv-name')?.value.trim(),
    email: getEl('ap-drv-email')?.value.trim(),
    phone: getEl('ap-drv-phone')?.value.trim(),
    password: getEl('ap-drv-pass')?.value,
    manufacturer: getEl('ap-drv-make')?.value.trim(),
    model: getEl('ap-drv-model')?.value.trim(),
    batteryCapacity: parseFloat(getEl('ap-drv-battery')?.value || '30.2'),
    connectorType: getEl('ap-drv-connector')?.value || 'Type 2 AC',
    registrationNo: getEl('ap-drv-reg')?.value.trim()
  };

  try {
    const res = await apiFetch('/auth/register-driver', { method: 'POST', body: payload });
    await verifyAndEnterWithToken(res.token, 'EV Driver');
    showToast('EV Driver registered & backend verified', 'success');
  } catch (err) {
    setAuthPageStatus(err.message, 'error');
    showToast(err.message, 'error');
  }
}

async function handleAuthPageHostSignup(e) {
  e.preventDefault();
  setAuthPageStatus('Registering Charger Host & verifying site KYC with backend...', 'info');
  const payload = {
    name: getEl('ap-host-name')?.value.trim(),
    email: getEl('ap-host-email')?.value.trim(),
    phone: getEl('ap-host-phone')?.value.trim(),
    password: getEl('ap-host-pass')?.value,
    address: getEl('ap-host-address')?.value.trim(),
    city: getEl('ap-host-city')?.value.trim(),
    pincode: getEl('ap-host-pin')?.value.trim(),
    upiId: getEl('ap-host-upi')?.value.trim()
  };

  try {
    const res = await apiFetch('/auth/register-host', { method: 'POST', body: payload });
    await verifyAndEnterWithToken(res.token, 'Charger Host');
    showToast('Charger Host registered & backend verified', 'success');
  } catch (err) {
    setAuthPageStatus(err.message, 'error');
    showToast(err.message, 'error');
  }
}

async function handleAuthPageLogin(e) {
  e.preventDefault();
  const expectedRole = getEl('ap-login-role')?.value || state.authPageRole || 'driver';
  const email = getEl('ap-login-email')?.value.trim();
  const password = getEl('ap-login-password')?.value;

  setAuthPageStatus(`Verifying ${expectedRole} credentials against backend database...`, 'info');
  try {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: { email, password, expectedRole }
    });
    await verifyAndEnterWithToken(res.token, formatStatusLabel(res.user.role));
    showToast(`Authenticated as ${res.user.name} (${formatStatusLabel(res.user.role)})`, 'success');
  } catch (err) {
    setAuthPageStatus(err.message, 'error');
    showToast(err.message, 'error');
  }
}

function quickVerifyDemoOnAuthPage(role) {
  const creds = {
    driver: { email: 'driver@chargeease.com', password: 'Driver@123' },
    host: { email: 'host@chargeease.com', password: 'Host@123' },
    admin: { email: 'admin@chargeease.com', password: 'Admin@123' }
  }[role];
  if (!creds) return;

  selectAuthPageRole(role);
  selectAuthPageMode('login');
  if (getEl('ap-login-role')) getEl('ap-login-role').value = role;
  if (getEl('ap-login-email')) getEl('ap-login-email').value = creds.email;
  if (getEl('ap-login-password')) getEl('ap-login-password').value = creds.password;
  handleAuthPageLogin(new Event('submit'));
}

// -------------------- Initialization & Authentication --------------------
document.addEventListener('DOMContentLoaded', async () => {
  bindOverlayCloseHandlers();
  updateLandingEstimator();

  if (state.authToken) {
    try {
      await hydrateAuthenticatedSession();
      showLandingPage();
      return;
    } catch (_) {
      localStorage.removeItem('ce_token');
      state.authToken = null;
    }
  }

  updateAuthUI();
  updateLandingWorkspaceButtons();
  showLandingPage();
});

function bindOverlayCloseHandlers() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('open', 'active');
      }
    });
  });

  document.addEventListener('click', (e) => {
    const drawer = getEl('notifications-drawer');
    if (drawer && drawer.style.display !== 'none') {
      const wrap = e.target.closest('.notif-bell-wrap') || e.target.closest('#notifications-drawer');
      if (!wrap) drawer.style.display = 'none';
    }
  });
}

async function hydrateAuthenticatedSession() {
  const me = await apiFetch('/auth/me');
  state.currentUser = me.user;
  state.currentRole = me.user.role || 'driver';
  if (me.vehicle) state.activeVehicle = me.vehicle;
  if (me.driverProfile && me.driverProfile.safety_buffer_pct) {
    state.safetyBufferPct = me.driverProfile.safety_buffer_pct;
  }

  updateAuthUI();
  switchRoleExperience(state.currentRole, true);
  loadNotifications();
}

async function switchDemoAccount(role, silent = false) {
  const creds = {
    driver: { email: 'driver@chargeease.com', password: 'Driver@123' },
    host: { email: 'host@chargeease.com', password: 'Host@123' },
    admin: { email: 'admin@chargeease.com', password: 'Admin@123' }
  }[role];

  if (!creds) return;

  try {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: creds
    });
    localStorage.setItem('ce_token', res.token);
    localStorage.removeItem('ce_logged_out');
    state.authToken = res.token;
    await hydrateAuthenticatedSession();
    if (!silent) showToast(`Signed in as ${res.user.name} (${formatStatusLabel(res.user.role)})`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function updateAuthUI() {
  const user = state.currentUser;
  const sessionText = getEl('auth-session-text');
  const roleBadge = getEl('auth-role-badge');
  const btnSignIn = getEl('btn-auth-signin');
  const btnRegister = getEl('btn-auth-register');
  const btnLogout = getEl('btn-auth-logout');
  const walletAmt = getEl('header-wallet-amt');
  const vehiclePill = getEl('header-vehicle-pill');

  ['driver', 'host', 'admin'].forEach(r => {
    const demoBtn = getEl(`demo-btn-${r}`);
    if (demoBtn) {
      demoBtn.classList.toggle('active', Boolean(user && user.role === r));
    }
  });

  if (user) {
    if (sessionText) sessionText.textContent = `Signed in as ${user.name}`;
    if (roleBadge) {
      roleBadge.textContent = formatStatusLabel(user.role);
      roleBadge.className = `role-badge role-${user.role}`;
    }
    if (btnSignIn) btnSignIn.textContent = 'Switch account';
    if (btnRegister) btnRegister.style.display = 'none';
    if (btnLogout) btnLogout.style.display = 'inline-block';
    if (walletAmt) walletAmt.textContent = formatInr(user.walletBalance ?? user.wallet_balance ?? 0, 0);
    if (vehiclePill) {
      vehiclePill.style.display = user.role === 'driver' ? 'flex' : 'none';
    }
  } else {
    if (sessionText) sessionText.textContent = 'Guest preview (browse only)';
    if (roleBadge) {
      roleBadge.textContent = 'Guest';
      roleBadge.className = 'role-badge role-driver';
    }
    if (btnSignIn) btnSignIn.textContent = 'Sign in';
    if (btnRegister) btnRegister.style.display = 'inline-block';
    if (btnLogout) btnLogout.style.display = 'none';
    if (walletAmt) walletAmt.textContent = 'Rs 0';
    if (vehiclePill) vehiclePill.style.display = 'none';
  }
}

function handleLogout() {
  localStorage.removeItem('ce_token');
  localStorage.setItem('ce_logged_out', '1');
  state.authToken = null;
  state.currentUser = null;
  state.currentRole = 'driver';
  stopTelemetryLoop();
  updateAuthUI();
  updateLandingWorkspaceButtons();
  openAuthPage('login', 'driver');
  showToast('Signed out of ChargeEase EV', 'info');
}

// -------------------- Auth Modal Controls --------------------
function openAuthModal(mode = 'signin') {
  const modal = getEl('auth-modal');
  if (!modal) return;
  modal.classList.add('open', 'active');
  if (mode === 'register-driver') setAuthTab('reg-driver');
  else if (mode === 'register-host') setAuthTab('reg-host');
  else setAuthTab('login');
}

function closeModal(id) {
  const el = getEl(id);
  if (el) el.classList.remove('open', 'active');
}

function setAuthTab(tab) {
  const map = {
    'login': { btn: 'auth-tab-btn-login', form: 'auth-form-login', title: 'Sign in to ChargeEase EV' },
    'reg-driver': { btn: 'auth-tab-btn-reg-driver', form: 'auth-form-reg-driver', title: 'Register EV Driver account' },
    'reg-host': { btn: 'auth-tab-btn-reg-host', form: 'auth-form-reg-host', title: 'Register Private Charger Host' }
  };

  Object.keys(map).forEach(k => {
    const b = getEl(map[k].btn);
    const f = getEl(map[k].form);
    if (b) b.classList.toggle('active', k === tab);
    if (f) f.style.display = k === tab ? 'block' : 'none';
  });

  const titleEl = getEl('auth-modal-title');
  if (titleEl && map[tab]) titleEl.textContent = map[tab].title;
}

function prefillLogin(email, password) {
  const e = getEl('login-email');
  const p = getEl('login-password');
  if (e) e.value = email;
  if (p) p.value = password;
}

async function handleFormLogin(e) {
  e.preventDefault();
  const email = getEl('login-email')?.value.trim();
  const password = getEl('login-password')?.value;

  try {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: { email, password }
    });
    localStorage.setItem('ce_token', res.token);
    localStorage.removeItem('ce_logged_out');
    state.authToken = res.token;
    closeModal('auth-modal');
    await hydrateAuthenticatedSession();
    showToast(`Welcome back, ${res.user.name}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleFormRegisterDriver(e) {
  e.preventDefault();
  const payload = {
    name: getEl('reg-drv-name')?.value.trim(),
    email: getEl('reg-drv-email')?.value.trim(),
    phone: getEl('reg-drv-phone')?.value.trim(),
    password: getEl('reg-drv-pass')?.value,
    manufacturer: getEl('reg-drv-make')?.value.trim(),
    model: getEl('reg-drv-model')?.value.trim(),
    batteryCapacity: parseFloat(getEl('reg-drv-battery')?.value || '30.2'),
    connectorType: getEl('reg-drv-connector')?.value || 'Type 2 AC'
  };

  try {
    const res = await apiFetch('/auth/register-driver', { method: 'POST', body: payload });
    localStorage.setItem('ce_token', res.token);
    localStorage.removeItem('ce_logged_out');
    state.authToken = res.token;
    closeModal('auth-modal');
    await hydrateAuthenticatedSession();
    showToast('Driver account registered successfully', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleFormRegisterHost(e) {
  e.preventDefault();
  const payload = {
    name: getEl('reg-host-name')?.value.trim(),
    email: getEl('reg-host-email')?.value.trim(),
    phone: getEl('reg-host-phone')?.value.trim(),
    password: getEl('reg-host-pass')?.value,
    address: getEl('reg-host-address')?.value.trim(),
    city: getEl('reg-host-city')?.value.trim(),
    pincode: getEl('reg-host-pin')?.value.trim(),
    upiId: getEl('reg-host-upi')?.value.trim()
  };

  try {
    const res = await apiFetch('/auth/register-host', { method: 'POST', body: payload });
    localStorage.setItem('ce_token', res.token);
    localStorage.removeItem('ce_logged_out');
    state.authToken = res.token;
    closeModal('auth-modal');
    await hydrateAuthenticatedSession();
    showToast('Host account created. Verification status: Pending', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -------------------- Navigation & Role Switching --------------------
function navigateToRoleHome() {
  const homeTab = state.currentRole === 'host'
    ? 'host-dash'
    : (state.currentRole === 'admin' ? 'admin-analytics' : 'driver-dash');
  switchTab(homeTab);
}

function openRoleProfile() {
  if (!state.currentUser) {
    openAuthModal('signin');
    return;
  }
  if (state.currentRole === 'host') switchTab('host-profile');
  else if (state.currentRole === 'admin') switchTab('admin-analytics');
  else switchTab('garage');
}

function switchRoleExperience(role, fromHydration = false) {
  if (!fromHydration && (!state.currentUser || state.currentUser.role !== role)) {
    // Allow instant demo role switch if triggered by role pill
    switchDemoAccount(role);
    return;
  }

  state.currentRole = role;

  ['driver', 'host', 'admin'].forEach(r => {
    const btn = getEl(`mode-${r}-btn`);
    if (btn) btn.classList.toggle('active', r === role);
  });

  document.querySelectorAll('#app-tabs-bar .nav-tab-item').forEach(tabEl => {
    const tabRole = tabEl.dataset.role;
    tabEl.style.display = tabRole === role ? 'flex' : 'none';
  });

  const defaultTab = role === 'host' ? 'host-dash' : (role === 'admin' ? 'admin-analytics' : 'driver-dash');
  switchTab(defaultTab);
}

function switchTab(tabId) {
  state.currentTab = tabId;

  document.querySelectorAll('#app-tabs-bar .nav-tab-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabId);
  });

  document.querySelectorAll('.tab-view').forEach(view => {
    const isTarget = view.id === `view-${tabId}`;
    view.style.display = isTarget ? 'block' : 'none';
    view.classList.toggle('active', isTarget);
  });

  if (tabId === 'driver-dash') {
    loadDriverDashboard();
  } else if (tabId === 'explore') {
    loadStationsFromApi().then(() => {
      requestAnimationFrame(() => ensureMapReady());
    });
  } else if (tabId === 'range-matcher') {
    populateEvModels();
    updateRangeCalc();
  } else if (tabId === 'telemetry') {
    renderTelemetryPanelState();
  } else if (tabId === 'driver-bookings') {
    loadDriverBookings();
  } else if (tabId === 'wallet') {
    loadWalletTransactions();
  } else if (tabId === 'garage') {
    loadDriverDashboard(true);
  } else if (tabId === 'host-dash' || tabId === 'host-chargers' || tabId === 'host-bookings') {
    loadHostDashboard();
  } else if (tabId === 'host-earnings') {
    loadHostEarnings();
  } else if (tabId === 'host-profile') {
    populateHostProfileForm();
  } else if (tabId.startsWith('admin-')) {
    loadAdminData();
  }
}

// -------------------- Notifications --------------------
async function loadNotifications() {
  if (!state.authToken) return;
  try {
    const res = await apiFetch('/notifications');
    const items = res.notifications || [];
    const unread = typeof res.unreadCount === 'number' ? res.unreadCount : items.filter(n => !n.is_read).length;
    const countEl = getEl('header-notif-count');
    if (countEl) {
      if (unread > 0) {
        countEl.textContent = String(unread);
        countEl.style.display = 'inline-block';
      } else {
        countEl.style.display = 'none';
      }
    }
    renderNotificationsList(items);
  } catch (_) {
    // Non-fatal
  }
}

function renderNotificationsList(items) {
  const container = getEl('notifications-list-container');
  if (!container) return;

  if (!items.length) {
    container.innerHTML = '<div style="padding:20px; text-align:center; font-size:12px; color:var(--text-muted);">No notifications yet. Booking alerts and platform messages appear here.</div>';
    return;
  }

  container.innerHTML = items.map(n => `
    <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="markSingleNotifRead('${escapeHtml(n.id)}')">
      <div style="font-size:12px; font-weight:600; color:var(--text-primary); margin-bottom:2px;">${escapeHtml(n.title)}</div>
      <div style="font-size:12px; color:var(--text-secondary); line-height:1.45;">${escapeHtml(n.message)}</div>
      <div style="font-size:10px; color:var(--text-muted); margin-top:4px;">${escapeHtml(n.created_at || '')}</div>
    </div>
  `).join('');
}

function toggleNotificationsPanel() {
  const drawer = getEl('notifications-drawer');
  if (!drawer) return;
  const opening = drawer.style.display === 'none' || !drawer.style.display;
  drawer.style.display = opening ? 'flex' : 'none';
  if (opening) loadNotifications();
}

async function markSingleNotifRead(id) {
  try {
    await apiFetch(`/notifications/${id}/read`, { method: 'POST' });
    loadNotifications();
  } catch (_) {}
}

async function markAllNotificationsRead() {
  try {
    await apiFetch('/notifications/read-all', { method: 'POST' });
    loadNotifications();
    showToast('Notifications marked as read', 'info');
  } catch (_) {}
}

function openWalletModal() {
  if (!state.currentUser) {
    openAuthModal('signin');
    return;
  }
  if (state.currentRole !== 'driver') {
    showToast(`Current wallet balance: ${formatInr(state.currentUser.walletBalance ?? state.currentUser.wallet_balance ?? 0)}`, 'info');
    return;
  }
  switchTab('wallet');
}

// -------------------- Driver Home Workspace --------------------
async function loadDriverDashboard(populateProfileToo = false) {
  if (!state.authToken || state.currentRole !== 'driver') {
    // Still render public nearby chargers in guest preview
    loadStationsFromApi().then(() => renderDashNearbyGrid(state.stations));
    return;
  }

  try {
    const [dash, chargerRes] = await Promise.all([
      apiFetch('/driver/dashboard'),
      apiFetch(`/driver/chargers?lat=${state.userLocation.lat}&lng=${state.userLocation.lng}`)
    ]);

    state.driverDashboard = dash;
    state.vehicles = dash.vehicles || [];
    state.activeVehicle = dash.vehicle || state.vehicles[0] || null;
    state.stations = chargerRes.stations || [];
    state.favoriteIds = (dash.favoriteChargers || []).map(f => f.id);
    if (dash.safetyBufferPct) state.safetyBufferPct = dash.safetyBufferPct;

    updateDriverReadinessUI();

    const welcomeEl = getEl('driver-dash-welcome');
    if (welcomeEl) welcomeEl.textContent = `Welcome, ${dash.driverName}`;

    const expEl = getEl('driver-dash-expenditure');
    if (expEl) expEl.textContent = formatInr(dash.stats?.totalSpent || 0, 0);

    const sesEl = getEl('driver-dash-sessions-count');
    if (sesEl) sesEl.textContent = String(dash.stats?.totalSessions || 0);

    const walletEl = getEl('header-wallet-amt');
    if (walletEl) walletEl.textContent = formatInr(dash.walletBalance || 0, 0);

    renderDashActiveBooking(dash.activeBooking);
    renderDashSessionsList(dash.recentSessions || []);
    renderDashNearbyGrid(state.stations);
    renderDashFavoritesList(dash.favoriteChargers || []);

    if (populateProfileToo || state.currentTab === 'garage') {
      renderGarageView(dash);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function updateDriverReadinessUI() {
  const veh = state.activeVehicle;
  const capacityKwh = veh ? Number(veh.battery_capacity_kwh) : 30.2;
  const efficiencyKmPerKwh = capacityKwh <= 10 ? 27.5 : 8.2;
  const grossRange = capacityKwh * (state.batterySoc / 100) * efficiencyKmPerKwh;
  const usableKm = grossRange * (1 - state.safetyBufferPct / 100);

  const vehLabel = veh ? `${veh.manufacturer} ${veh.model}` : 'Tata Nexon EV MR';
  const vehSub = veh
    ? `${capacityKwh} kWh pack | ${veh.connector_type}${veh.registration_no ? ' | ' + veh.registration_no : ''}`
    : '30.2 kWh pack | Type 2 / CCS 2';

  const els = {
    'driver-dash-veh-name': vehLabel,
    'driver-dash-veh-sub': vehSub,
    'header-active-vehicle': veh ? veh.model : 'Nexon EV MR',
    'map-overlay-vehicle-name': veh ? veh.model : 'Nexon EV MR',
    'dash-soc-val': `${state.batterySoc}%`,
    'slider-soc-display': `${state.batterySoc}%`,
    'header-vehicle-soc': `${state.batterySoc}%`,
    'driver-dash-safe-range': `${usableKm.toFixed(1)} km`,
    'map-overlay-usable-km': `${usableKm.toFixed(1)} km`,
    'driver-dash-buffer-pct': `${state.safetyBufferPct}%`
  };

  Object.entries(els).forEach(([id, txt]) => {
    const node = getEl(id);
    if (node) node.textContent = txt;
  });

  const dashSlider = getEl('dash-soc-slider');
  if (dashSlider) dashSlider.value = String(state.batterySoc);
  const rangeSlider = getEl('battery-soc-slider');
  if (rangeSlider) rangeSlider.value = String(state.batterySoc);
}

function onBatterySliderChange(val) {
  state.batterySoc = Math.max(5, Math.min(100, parseInt(val, 10) || 72));
  updateDriverReadinessUI();
  if (state.currentTab === 'range-matcher') {
    updateRangeCalc();
  }
}

function renderDashActiveBooking(booking) {
  const el = getEl('driver-active-booking-container');
  if (!el) return;

  if (!booking) {
    el.innerHTML = `
      <div style="padding:18px; background:var(--bg-surface); border:1px dashed var(--border-strong); border-radius:var(--radius-md); text-align:center;">
        <div style="font-size:13px; font-weight:600; color:var(--text-primary); margin-bottom:4px;">No active or upcoming reservation</div>
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:12px;">Search verified host docks with real-time slot locking and range checks.</div>
        <button class="btn-bolt btn-sm" onclick="switchTab('explore')">Find reachable chargers</button>
      </div>`;
    return;
  }

  const unlocked = ['confirmed', 'active', 'completed'].includes(booking.status);
  const addr = unlocked ? booking.charger_address : (booking.approximate_address || 'Locality revealed upon confirmation');

  el.innerHTML = `
    <div style="padding:14px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-md);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:10px;">
        <div>
          <div style="font-size:14px; font-weight:600; color:var(--text-primary);">${escapeHtml(booking.charger_name)}</div>
          <div style="font-size:12px; color:var(--text-secondary);">${escapeHtml(addr)}</div>
        </div>
        <span class="status-badge ${badgeClass(booking.status)}">
          <span class="status-dot ${statusDotClass(booking.status)}"></span>
          ${escapeHtml(formatStatusLabel(booking.status))}
        </span>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:12px; color:var(--text-secondary); margin-bottom:12px;">
        <span>Code: <strong class="tabular" style="color:var(--text-primary);">${escapeHtml(booking.booking_code)}</strong></span>
        <span>Window: <strong class="tabular" style="color:var(--text-primary);">${escapeHtml(booking.booking_date)} ${escapeHtml(booking.start_time)} - ${escapeHtml(booking.end_time)}</strong></span>
        <span>Total: <strong class="tabular" style="color:var(--text-primary);">${formatInr(booking.total_amount)}</strong></span>
      </div>
      <div style="display:flex; gap:8px;">
        ${booking.status === 'confirmed' ? `<button class="btn-bolt btn-sm" onclick="startSessionFromBooking('${escapeHtml(booking.charger_id)}', '${escapeHtml(booking.id)}')">Start live session</button>` : ''}
        <button class="btn-secondary btn-sm" onclick="switchTab('driver-bookings')">Manage bookings</button>
      </div>
    </div>`;
}

function renderDashSessionsList(sessions) {
  const el = getEl('driver-dash-sessions-list');
  if (!el) return;

  if (!sessions.length) {
    el.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:10px 0;">No completed charging sessions yet. Your telemetry and billing receipts will appear here.</div>';
    return;
  }

  el.innerHTML = sessions.map(s => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border-color); gap:10px;">
      <div>
        <div style="font-size:13px; font-weight:600; color:var(--text-primary);">${escapeHtml(s.charger_name || s.charger_code || 'Charging Dock')}</div>
        <div style="font-size:11px; color:var(--text-secondary);">${escapeHtml(s.session_code)} | ${escapeHtml(s.created_at || '')}</div>
      </div>
      <div style="text-align:right;">
        <div class="tabular" style="font-size:13px; font-weight:600; color:var(--text-primary);">${formatInr(s.final_cost ?? s.total_cost)}</div>
        <div class="tabular" style="font-size:11px; color:var(--accent-green);">${Number(s.energy_delivered_kwh || 0).toFixed(2)} kWh</div>
      </div>
    </div>
  `).join('');
}

function renderDashNearbyGrid(stations) {
  const el = getEl('driver-dash-nearby-grid');
  if (!el) return;

  if (!stations || !stations.length) {
    el.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">No chargers found for your current coordinates. Try Find chargers to expand search.</div>';
    return;
  }

  el.innerHTML = stations.slice(0, 4).map(st => `
    <div style="padding:12px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-md); cursor:pointer;" onclick="openStationDetailModal('${escapeHtml(st.id)}')">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:4px;">
        <span style="font-size:13px; font-weight:600; color:var(--text-primary);">${escapeHtml(st.name)}</span>
        <span class="status-badge ${badgeClass(st.status)}"><span class="status-dot ${statusDotClass(st.status)}"></span>${escapeHtml(formatStatusLabel(st.status))}</span>
      </div>
      <div style="font-size:11px; color:var(--text-secondary); margin-bottom:8px;">${escapeHtml(st.approximateAddress || st.address)}</div>
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
        <span class="tabular" style="color:var(--text-secondary);">${escapeHtml(st.connectorType)} | ${st.powerKw} kW</span>
        <span class="tabular" style="font-weight:600; color:var(--text-primary);">${Number(st.distanceKm).toFixed(1)} km | ${st.billingType === 'time' ? formatInr(st.timeRatePerHour, 0) + '/hr' : formatInr(st.pricePerKwh, 0) + '/kWh'}</span>
      </div>
    </div>
  `).join('');
}

function renderDashFavoritesList(favorites) {
  const el = getEl('driver-dash-favorites-list');
  if (!el) return;

  if (!favorites || !favorites.length) {
    el.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:8px 0;">No bookmarked chargers yet. Click the Bookmark action on any charger card to save frequent stops.</div>';
    return;
  }

  el.innerHTML = favorites.map(f => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border-color); gap:8px;">
      <div>
        <div style="font-size:13px; font-weight:600; color:var(--text-primary);">${escapeHtml(f.name)}</div>
        <div style="font-size:11px; color:var(--text-secondary);">${escapeHtml(f.connector_type)} | ${f.power_kw} kW | Rating ${Number(f.rating || 4.8).toFixed(1)}</div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn-secondary btn-sm" onclick="openStationDetailModal('${escapeHtml(f.id)}')">View</button>
        <button class="btn-secondary btn-sm" onclick="toggleFavoriteCharger('${escapeHtml(f.id)}')">Remove</button>
      </div>
    </div>
  `).join('');
}

// -------------------- Discovery & Interactive Map --------------------
async function loadStationsFromApi() {
  const listEl = getEl('stations-list-container');
  if (listEl) {
    listEl.innerHTML = '<div class="skeleton-box" style="height:100px; margin-bottom:10px;"></div><div class="skeleton-box" style="height:100px;"></div>';
  }

  const connector = getEl('filter-connector')?.value || 'all';
  const minPower = getEl('filter-power')?.value || '0';
  const sortBy = getEl('filter-sort')?.value || 'distance';
  const search = state.searchQuery || '';

  const params = new URLSearchParams({
    lat: String(state.userLocation.lat),
    lng: String(state.userLocation.lng),
    search,
    connector,
    minPower,
    sortBy
  });

  if (state.activeFilter === 'available') params.set('status', 'available');
  if (state.activeFilter === 'metered') params.set('billing', 'metered');
  if (state.activeFilter === 'time') params.set('billing', 'time');

  try {
    const res = await apiFetch(`/driver/chargers?${params.toString()}`);
    state.stations = res.stations || [];
    renderStationsSidebar();
    renderStationMarkers();
  } catch (err) {
    if (listEl) {
      listEl.innerHTML = `<div style="padding:20px; font-size:12px; color:var(--accent-red);">${escapeHtml(err.message)}</div>`;
    }
  }
}

function handleCityChange(val) {
  state.userLocation = { lat: 28.4626, lng: 77.4935, locality: `${val} Expressway Corridor` };
  const locText = getEl('map-user-loc-text');
  if (locText) locText.textContent = state.userLocation.locality;
  loadStationsFromApi();
}

function handleSearch(val) {
  state.searchQuery = val.trim();
  loadStationsFromApi();
}

function applyFilter(filterName) {
  state.activeFilter = filterName;
  document.querySelectorAll('.filter-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filterName);
  });
  loadStationsFromApi();
}

function renderStationsSidebar() {
  const container = getEl('stations-list-container');
  if (!container) return;

  if (!state.stations.length) {
    container.innerHTML = `
      <div style="padding:28px 16px; text-align:center;">
        <div style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:6px;">No matching chargers found</div>
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:14px;">Adjust connector, minimum kW power, or availability filters to broaden results.</div>
        <button class="btn-secondary btn-sm" onclick="resetDiscoveryFilters()">Reset filters</button>
      </div>`;
    return;
  }

  container.innerHTML = state.stations.map(st => {
    const isFav = state.favoriteIds.includes(st.id);
    const selected = state.selectedStationId === st.id ? 'selected' : '';
    const tariffText = st.billingType === 'time' ? formatInr(st.timeRatePerHour, 0) : formatInr(st.pricePerKwh, 0);
    const tariffSub = st.billingType === 'time' ? '/ hour' : '/ kWh';
    const addressLine = st.isAddressUnlocked ? st.address : (st.approximateAddress || st.address);

    return `
      <div class="station-card ${selected}" id="card-${escapeHtml(st.id)}" onclick="onStationCardClick('${escapeHtml(st.id)}')">
        <div class="card-top-row">
          <div>
            <div class="station-name">${escapeHtml(st.name)}</div>
            <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">
              Host: ${escapeHtml(st.host)} ${st.hostVerified ? '<span style="color:var(--accent-green); font-weight:600;">(Verified)</span>' : '(Pending KYC)'}
            </div>
          </div>
          <span class="status-badge ${badgeClass(st.status)}">
            <span class="status-dot ${statusDotClass(st.status)}"></span>
            ${escapeHtml(formatStatusLabel(st.status))}
          </span>
        </div>

        <div class="station-address">
          ${escapeHtml(addressLine)}
          ${!st.isAddressUnlocked ? '<span style="color:var(--text-muted);"> (Exact gate locked until booking)</span>' : ''}
        </div>

        <div class="specs-strip">
          <span class="spec-pill">${escapeHtml(st.connectorType)}</span>
          <span class="spec-pill tabular">${st.powerKw} kW</span>
          <span class="spec-pill">${st.billingType === 'time' ? 'Time Slot' : 'Metered kWh'}</span>
          <span class="spec-pill tabular">Rating ${Number(st.rating || 4.8).toFixed(1)}</span>
        </div>

        <div class="card-bottom-row">
          <div>
            <span class="price-text tabular">${tariffText}</span>
            <span class="price-sub">${tariffSub}</span>
          </div>
          <span class="distance-tag tabular">${Number(st.distanceKm).toFixed(1)} km</span>
        </div>

        <div style="display:flex; gap:6px; margin-top:10px;" onclick="event.stopPropagation()">
          <button class="btn-secondary btn-sm" style="flex:1;" onclick="openStationDetailModal('${escapeHtml(st.id)}')">Details &amp; slots</button>
          <button class="btn-bolt btn-sm" style="flex:1;" onclick="openBookingModal('${escapeHtml(st.id)}')" ${st.status !== 'available' ? 'disabled' : ''}>Reserve</button>
          <button class="btn-secondary btn-sm" onclick="toggleFavoriteCharger('${escapeHtml(st.id)}')" title="Bookmark charger">${isFav ? 'Saved' : 'Save'}</button>
        </div>
      </div>`;
  }).join('');
}

function resetDiscoveryFilters() {
  const s = getEl('station-search-input');
  const c = getEl('filter-connector');
  const p = getEl('filter-power');
  const o = getEl('filter-sort');
  if (s) s.value = '';
  if (c) c.value = 'all';
  if (p) p.value = '0';
  if (o) o.value = 'distance';
  state.searchQuery = '';
  applyFilter('all');
}

function ensureMapReady() {
  if (typeof L === 'undefined') {
    showToast('Leaflet map library is not loaded', 'error');
    return;
  }
  const mapEl = getEl('map');
  if (!mapEl) return;

  if (!state.map) {
    state.map = L.map('map', {
      center: [state.userLocation.lat, state.userLocation.lng],
      zoom: 13,
      zoomControl: false
    });
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(state.map);

    state.mapMarkersLayer = L.layerGroup().addTo(state.map);
  }

  state.map.invalidateSize({ animate: false });
  renderUserMapMarker();
  renderStationMarkers();
}

function renderUserMapMarker() {
  if (!state.map || typeof L === 'undefined') return;
  if (state.userMarker) state.map.removeLayer(state.userMarker);

  const userIcon = L.divIcon({
    className: 'ce-user-pin',
    html: '<div style="width:16px;height:16px;border-radius:50%;background:#3B82F6;border:3px solid #FFFFFF;box-shadow:0 0 0 4px rgba(59,130,246,0.28);"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  state.userMarker = L.marker([state.userLocation.lat, state.userLocation.lng], { icon: userIcon })
    .addTo(state.map)
    .bindPopup(`<strong>Your location</strong><br><span style="font-size:12px;color:#A1A6B0;">${escapeHtml(state.userLocation.locality)}</span>`);
}

function renderStationMarkers() {
  if (!state.map || !state.mapMarkersLayer || typeof L === 'undefined') return;
  state.mapMarkersLayer.clearLayers();

  state.stations.forEach(st => {
    const color = st.status === 'available' ? '#059669' : (st.status === 'busy' ? '#D97706' : '#DC2626');
    const pinIcon = L.divIcon({
      className: 'ce-charger-pin',
      html: `<div style="background:#111214;border:2px solid ${color};color:#FFFFFF;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;box-shadow:0 3px 10px rgba(17,18,20,0.22);">${st.powerKw} kW</div>`,
      iconSize: [54, 24],
      iconAnchor: [27, 12]
    });

    const addressPreview = st.isAddressUnlocked ? st.address : (st.approximateAddress || st.address);
    const tariffText = st.billingType === 'time' ? `${formatInr(st.timeRatePerHour, 0)}/hr` : `${formatInr(st.pricePerKwh, 0)}/kWh`;

    const popupHtml = `
      <div style="min-width:210px; font-family:Inter,sans-serif; color:#111214;">
        <div style="font-size:13px; font-weight:700; margin-bottom:2px;">${escapeHtml(st.name)}</div>
        <div style="font-size:11px; color:#525660; margin-bottom:6px;">${escapeHtml(addressPreview)}</div>
        <div style="font-size:12px; margin-bottom:8px;">
          <span>${escapeHtml(st.connectorType)} | ${st.powerKw} kW</span><br>
          <strong>${tariffText}</strong> | <span style="color:${color}; font-weight:600;">${escapeHtml(formatStatusLabel(st.status))}</span>
        </div>
        <div style="display:flex; gap:6px;">
          <button onclick="openStationDetailModal('${escapeHtml(st.id)}')" style="flex:1; padding:5px 8px; border-radius:6px; border:1px solid #D5D2C8; background:#FAF9F5; color:#111214; cursor:pointer; font-size:11px; font-weight:600;">Details</button>
          <button onclick="openBookingModal('${escapeHtml(st.id)}')" style="flex:1; padding:5px 8px; border-radius:6px; border:none; background:#111214; color:#FFFFFF; font-weight:600; cursor:pointer; font-size:11px;">Reserve</button>
        </div>
      </div>`;

    const marker = L.marker([st.lat, st.lng], { icon: pinIcon }).bindPopup(popupHtml);
    marker.on('click', () => {
      state.selectedStationId = st.id;
      highlightSelectedCard(st.id);
      drawOSRMRoute(st);
    });
    marker.addTo(state.mapMarkersLayer);
  });
}

function onStationCardClick(id) {
  state.selectedStationId = id;
  highlightSelectedCard(id);
  const st = state.stations.find(s => s.id === id);
  if (st && state.map) {
    state.map.setView([st.lat, st.lng], 14, { animate: true });
    drawOSRMRoute(st);
  }
}

function highlightSelectedCard(id) {
  document.querySelectorAll('.station-card').forEach(el => {
    el.classList.toggle('selected', el.id === `card-${id}`);
  });
}

async function drawOSRMRoute(station) {
  if (!state.map || typeof L === 'undefined') return;
  if (state.routeLayer) {
    state.map.removeLayer(state.routeLayer);
    state.routeLayer = null;
  }

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${state.userLocation.lng},${state.userLocation.lat};${station.lng},${station.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('OSRM routing unavailable');
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if (!route) throw new Error('No route geometry');

    const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    state.routeLayer = L.polyline(coords, { color: '#3B82F6', weight: 4, opacity: 0.85 }).addTo(state.map);
    const roadKm = (route.distance / 1000).toFixed(1);
    const mins = Math.max(1, Math.round(route.duration / 60));
    state.routeLayer.bindPopup(`<div class="route-info-popup">Road route: ${roadKm} km (approx. ${mins} min)</div>`).openPopup();
  } catch (_) {
    // Fallback straight corridor preview with honest label
    state.routeLayer = L.polyline(
      [[state.userLocation.lat, state.userLocation.lng], [station.lat, station.lng]],
      { color: '#3B82F6', weight: 3, dashArray: '6, 6', opacity: 0.8 }
    ).addTo(state.map);
    state.routeLayer.bindPopup(`<div class="route-info-popup">Corridor estimate: ${Number(station.distanceKm).toFixed(1)} km</div>`).openPopup();
  }
}

function toggleMapTheme() {
  state.mapLightMode = !state.mapLightMode;
  const wrapper = document.querySelector('.map-viewport-wrapper');
  if (wrapper) {
    wrapper.classList.toggle('map-dark-tiles', !state.mapLightMode);
  }
  showToast(state.mapLightMode ? 'Switched to light street map tiles' : 'Switched to dark street map tiles', 'info');
}

function getUserLiveLocation() {
  if (!navigator.geolocation) {
    showToast('Geolocation not supported by browser; using Greater Noida Expressway coordinates', 'info');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      try {
        const res = await apiFetch('/driver/analyze-location', {
          method: 'POST',
          body: { lat, lng, locality: 'Live GPS Coordinates' }
        });
        state.userLocation = { lat, lng, locality: res.locality || `GPS (${lat.toFixed(3)}, ${lng.toFixed(3)})` };
        state.stations = res.stations || [];
        const locEl = getEl('map-user-loc-text');
        if (locEl) locEl.textContent = state.userLocation.locality;
        renderUserMapMarker();
        renderStationsSidebar();
        renderStationMarkers();
        if (state.map) state.map.setView([lat, lng], 13);
        showToast('Chargers synced to your live location', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    },
    () => {
      showToast('Location access declined; showing Greater Noida Expressway Corridor', 'info');
    },
    { enableHighAccuracy: true, timeout: 6000 }
  );
}

// -------------------- Station Detail Modal, Slots & Reviews --------------------
async function openStationDetailModal(chargerId) {
  const modal = getEl('station-detail-modal');
  const body = getEl('station-detail-body');
  const titleEl = getEl('modal-station-title');
  const badgeEl = getEl('modal-station-badge');
  if (!modal || !body) return;

  modal.classList.add('open', 'active');
  body.innerHTML = '<div class="skeleton-box" style="height:180px;"></div>';

  try {
    const today = new Date().toISOString().slice(0, 10);
    const data = await apiFetch(`/chargers/${chargerId}/details?lat=${state.userLocation.lat}&lng=${state.userLocation.lng}&date=${today}`);
    const st = data.station;
    const slots = data.bookedSlots || [];
    const reviews = data.reviews || [];

    if (titleEl) titleEl.textContent = st.name;
    if (badgeEl) {
      badgeEl.innerHTML = `<span class="status-dot ${statusDotClass(st.status)}"></span> ${escapeHtml(formatStatusLabel(st.status))} | ${escapeHtml(st.code)}`;
      badgeEl.className = `status-badge ${badgeClass(st.status)}`;
    }

    const tariffDisplay = st.billingType === 'time'
      ? `${formatInr(st.timeRatePerHour, 0)} / hour (Time slot reservation)`
      : `${formatInr(st.pricePerKwh, 0)} / kWh (Metered energy billing)`;

    const amenitiesHtml = (st.amenities || []).map(a => `<span class="spec-pill">${escapeHtml(a)}</span>`).join('');
    const slotsHtml = slots.length
      ? slots.map(sl => `<span class="spec-pill tabular">${escapeHtml(sl.start_time)} - ${escapeHtml(sl.end_time)} (${escapeHtml(formatStatusLabel(sl.status))})</span>`).join('')
      : '<span style="font-size:12px; color:var(--accent-green);">No conflicting reservations today. All hours open.</span>';

    const reviewsHtml = reviews.length
      ? reviews.map(r => `
          <div style="padding:10px 0; border-bottom:1px solid var(--border-color);">
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
              <strong style="color:var(--text-primary);">${escapeHtml(r.reviewer_name)}</strong>
              <span class="tabular" style="color:var(--accent-amber);">Rating: ${r.rating}/5</span>
            </div>
            <div style="font-size:12px; color:var(--text-secondary);">${escapeHtml(r.comment || 'Verified charging visit.')}</div>
          </div>`).join('')
      : '<div style="font-size:12px; color:var(--text-muted); padding:8px 0;">No driver reviews submitted for this charger yet.</div>';

    body.innerHTML = `
      ${st.photo ? `<img src="${escapeHtml(st.photo)}" alt="${escapeHtml(st.name)}" onerror="this.style.display='none'" style="width:100%; height:170px; object-fit:cover; border-radius:var(--radius-md); border:1px solid var(--border-color); margin-bottom:14px;">` : ''}

      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        <div style="font-size:12px; color:var(--text-secondary);">
          Host: <strong style="color:var(--text-primary);">${escapeHtml(st.host)}</strong>
          ${st.hostVerified ? '<span style="color:var(--accent-green); font-weight:600;"> (KYC Verified)</span>' : ' (Verification Pending)'}
        </div>
        <div class="tabular" style="font-size:12px; font-weight:600; color:var(--text-primary);">
          Rating ${Number(st.rating || 4.8).toFixed(1)}/5 | ${st.totalSessions || 0} completed visits
        </div>
      </div>

      <div style="padding:12px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-md); margin-bottom:14px;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-muted); margin-bottom:4px;">
          ${st.isAddressUnlocked ? 'Exact verified site address & gate access' : 'Approximate public location (privacy protected)'}
        </div>
        <div style="font-size:13px; font-weight:600; color:var(--text-primary); margin-bottom:4px;">
          ${escapeHtml(st.isAddressUnlocked ? st.address : st.approximateAddress)}
        </div>
        <div style="font-size:12px; color:var(--text-secondary);">
          ${escapeHtml(st.accessInstructions || 'Exact host driveway coordinates unlock automatically once booking is confirmed.')}
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; font-size:12px;">
        <div style="padding:10px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-md);">
          <div style="color:var(--text-muted); margin-bottom:2px;">Hardware &amp; Output</div>
          <div style="font-weight:600; color:var(--text-primary);">${escapeHtml(st.connectorType)} | ${st.powerKw} kW</div>
        </div>
        <div style="padding:10px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-md);">
          <div style="color:var(--text-muted); margin-bottom:2px;">Tariff &amp; Hours</div>
          <div style="font-weight:600; color:var(--text-primary);">${escapeHtml(tariffDisplay)}</div>
          <div style="color:var(--text-secondary); margin-top:2px;">Hours: ${escapeHtml(st.operatingHours || '24x7 Access')}</div>
        </div>
      </div>

      ${st.description ? `<p style="font-size:12px; color:var(--text-secondary); margin-bottom:12px; line-height:1.5;">${escapeHtml(st.description)}</p>` : ''}

      <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px;">${amenitiesHtml}</div>

      <div style="margin-bottom:16px;">
        <div style="font-size:12px; font-weight:600; color:var(--text-primary); margin-bottom:6px;">Booked slots today (${escapeHtml(data.date)})</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">${slotsHtml}</div>
      </div>

      <div style="display:flex; gap:10px; margin-bottom:18px;">
        <button class="btn-bolt" style="flex:1;" onclick="closeModal('station-detail-modal'); openBookingModal('${escapeHtml(st.id)}');" ${st.status !== 'available' ? 'disabled' : ''}>Reserve slot</button>
        <button class="btn-secondary" onclick="toggleFavoriteCharger('${escapeHtml(st.id)}')">${state.favoriteIds.includes(st.id) ? 'Saved in bookmarks' : 'Bookmark charger'}</button>
      </div>

      <div style="border-top:1px solid var(--border-color); padding-top:14px;">
        <div style="font-size:13px; font-weight:600; color:var(--text-primary); margin-bottom:8px;">Driver reviews (${reviews.length})</div>
        <div style="margin-bottom:12px;">${reviewsHtml}</div>
        <form onsubmit="submitStationReview(event, '${escapeHtml(st.id)}')" style="padding:12px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-md);">
          <div style="font-size:12px; font-weight:600; color:var(--text-primary); margin-bottom:8px;">Submit a driver review</div>
          <div style="display:flex; gap:8px; margin-bottom:8px;">
            <select id="review-rating-select" aria-label="Select rating" class="custom-select" style="width:130px;">
              <option value="5">5 - Excellent</option>
              <option value="4">4 - Reliable</option>
              <option value="3">3 - Acceptable</option>
              <option value="2">2 - Slow/Issues</option>
              <option value="1">1 - Unusable</option>
            </select>
            <input type="text" id="review-comment-input" aria-label="Review comment" class="custom-input" placeholder="Share charger accessibility, speed, or host clarity" required>
          </div>
          <button type="submit" class="btn-secondary btn-sm">Post review</button>
        </form>
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<div style="padding:16px; color:var(--accent-red); font-size:13px;">${escapeHtml(err.message)}</div>`;
  }
}

async function submitStationReview(e, chargerId) {
  e.preventDefault();
  if (!state.authToken) {
    openAuthModal('signin');
    return;
  }
  const rating = parseInt(getEl('review-rating-select')?.value || '5', 10);
  const comment = getEl('review-comment-input')?.value.trim();

  try {
    await apiFetch(`/chargers/${chargerId}/reviews`, {
      method: 'POST',
      body: { rating, comment }
    });
    showToast('Review published', 'success');
    openStationDetailModal(chargerId);
    loadStationsFromApi();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function toggleFavoriteCharger(chargerId) {
  if (!state.authToken) {
    openAuthModal('signin');
    return;
  }
  try {
    const res = await apiFetch(`/driver/favorites/${chargerId}`, { method: 'POST' });
    state.favoriteIds = res.favorites || [];
    showToast(res.message || 'Bookmarks updated', 'success');
    renderStationsSidebar();
    if (state.currentTab === 'driver-dash' || state.currentTab === 'garage') {
      loadDriverDashboard(state.currentTab === 'garage');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -------------------- Intelligent Reachability Engine --------------------
function populateEvModels() {
  const select = getEl('range-ev-selector');
  if (!select) return;

  const userVehOpts = (state.vehicles || []).map(v => ({
    id: `veh-${v.id}`,
    name: `${v.manufacturer} ${v.model} (${v.battery_capacity_kwh} kWh - My Garage)`,
    capacity: Number(v.battery_capacity_kwh),
    connector: v.connector_type
  }));

  const combined = [...userVehOpts, ...EV_CATALOG];
  const prev = select.value;
  select.innerHTML = combined.map(ev => `<option value="${ev.capacity}">${escapeHtml(ev.name)}</option>`).join('');

  if (prev && Array.from(select.options).some(o => o.value === prev)) {
    select.value = prev;
  } else if (state.activeVehicle) {
    select.value = String(state.activeVehicle.battery_capacity_kwh);
  }

  const bufSel = getEl('range-buffer-select');
  if (bufSel) bufSel.value = String(state.safetyBufferPct || 20);
}

function onSafetyBufferChange(val) {
  state.safetyBufferPct = parseInt(val, 10) || 20;
  updateDriverReadinessUI();
  updateRangeCalc();
}

async function updateRangeCalc() {
  const batteryKwh = parseFloat(getEl('range-ev-selector')?.value || (state.activeVehicle?.battery_capacity_kwh || 30.2));
  const soc = parseInt(getEl('battery-soc-slider')?.value || state.batterySoc, 10);
  const safetyBuffer = parseInt(getEl('range-buffer-select')?.value || state.safetyBufferPct, 10);
  const connector = getEl('range-connector-select')?.value || 'all';

  state.batterySoc = soc;
  state.safetyBufferPct = safetyBuffer;
  updateDriverReadinessUI();

  try {
    const params = new URLSearchParams({
      lat: String(state.userLocation.lat),
      lng: String(state.userLocation.lng),
      soc: String(soc),
      batteryKwh: String(batteryKwh),
      safetyBuffer: String(safetyBuffer),
      connector
    });

    const data = await apiFetch(`/driver/reachability?${params.toString()}`);
    const calc = data.calculation || {};
    const gross = Number(calc.grossRangeKm || 0);
    const usable = Number(calc.usableSafeRangeKm || 0);
    const reserve = Math.max(0, gross - usable);

    const setTxt = (id, t) => { const n = getEl(id); if (n) n.textContent = t; };
    setTxt('calc-gross-range', `${gross.toFixed(1)} km`);
    setTxt('calc-safety-buffer-label', `${safetyBuffer}%`);
    setTxt('calc-safety-buffer', `${reserve.toFixed(1)} km`);
    setTxt('calc-usable-range', `${usable.toFixed(1)} km`);
    setTxt('slider-soc-display', `${soc}%`);
    if (calc.disclaimer) setTxt('range-disclaimer-text', calc.disclaimer);

    const allChargers = data.chargers || [];
    const reachable = allChargers.filter(c => c.isReachable);
    const excluded = allChargers.filter(c => !c.isReachable);

    const recGrid = getEl('range-recommendations-grid');
    const exclSec = getEl('range-excluded-section');
    const exclGrid = getEl('range-excluded-grid');
    const fallbackEl = getEl('range-public-fallback');

    if (recGrid) {
      recGrid.innerHTML = reachable.map(ch => `
        <div class="panel-card" style="padding:14px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:6px;">
            <div>
              <div style="font-size:14px; font-weight:600; color:var(--text-primary);">${escapeHtml(ch.name)}</div>
              <div style="font-size:11px; color:var(--text-secondary);">${escapeHtml(ch.approximateAddress || ch.address)}</div>
            </div>
            <span class="status-badge status-available"><span class="status-dot green"></span>Reachable</span>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:10px 0; font-size:12px;">
            <div style="padding:8px; background:var(--bg-surface); border-radius:var(--radius-sm);">
              <span style="color:var(--text-muted); display:block; font-size:10px;">Estimated road distance</span>
              <strong class="tabular">${Number(ch.estimatedRoadDistanceKm).toFixed(1)} km</strong>
            </div>
            <div style="padding:8px; background:var(--bg-surface); border-radius:var(--radius-sm);">
              <span style="color:var(--text-muted); display:block; font-size:10px;">Reserve buffer on arrival</span>
              <strong class="tabular" style="color:var(--accent-green);">+${Number(ch.safetyMarginRemainingKm).toFixed(1)} km</strong>
            </div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:var(--text-secondary); margin-bottom:10px;">
            <span>${escapeHtml(ch.connectorType)} | ${ch.powerKw} kW</span>
            <strong class="tabular" style="color:var(--text-primary);">${ch.billingType === 'time' ? formatInr(ch.timeRatePerHour, 0) + '/hr' : formatInr(ch.pricePerKwh, 0) + '/kWh'}</strong>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn-secondary btn-sm" style="flex:1;" onclick="openStationDetailModal('${escapeHtml(ch.id)}')">Inspect slots</button>
            <button class="btn-bolt btn-sm" style="flex:1;" onclick="openBookingModal('${escapeHtml(ch.id)}')">Reserve dock</button>
          </div>
        </div>
      `).join('');
    }

    if (fallbackEl) fallbackEl.style.display = reachable.length === 0 ? 'block' : 'none';

    if (exclSec && exclGrid) {
      if (excluded.length) {
        exclSec.style.display = 'block';
        exclGrid.innerHTML = excluded.map(ch => `
          <div class="panel-card" style="padding:12px; opacity:0.86;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <strong style="font-size:13px; color:var(--text-primary);">${escapeHtml(ch.name)}</strong>
              <span class="status-badge status-offline"><span class="status-dot red"></span>Excluded</span>
            </div>
            <div style="font-size:11px; color:var(--text-secondary); margin-bottom:6px;">
              Est. road distance: ${Number(ch.estimatedRoadDistanceKm).toFixed(1)} km | ${escapeHtml(ch.connectorType)}
            </div>
            <div style="font-size:11px; color:var(--accent-red);">${escapeHtml(ch.exclusionReason || 'Ineligible under current parameters')}</div>
          </div>
        `).join('');
      } else {
        exclSec.style.display = 'none';
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -------------------- Bookings & Pre-Booking Disclosure --------------------
function openBookingModal(chargerId) {
  if (!state.authToken) {
    openAuthModal('signin');
    showToast('Sign in to reserve a charging slot', 'info');
    return;
  }

  const station = state.stations.find(s => s.id === chargerId);
  if (!station) {
    showToast('Station data is reloading. Please try again.', 'info');
    return;
  }
  state.activeBookingStation = station;

  const modal = getEl('booking-modal');
  if (!modal) return;
  modal.classList.add('open', 'active');

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const nextHour = String((now.getHours() + 1) % 24).padStart(2, '0') + ':00';

  if (getEl('bm-charger-name')) getEl('bm-charger-name').textContent = `${station.name} (${station.connectorType} | ${station.powerKw} kW)`;
  if (getEl('bm-date')) getEl('bm-date').value = todayStr;
  if (getEl('bm-time')) getEl('bm-time').value = nextHour;
  if (getEl('bm-duration')) getEl('bm-duration').value = '60';
  if (getEl('bm-billing-type')) {
    getEl('bm-billing-type').value = station.billingType === 'time'
      ? `Time slot (${formatInr(station.timeRatePerHour, 0)}/hr)`
      : `Metered energy (${formatInr(station.pricePerKwh, 0)}/kWh)`;
  }

  const timeWarn = getEl('bm-time-disclaimer');
  if (timeWarn) timeWarn.style.display = station.billingType === 'time' ? 'block' : 'none';

  recalculateModalBooking();
}

function recalculateModalBooking() {
  const st = state.activeBookingStation;
  if (!st) return;

  const mins = parseInt(getEl('bm-duration')?.value || '60', 10);
  const hours = mins / 60;

  let base = 0;
  if (st.billingType === 'time') {
    base = Number(st.timeRatePerHour || 75) * hours;
  } else {
    const estKwh = Math.max(2, Number(st.powerKw || 7.4) * 0.78 * hours);
    base = Number(st.pricePerKwh || 18) * estKwh;
  }

  const platformFee = base * 0.10;
  const gst = platformFee * 0.18;
  const total = base + platformFee + gst;

  if (getEl('bm-base-cost')) getEl('bm-base-cost').textContent = formatInr(base);
  if (getEl('bm-platform-fee')) getEl('bm-platform-fee').textContent = formatInr(platformFee);
  if (getEl('bm-gst-fee')) getEl('bm-gst-fee').textContent = formatInr(gst);
  if (getEl('bm-total-cost')) getEl('bm-total-cost').textContent = formatInr(total);
}

async function executeCreateBooking() {
  const st = state.activeBookingStation;
  if (!st) return;

  const bookingDate = getEl('bm-date')?.value;
  const startTime = getEl('bm-time')?.value;
  const durationMins = parseInt(getEl('bm-duration')?.value || '60', 10);
  const estimatedKwh = Math.max(2, Number((st.powerKw * 0.78 * (durationMins / 60)).toFixed(2)));

  try {
    const res = await apiFetch('/bookings', {
      method: 'POST',
      body: {
        chargerId: st.id,
        vehicleId: state.activeVehicle?.id || null,
        bookingDate,
        startTime,
        durationMins,
        billingType: st.billingType,
        estimatedKwh
      }
    });
    closeModal('booking-modal');
    showToast(`Booking ${res.booking.booking_code} requested (${formatStatusLabel(res.booking.status)})`, 'success');
    loadNotifications();
    switchTab('driver-bookings');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadDriverBookings() {
  const container = getEl('driver-bookings-container');
  if (!container) return;

  if (!state.authToken) {
    container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-secondary);">Sign in as a driver to inspect and manage slot bookings.</div>';
    return;
  }

  container.innerHTML = '<div class="skeleton-box" style="height:120px;"></div>';
  try {
    const res = await apiFetch('/driver/bookings');
    const bookings = res.bookings || [];
    if (!bookings.length) {
      container.innerHTML = `
        <div style="padding:24px; text-align:center;">
          <div style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:6px;">No bookings recorded</div>
          <div style="font-size:12px; color:var(--text-secondary); margin-bottom:14px;">Reserve a verified charger from Discovery or Reachability Matcher.</div>
          <button class="btn-bolt btn-sm" onclick="switchTab('explore')">Browse chargers</button>
        </div>`;
      return;
    }

    container.innerHTML = bookings.map(b => {
      const unlocked = ['confirmed', 'active', 'completed'].includes(b.status);
      return `
        <div style="padding:14px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-md); margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
            <div>
              <div style="font-size:14px; font-weight:600; color:var(--text-primary);">${escapeHtml(b.charger_name)}</div>
              <div style="font-size:12px; color:var(--text-secondary);">
                Booking <strong class="tabular">${escapeHtml(b.booking_code)}</strong> | ${escapeHtml(b.booking_date)} (${escapeHtml(b.start_time)} - ${escapeHtml(b.end_time)})
              </div>
            </div>
            <span class="status-badge ${badgeClass(b.status)}">
              <span class="status-dot ${statusDotClass(b.status)}"></span>
              ${escapeHtml(formatStatusLabel(b.status))}
            </span>
          </div>

          <div style="font-size:12px; color:var(--text-secondary); margin-bottom:10px;">
            Location: <strong style="color:var(--text-primary);">${escapeHtml(b.charger_address)}</strong>
            ${unlocked && b.access_instructions ? `<br>Access instructions: ${escapeHtml(b.access_instructions)} (Host phone: ${escapeHtml(b.host_phone)})` : ''}
            ${!unlocked ? ' <span style="color:var(--text-muted);">(Full driveway instructions unlock upon host confirmation)</span>' : ''}
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; border-top:1px solid var(--border-color); padding-top:10px;">
            <div class="tabular" style="font-size:12px; color:var(--text-secondary);">
              Base ${formatInr(b.base_amount)} + Fee ${formatInr(b.platform_fee)} + GST ${formatInr(b.gst_fee)} = <strong style="color:var(--text-primary);">${formatInr(b.total_amount)}</strong>
            </div>
            <div style="display:flex; gap:8px;">
              ${b.status === 'confirmed' ? `<button class="btn-bolt btn-sm" onclick="startSessionFromBooking('${escapeHtml(b.charger_id)}', '${escapeHtml(b.id)}')">Start session</button>` : ''}
              ${['pending', 'confirmed'].includes(b.status) ? `<button class="btn-danger btn-sm" onclick="cancelBooking('${escapeHtml(b.id)}')">Cancel</button>` : ''}
              ${['confirmed', 'completed'].includes(b.status) ? `<button class="btn-secondary btn-sm" onclick="openDisputeModal('${escapeHtml(b.id)}', '${escapeHtml(b.booking_code)}')">Report issue</button>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div style="padding:14px; color:var(--accent-red); font-size:13px;">${escapeHtml(err.message)}</div>`;
  }
}

async function cancelBooking(bookingId) {
  try {
    await apiFetch(`/bookings/${bookingId}/cancel`, { method: 'POST' });
    showToast('Booking cancelled', 'info');
    loadDriverBookings();
    loadDriverDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openDisputeModal(bookingId, bookingCode) {
  if (getEl('disp-booking-id')) getEl('disp-booking-id').value = bookingId;
  if (getEl('disp-booking-code')) getEl('disp-booking-code').value = bookingCode;
  if (getEl('disp-reason')) getEl('disp-reason').value = '';
  const modal = getEl('dispute-modal');
  if (modal) modal.classList.add('open', 'active');
}

async function handleCreateDispute(e) {
  e.preventDefault();
  const bookingId = getEl('disp-booking-id')?.value;
  const reason = getEl('disp-reason')?.value.trim();

  try {
    await apiFetch('/disputes', {
      method: 'POST',
      body: { bookingId, reason }
    });
    closeModal('dispute-modal');
    showToast('Dispute ticket submitted for admin review', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -------------------- Live Telemetry Session Engine (Simulated Stream) --------------------
function renderTelemetryPanelState() {
  const activePanel = getEl('telemetry-active-panel');
  const emptyPanel = getEl('telemetry-empty-panel');
  const dot = getEl('live-session-dot');

  const isRunning = Boolean(state.activeSession);
  if (activePanel) activePanel.style.display = isRunning ? 'block' : 'none';
  if (emptyPanel) emptyPanel.style.display = isRunning ? 'none' : 'block';
  if (dot) dot.style.display = isRunning ? 'inline-block' : 'none';

  if (isRunning) updateTelemetryUI();
}

function startQuickDemoSession() {
  handleScanSubmit('CE-DEL-100');
}

function openScanDirectModal() {
  switchTab('telemetry');
}

async function startSessionFromBooking(chargerId, bookingId) {
  const st = state.stations.find(s => s.id === chargerId);
  await startLiveChargingSession(st || { code: null }, bookingId);
}

async function handleScanSubmit(chargerCode) {
  await startLiveChargingSession({ code: chargerCode }, null);
}

async function startLiveChargingSession(station = null, bookingId = null) {
  if (!state.authToken) {
    openAuthModal('signin');
    return;
  }

  try {
    const res = await apiFetch('/sessions/start', {
      method: 'POST',
      body: { chargerCode: station?.code || null, bookingId }
    });

    const ses = res.session;
    const chg = res.charger;
    state.activeSession = {
      id: ses.id,
      sessionCode: ses.session_code,
      chargerName: chg.name,
      chargerCode: chg.code,
      billingType: chg.billing_type,
      powerKw: Number(chg.power_kw || 7.4),
      pricePerKwh: Number(chg.price_per_kwh || 18),
      timeRatePerHour: Number(chg.time_rate_per_hour || 75),
      startSoc: Math.min(88, state.batterySoc),
      currentSoc: Math.min(88, state.batterySoc),
      energyKwh: 0.0,
      elapsedSeconds: 0,
      costInr: 0.0
    };
    state.telemetryPaused = false;

    const pauseBtnText = getEl('pause-btn-text');
    if (pauseBtnText) pauseBtnText.textContent = 'Pause stream';

    switchTab('telemetry');
    renderTelemetryPanelState();
    startTelemetryLoop();
    showToast(`Telemetry active on ${chg.code} (simulated demo stream)`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function startTelemetryLoop() {
  stopTelemetryLoop();
  state.telemetryInterval = setInterval(() => {
    if (!state.activeSession || state.telemetryPaused) return;

    const s = state.activeSession;
    s.elapsedSeconds += 1;
    // Accelerated hackathon time-scale so energy & SoC climb visibly per tick
    const kwhIncrement = (s.powerKw / 3600) * 18;
    s.energyKwh += kwhIncrement;

    const capacity = Number(state.activeVehicle?.battery_capacity_kwh || 30.2);
    s.currentSoc = Math.min(100, s.startSoc + (s.energyKwh / capacity) * 100);
    state.batterySoc = Math.round(s.currentSoc);

    if (s.billingType === 'time') {
      s.costInr = (s.elapsedSeconds / 3600) * s.timeRatePerHour * 18;
    } else {
      s.costInr = s.energyKwh * s.pricePerKwh;
    }

    updateTelemetryUI();
  }, 1000);
}

function stopTelemetryLoop() {
  if (state.telemetryInterval) {
    clearInterval(state.telemetryInterval);
    state.telemetryInterval = null;
  }
}

function updateTelemetryUI() {
  const s = state.activeSession;
  if (!s) return;

  const CIRC = 553; // r = 88 -> 2 * Math.PI * 88 ≈ 552.92
  const circle = getEl('telem-progress-circle');
  if (circle) {
    const pct = Math.max(0, Math.min(100, s.currentSoc));
    circle.style.strokeDashoffset = String(CIRC - (pct / 100) * CIRC);
  }

  const mm = String(Math.floor(s.elapsedSeconds / 60)).padStart(2, '0');
  const ss = String(s.elapsedSeconds % 60).padStart(2, '0');
  const liveKw = state.telemetryPaused ? 0.0 : s.powerKw * (0.94 + Math.random() * 0.06);
  const volts = s.powerKw >= 20 ? 402 : 231;
  const amps = liveKw > 0 ? ((liveKw * 1000) / volts).toFixed(1) : '0.0';

  const set = (id, v) => { const n = getEl(id); if (n) n.textContent = v; };
  set('telem-station-name', s.chargerName);
  set('telem-charger-code', `${s.chargerCode} | Simulated Telemetry Stream`);
  set('telem-cost', formatInr(s.costInr));
  set('telem-soc', `${Math.round(s.currentSoc)}%`);
  set('telem-soc-status', state.telemetryPaused ? 'Paused' : 'Delivering');
  set('telem-kwh', `${s.energyKwh.toFixed(2)} kWh`);
  set('telem-power', `${liveKw.toFixed(1)} kW`);
  set('telem-vi', `${volts} V / ${amps} A`);
  set('telem-time', `${mm}:${ss}`);

  const tag = getEl('telem-billing-tag');
  const formula = getEl('telem-billing-formula');
  const warn = getEl('telem-time-warning');

  if (s.billingType === 'time') {
    if (tag) { tag.textContent = 'Time Billing'; tag.className = 'billing-type-tag time'; }
    if (formula) formula.textContent = `Time reservation rate: ${formatInr(s.timeRatePerHour, 0)}/hr`;
    if (warn) warn.style.display = 'block';
  } else {
    if (tag) { tag.textContent = 'Metered kWh'; tag.className = 'billing-type-tag metered'; }
    if (formula) formula.textContent = `Energy delivered x ${formatInr(s.pricePerKwh, 0)}/kWh + 10% Commission + 18% GST on Commission`;
    if (warn) warn.style.display = 'none';
  }
}

function togglePauseTelemetry() {
  if (!state.activeSession) return;
  state.telemetryPaused = !state.telemetryPaused;
  const btnTxt = getEl('pause-btn-text');
  if (btnTxt) btnTxt.textContent = state.telemetryPaused ? 'Resume stream' : 'Pause stream';
  updateTelemetryUI();
}

async function stopActiveChargingSession() {
  if (!state.activeSession) return;
  const s = state.activeSession;
  stopTelemetryLoop();

  try {
    const res = await apiFetch(`/sessions/${s.id}/stop`, {
      method: 'POST',
      body: { energyKwh: Number(Math.max(0.4, s.energyKwh).toFixed(2)), elapsedSeconds: s.elapsedSeconds }
    });

    state.activeSession = null;
    renderTelemetryPanelState();
    const me = await apiFetch('/auth/me').catch(() => null);
    if (me && me.user) state.currentUser = me.user;
    updateAuthUI();
    showSessionReceipt(res, state.currentUser?.wallet_balance ?? state.currentUser?.walletBalance ?? 0);
    loadDriverDashboard();
    loadNotifications();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function showSessionReceipt(res, walletBalance = 0) {
  const modal = getEl('receipt-modal');
  const content = getEl('receipt-modal-content');
  if (!modal || !content) return;

  const r = res.receipt || {};
  content.innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="font-size:14px; font-weight:700; color:var(--text-primary); margin-bottom:4px;">Session completed &amp; settled</div>
      <div style="font-size:12px; color:var(--text-secondary);">Simulated demo wallet settlement (no real bank charge).</div>
    </div>
    <div class="prebooking-breakdown" style="margin-bottom:14px;">
      <div class="prebooking-breakdown-row"><span>Energy delivered</span><span class="tabular">${Number(r.kwhDelivered ?? r.energyKwh ?? 0).toFixed(2)} kWh</span></div>
      <div class="prebooking-breakdown-row"><span>Base energy / slot cost</span><span class="tabular">${formatInr(r.baseCost ?? r.baseAmount)}</span></div>
      <div class="prebooking-breakdown-row"><span>Platform commission (10%)</span><span class="tabular">${formatInr(r.platformFee)}</span></div>
      <div class="prebooking-breakdown-row"><span>GST on commission (18%)</span><span class="tabular">${formatInr(r.gst ?? r.gstFee)}</span></div>
      <div class="prebooking-breakdown-row total-row"><span>Total debited from wallet</span><span class="tabular">${formatInr(r.totalCost ?? r.totalAmount)}</span></div>
      <div class="prebooking-breakdown-row" style="margin-top:6px;"><span>Remaining wallet balance</span><span class="tabular" style="color:var(--accent-green);">${formatInr(walletBalance)}</span></div>
    </div>
    <button class="btn-bolt" style="width:100%;" onclick="closeModal('receipt-modal')">Close receipt</button>
  `;
  modal.classList.add('open', 'active');
}

// -------------------- Wallet & Transactions --------------------
async function loadWalletTransactions() {
  if (!state.authToken) return;
  try {
    const [res, me] = await Promise.all([
      apiFetch('/wallet/transactions'),
      apiFetch('/auth/me').catch(() => null)
    ]);
    if (me && me.user) state.currentUser = me.user;
    const bal = state.currentUser?.wallet_balance ?? state.currentUser?.walletBalance ?? res.walletBalance ?? 0;
    const balEl = getEl('wallet-balance-big');
    const hdrEl = getEl('header-wallet-amt');
    if (balEl) balEl.textContent = formatInr(bal);
    if (hdrEl) hdrEl.textContent = formatInr(bal, 0);

    const listEl = getEl('wallet-transactions-list');
    if (!listEl) return;
    const txs = res.transactions || [];
    if (!txs.length) {
      listEl.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:10px 0;">No wallet transactions recorded yet.</div>';
      return;
    }

    listEl.innerHTML = txs.map(t => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border-color); gap:10px;">
        <div>
          <div style="font-size:13px; font-weight:600; color:var(--text-primary);">${escapeHtml(t.description || formatStatusLabel(t.type))}</div>
          <div style="font-size:11px; color:var(--text-muted);">${escapeHtml(t.payment_method || t.method || 'UPI Demo')} | ${escapeHtml(t.created_at || '')}</div>
        </div>
        <div class="tabular" style="font-size:13px; font-weight:600; color:${t.type === 'topup' ? 'var(--accent-green)' : 'var(--text-primary)'};">
          ${t.type === 'topup' ? '+' : '-'}${formatInr(t.amount)}
        </div>
      </div>
    `).join('');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function setTopupPreset(amt) {
  const input = getEl('custom-topup-input');
  if (input) input.value = String(amt);
}

async function executeWalletTopup() {
  if (!state.authToken) {
    openAuthModal('signin');
    return;
  }
  const amt = parseFloat(getEl('custom-topup-input')?.value || '0');
  if (!amt || amt <= 0) {
    showToast('Enter a valid amount', 'error');
    return;
  }

  try {
    await apiFetch('/wallet/topup', {
      method: 'POST',
      body: { amount: amt, method: 'UPI Demo Simulation' }
    });
    showToast(`Added ${formatInr(amt)} (demo wallet top-up)`, 'success');
    loadWalletTransactions();
    loadNotifications();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -------------------- Driver Garage, Vehicles & Profile --------------------
function renderGarageView(dash) {
  const user = state.currentUser || {};
  if (getEl('prof-driver-name')) getEl('prof-driver-name').value = dash.driverName || user.name || '';
  if (getEl('prof-driver-email')) getEl('prof-driver-email').value = user.email || '';
  if (getEl('prof-driver-phone')) getEl('prof-driver-phone').value = user.phone || '';
  const buf = dash.safetyBufferPct || state.safetyBufferPct || 20;
  if (getEl('prof-safety-buffer')) getEl('prof-safety-buffer').value = String(buf);
  if (getEl('prof-buffer-val')) getEl('prof-buffer-val').textContent = `${buf}%`;

  const vList = getEl('garage-vehicles-list');
  if (vList) {
    const vehicles = dash.vehicles || [];
    vList.innerHTML = vehicles.length
      ? vehicles.map(v => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-md); margin-bottom:8px; gap:10px; flex-wrap:wrap;">
            <div>
              <div style="font-size:13px; font-weight:600; color:var(--text-primary);">
                ${escapeHtml(v.manufacturer)} ${escapeHtml(v.model)}
                ${v.is_primary ? '<span class="badge-tag" style="margin-left:6px; border-color:rgba(16,185,129,0.4); color:var(--accent-green);">Primary</span>' : ''}
              </div>
              <div style="font-size:12px; color:var(--text-secondary);">
                ${v.battery_capacity_kwh} kWh | ${escapeHtml(v.connector_type)} ${v.registration_no ? '| ' + escapeHtml(v.registration_no) : ''}
              </div>
            </div>
            <div style="display:flex; gap:6px;">
              ${!v.is_primary ? `<button class="btn-secondary btn-sm" onclick="setPrimaryVehicle('${escapeHtml(v.id)}')">Set primary</button>` : ''}
              <button class="btn-danger btn-sm" onclick="deleteVehicle('${escapeHtml(v.id)}')">Remove</button>
            </div>
          </div>`).join('')
      : '<div style="font-size:12px; color:var(--text-muted);">No vehicles added yet. Register your EV below to unlock exact range calculations.</div>';
  }

  const fList = getEl('garage-favorites-list');
  if (fList) {
    const favs = dash.favoriteChargers || [];
    fList.innerHTML = favs.length
      ? favs.map(f => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-md); margin-bottom:8px;">
            <div>
              <div style="font-size:13px; font-weight:600; color:var(--text-primary);">${escapeHtml(f.name)}</div>
              <div style="font-size:11px; color:var(--text-secondary);">${escapeHtml(f.connector_type)} | ${f.power_kw} kW</div>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn-secondary btn-sm" onclick="openStationDetailModal('${escapeHtml(f.id)}')">Details</button>
              <button class="btn-secondary btn-sm" onclick="toggleFavoriteCharger('${escapeHtml(f.id)}')">Remove</button>
            </div>
          </div>`).join('')
      : '<div style="font-size:12px; color:var(--text-muted);">No saved favorite chargers yet.</div>';
  }
}

async function handleUpdateDriverProfile(e) {
  e.preventDefault();
  try {
    await apiFetch('/auth/profile', {
      method: 'PUT',
      body: {
        name: getEl('prof-driver-name')?.value.trim(),
        phone: getEl('prof-driver-phone')?.value.trim(),
        safetyBufferPct: parseInt(getEl('prof-safety-buffer')?.value || '20', 10)
      }
    });
    showToast('Driver profile updated', 'success');
    await hydrateAuthenticatedSession();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleAddVehicle(e) {
  e.preventDefault();
  try {
    await apiFetch('/driver/vehicles', {
      method: 'POST',
      body: {
        manufacturer: getEl('veh-make')?.value.trim(),
        model: getEl('veh-model')?.value.trim(),
        batteryCapacityKwh: parseFloat(getEl('veh-kwh')?.value || '30'),
        connectorType: getEl('veh-connector')?.value,
        registrationNo: getEl('veh-reg')?.value.trim(),
        setPrimary: true
      }
    });
    e.target.reset();
    showToast('Vehicle added to your garage as primary EV', 'success');
    loadDriverDashboard(true);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function setPrimaryVehicle(id) {
  try {
    await apiFetch(`/driver/vehicles/${id}/primary`, { method: 'PUT' });
    showToast('Primary vehicle switched', 'success');
    loadDriverDashboard(true);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteVehicle(id) {
  try {
    await apiFetch(`/driver/vehicles/${id}`, { method: 'DELETE' });
    showToast('Vehicle removed', 'info');
    loadDriverDashboard(true);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleChangePassword(e) {
  e.preventDefault();
  try {
    await apiFetch('/auth/change-password', {
      method: 'PUT',
      body: {
        currentPassword: getEl('pwd-current')?.value,
        newPassword: getEl('pwd-new')?.value
      }
    });
    e.target.reset();
    showToast('Password updated', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -------------------- Host Experience --------------------
async function loadHostDashboard() {
  if (!state.authToken || state.currentRole !== 'host') return;

  try {
    const res = await apiFetch('/host/dashboard');
    state.hostCache = { chargers: res.chargers || [], bookings: res.bookings || [] };

    const m = res.metrics || {};
    const set = (id, v) => { const n = getEl(id); if (n) n.textContent = v; };
    set('host-metric-chargers', String(m.totalChargers || 0));
    set('host-metric-active-chargers', `${m.activeChargers || 0} online`);
    set('host-metric-pending', String(m.pendingBookings || 0));
    set('host-metric-confirmed', String(m.confirmedBookings || 0));
    set('host-metric-completed', String(m.completedSessions || 0));
    set('host-metric-total-earnings', formatInr(m.totalEarnings || 0, 0));
    set('host-metric-monthly-earnings', formatInr(m.monthlyEarnings || 0, 0));
    set('host-metric-utilization', `${m.utilizationPercent || 0}%`);

    renderHostChargers(res.chargers || []);
    renderHostBookings(res.bookings || []);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderHostChargers(chargers) {
  const html = chargers.length
    ? chargers.map(c => `
        <div class="panel-card" style="padding:14px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px;">
            <div>
              <div style="font-size:14px; font-weight:600; color:var(--text-primary);">${escapeHtml(c.name)}</div>
              <div style="font-size:11px; color:var(--text-secondary);">${escapeHtml(c.code)} | ${escapeHtml(c.connector_type)} | ${c.power_kw} kW</div>
            </div>
            <span class="status-badge ${badgeClass(c.status)}">
              <span class="status-dot ${statusDotClass(c.status)}"></span>
              ${escapeHtml(formatStatusLabel(c.status))}
            </span>
          </div>
          <div style="font-size:12px; color:var(--text-secondary); margin-bottom:10px;">
            ${escapeHtml(c.address)}<br>
            Tariff: <strong class="tabular" style="color:var(--text-primary);">${c.billing_type === 'time' ? formatInr(c.time_rate_per_hour, 0) + '/hr' : formatInr(c.price_per_kwh, 0) + '/kWh'}</strong>
            | Admin check: <strong style="color:${c.verification_status === 'approved' ? 'var(--accent-green)' : 'var(--accent-amber)'};">${escapeHtml(formatStatusLabel(c.verification_status))}</strong>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-secondary btn-sm" onclick="openEditChargerModal('${escapeHtml(c.id)}')">Edit charger</button>
            <button class="btn-secondary btn-sm" onclick="toggleHostChargerPower('${escapeHtml(c.id)}')">
              ${c.status === 'offline' ? 'Switch Online' : 'Switch Offline'}
            </button>
          </div>
        </div>`).join('')
    : '<div style="font-size:13px; color:var(--text-muted);">No chargers onboarded yet. Add a charger to start accepting EV driver reservations.</div>';

  const previewEl = getEl('host-chargers-grid');
  const fullEl = getEl('host-full-chargers-list');
  if (previewEl) previewEl.innerHTML = html;
  if (fullEl) fullEl.innerHTML = html;
}

function renderHostBookings(bookings) {
  const previewEl = getEl('host-dash-bookings-preview');
  const tableEl = getEl('host-bookings-table-container');

  if (previewEl) {
    const pending = bookings.filter(b => b.status === 'pending').slice(0, 4);
    previewEl.innerHTML = pending.length
      ? pending.map(b => `
          <div style="padding:12px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-md); margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              <strong style="font-size:13px;">${escapeHtml(b.driver_name)}</strong>
              <span class="tabular" style="font-size:12px; color:var(--accent-green);">Net ${formatInr(b.host_payout)}</span>
            </div>
            <div style="font-size:11px; color:var(--text-secondary); margin-bottom:8px;">${escapeHtml(b.charger_name)} | ${escapeHtml(b.booking_date)} ${escapeHtml(b.start_time)}-${escapeHtml(b.end_time)}</div>
            <div style="display:flex; gap:6px;">
              <button class="btn-table-action approve" onclick="handleHostBookingAction('${escapeHtml(b.id)}', 'accept')">Accept</button>
              <button class="btn-table-action reject" onclick="handleHostBookingAction('${escapeHtml(b.id)}', 'reject')">Reject</button>
            </div>
          </div>`).join('')
      : '<div style="font-size:12px; color:var(--text-muted); padding:10px 0;">No pending requests right now. New bookings appear here.</div>';
  }

  if (tableEl) {
    const filtered = state.hostFilter === 'all' ? bookings : bookings.filter(b => b.status === state.hostFilter);
    if (!filtered.length) {
      tableEl.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:16px;">No bookings match this filter.</div>';
      return;
    }

    tableEl.innerHTML = `
      <div class="table-scroll-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th class="admin-th">Booking</th>
              <th class="admin-th">Driver</th>
              <th class="admin-th">Charger</th>
              <th class="admin-th">Slot Window</th>
              <th class="admin-th">Host Payout</th>
              <th class="admin-th">Status</th>
              <th class="admin-th">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(b => `
              <tr>
                <td class="admin-td tabular">${escapeHtml(b.booking_code)}</td>
                <td class="admin-td">${escapeHtml(b.driver_name)}</td>
                <td class="admin-td">${escapeHtml(b.charger_name)}</td>
                <td class="admin-td tabular">${escapeHtml(b.booking_date)} ${escapeHtml(b.start_time)}-${escapeHtml(b.end_time)}</td>
                <td class="admin-td tabular">${formatInr(b.host_payout)}</td>
                <td class="admin-td"><span class="status-badge ${badgeClass(b.status)}"><span class="status-dot ${statusDotClass(b.status)}"></span>${escapeHtml(formatStatusLabel(b.status))}</span></td>
                <td class="admin-td">
                  ${b.status === 'pending'
                    ? `<button class="btn-table-action approve" onclick="handleHostBookingAction('${escapeHtml(b.id)}', 'accept')">Accept</button>
                       <button class="btn-table-action reject" onclick="handleHostBookingAction('${escapeHtml(b.id)}', 'reject')">Reject</button>`
                    : '<span style="font-size:11px; color:var(--text-muted);">Processed</span>'}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }
}

function filterHostBookings(status, btn) {
  state.hostFilter = status;
  if (btn && btn.parentElement) {
    btn.parentElement.querySelectorAll('.filter-chip').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
  }
  renderHostBookings(state.hostCache.bookings || []);
}

async function handleHostBookingAction(bookingId, action) {
  try {
    await apiFetch(`/host/bookings/${bookingId}/${action}`, { method: 'POST' });
    showToast(`Booking ${action === 'accept' ? 'confirmed' : 'rejected'}`, 'success');
    loadHostDashboard();
    loadNotifications();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function toggleHostChargerPower(chargerId) {
  try {
    const res = await apiFetch(`/host/chargers/${chargerId}/toggle-power`, { method: 'POST' });
    showToast(`Charger switched ${res.newStatus}`, 'info');
    loadHostDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openAddChargerModal() {
  const m = getEl('add-charger-modal');
  if (m) m.classList.add('open', 'active');
  onNewChargerTypeChange(getEl('new-charger-type')?.value || 'Type 2 AC');
}

function onNewChargerTypeChange(val) {
  const label = getEl('new-charger-price-label');
  const input = getEl('new-charger-tariff');
  const hint = getEl('new-charger-billing-hint');

  if (val.includes('16A')) {
    if (label) label.textContent = 'Hourly rate (Rs / hour)';
    if (input) input.value = '60';
    if (hint) hint.textContent = '16A 3-Pin hardware uses Time-Based Slot Billing.';
  } else if (val.includes('CCS')) {
    if (label) label.textContent = 'Energy tariff (Rs / kWh)';
    if (input) input.value = '22';
    if (hint) hint.textContent = 'CCS 2 DC Fast Charger uses Smart Metered kWh Billing.';
  } else {
    if (label) label.textContent = 'Energy tariff (Rs / kWh)';
    if (input) input.value = '18';
    if (hint) hint.textContent = 'Type 2 AC Dock uses Smart Metered kWh Billing.';
  }
}

async function handleOnboardCharger(e) {
  e.preventDefault();
  const typeVal = getEl('new-charger-type')?.value || 'Type 2 AC';
  const tariff = parseFloat(getEl('new-charger-tariff')?.value || '18');
  const isTime = typeVal.includes('16A');
  const powerKw = typeVal.includes('CCS') ? 25.0 : (isTime ? 3.3 : 7.4);

  try {
    await apiFetch('/host/chargers', {
      method: 'POST',
      body: {
        name: getEl('new-charger-title')?.value.trim(),
        address: getEl('new-charger-address')?.value.trim(),
        city: 'Greater Noida',
        connectorType: typeVal,
        powerKw,
        billingType: isTime ? 'time' : 'metered',
        pricePerKwh: isTime ? 0 : tariff,
        timeRatePerHour: isTime ? tariff : 0
      }
    });
    closeModal('add-charger-modal');
    e.target.reset();
    showToast('Charger onboarded (Admin verification pending)', 'success');
    loadHostDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openEditChargerModal(chargerId) {
  const chg = (state.hostCache.chargers || []).find(c => c.id === chargerId);
  if (!chg) return;

  if (getEl('edit-chg-id')) getEl('edit-chg-id').value = chg.id;
  if (getEl('edit-chg-name')) getEl('edit-chg-name').value = chg.name || '';
  if (getEl('edit-chg-kwh-price')) getEl('edit-chg-kwh-price').value = String(chg.price_per_kwh || 18);
  if (getEl('edit-chg-time-price')) getEl('edit-chg-time-price').value = String(chg.time_rate_per_hour || 60);
  if (getEl('edit-chg-hours')) getEl('edit-chg-hours').value = chg.operating_hours || '06:00 - 23:00';
  if (getEl('edit-chg-status')) getEl('edit-chg-status').value = chg.status || 'available';
  if (getEl('edit-chg-access')) getEl('edit-chg-access').value = chg.access_instructions || '';

  const m = getEl('edit-charger-modal');
  if (m) m.classList.add('open', 'active');
}

async function handleEditChargerSubmit(e) {
  e.preventDefault();
  const id = getEl('edit-chg-id')?.value;
  if (!id) return;

  try {
    await apiFetch(`/host/chargers/${id}`, {
      method: 'PUT',
      body: {
        name: getEl('edit-chg-name')?.value.trim(),
        pricePerKwh: parseFloat(getEl('edit-chg-kwh-price')?.value || '18'),
        timeRatePerHour: parseFloat(getEl('edit-chg-time-price')?.value || '60'),
        operatingHours: getEl('edit-chg-hours')?.value.trim(),
        status: getEl('edit-chg-status')?.value,
        accessInstructions: getEl('edit-chg-access')?.value.trim()
      }
    });
    closeModal('edit-charger-modal');
    showToast('Charger configuration updated', 'success');
    loadHostDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadHostEarnings() {
  if (!state.authToken || state.currentRole !== 'host') return;
  try {
    const res = await apiFetch('/host/earnings');
    const sum = res.summary || {};
    const strip = getEl('host-earnings-summary-strip');
    if (strip) {
      strip.innerHTML = `
        <div class="summary-item"><div class="summary-label">Gross completed volume</div><div class="summary-value tabular">${formatInr(sum.total_gross)}</div></div>
        <div class="summary-item"><div class="summary-label">Platform &amp; GST deducted</div><div class="summary-value tabular">${formatInr(sum.total_commission_deducted)}</div></div>
        <div class="summary-item"><div class="summary-label">Net host earnings</div><div class="summary-value tabular" style="color:var(--accent-green);">${formatInr(sum.net_host_earnings)}</div></div>
        <div class="summary-item"><div class="summary-label">Confirmed pending payout</div><div class="summary-value tabular">${formatInr(sum.pending_confirmed_payouts)}</div></div>
      `;
    }

    const ledgerEl = getEl('host-earnings-ledger-container');
    if (!ledgerEl) return;
    const rows = res.payoutLedger || [];
    if (!rows.length) {
      ledgerEl.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:16px;">No settled or confirmed host payouts recorded yet.</div>';
      return;
    }

    ledgerEl.innerHTML = `
      <div class="table-scroll-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th class="admin-th">Booking</th>
              <th class="admin-th">Charger &amp; Driver</th>
              <th class="admin-th">Date / Slot</th>
              <th class="admin-th">Gross Paid</th>
              <th class="admin-th">Fees + GST</th>
              <th class="admin-th">Net Host Payout</th>
              <th class="admin-th">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td class="admin-td tabular">${escapeHtml(r.booking_code)}</td>
                <td class="admin-td">${escapeHtml(r.charger_name)}<br><span style="font-size:11px;color:var(--text-secondary);">${escapeHtml(r.driver_name)}</span></td>
                <td class="admin-td tabular">${escapeHtml(r.booking_date)} ${escapeHtml(r.start_time)}</td>
                <td class="admin-td tabular">${formatInr(r.total_amount)}</td>
                <td class="admin-td tabular">${formatInr(Number(r.platform_fee || 0) + Number(r.gst_fee || 0))}</td>
                <td class="admin-td tabular" style="color:var(--accent-green); font-weight:600;">${formatInr(r.host_payout)}</td>
                <td class="admin-td"><span class="status-badge ${badgeClass(r.status)}"><span class="status-dot ${statusDotClass(r.status)}"></span>${escapeHtml(formatStatusLabel(r.status))}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function populateHostProfileForm() {
  if (!state.authToken) return;
  try {
    const me = await apiFetch('/auth/me');
    const u = me.user || {};
    const hp = me.hostProfile || {};

    if (getEl('prof-host-name')) getEl('prof-host-name').value = u.name || '';
    if (getEl('prof-host-email')) getEl('prof-host-email').value = u.email || '';
    if (getEl('prof-host-phone')) getEl('prof-host-phone').value = u.phone || '';
    if (getEl('prof-host-address')) getEl('prof-host-address').value = hp.address || '';
    if (getEl('prof-host-city')) getEl('prof-host-city').value = hp.city || '';
    if (getEl('prof-host-pin')) getEl('prof-host-pin').value = hp.pincode || '';
    if (getEl('prof-host-upi')) getEl('prof-host-upi').value = hp.upi_id || '';

    const b = getEl('prof-host-verif-badge');
    if (b) {
      const st = hp.verification_status || 'pending';
      b.innerHTML = `<span class="status-dot ${statusDotClass(st)}"></span>KYC: ${escapeHtml(formatStatusLabel(st))}`;
      b.className = `status-badge ${badgeClass(st)}`;
    }
  } catch (_) {}
}

async function handleUpdateHostProfile(e) {
  e.preventDefault();
  try {
    await apiFetch('/auth/profile', {
      method: 'PUT',
      body: {
        name: getEl('prof-host-name')?.value.trim(),
        phone: getEl('prof-host-phone')?.value.trim(),
        address: getEl('prof-host-address')?.value.trim(),
        city: getEl('prof-host-city')?.value.trim(),
        pincode: getEl('prof-host-pin')?.value.trim(),
        upiId: getEl('prof-host-upi')?.value.trim()
      }
    });
    showToast('Host KYC profile updated', 'success');
    await hydrateAuthenticatedSession();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -------------------- Admin Experience --------------------
async function loadAdminData() {
  if (!state.authToken || state.currentRole !== 'admin') return;

  try {
    const [dash, hostsRes, chgRes, usersRes, bookingsRes, txRes, dispRes] = await Promise.all([
      apiFetch('/admin/dashboard'),
      apiFetch('/admin/hosts'),
      apiFetch('/admin/chargers'),
      apiFetch('/admin/users'),
      apiFetch('/admin/bookings'),
      apiFetch('/admin/transactions'),
      apiFetch('/admin/disputes')
    ]);

    const m = dash.metrics || {};
    const set = (id, v) => { const n = getEl(id); if (n) n.textContent = v; };
    set('admin-m-users', String(m.totalUsers || 0));
    set('admin-m-hosts', String(m.totalHosts || 0));
    set('admin-m-chargers', String(m.totalChargers || 0));
    set('admin-m-active-bookings', String(m.activeBookings || 0));
    set('admin-m-gmv', formatInr(m.totalGmv || 0, 0));
    set('admin-m-revenue', formatInr(m.platformRevenue || 0, 0));

    state.adminCache = {
      hosts: hostsRes.hosts || [],
      chargers: chgRes.chargers || [],
      users: usersRes.users || [],
      bookings: bookingsRes.bookings || [],
      transactions: txRes.transactions || [],
      disputes: dispRes.disputes || [],
      logs: dash.logs || []
    };

    renderAdminBookingsTable();
    renderAdminTransactionsTable();
    renderAdminHostsTable();
    renderAdminChargersTable();
    renderAdminUsersTable();
    renderAdminDisputesTable();
    renderAdminLogs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderAdminBookingsTable() {
  const el = getEl('admin-bookings-table-container');
  if (!el) return;
  const rows = state.adminCache.bookings || [];
  if (!rows.length) {
    el.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">No bookings logged yet.</div>';
    return;
  }

  el.innerHTML = `
    <table class="admin-table">
      <thead><tr><th class="admin-th">Code</th><th class="admin-th">Driver</th><th class="admin-th">Charger / Host</th><th class="admin-th">Slot</th><th class="admin-th">Total</th><th class="admin-th">Status</th></tr></thead>
      <tbody>
        ${rows.slice(0, 15).map(b => `
          <tr>
            <td class="admin-td tabular">${escapeHtml(b.booking_code)}</td>
            <td class="admin-td">${escapeHtml(b.driver_name)}</td>
            <td class="admin-td">${escapeHtml(b.charger_name)}<br><span style="font-size:11px; color:var(--text-secondary);">Host: ${escapeHtml(b.host_name)}</span></td>
            <td class="admin-td tabular">${escapeHtml(b.booking_date)} ${escapeHtml(b.start_time)}</td>
            <td class="admin-td tabular">${formatInr(b.total_amount)}</td>
            <td class="admin-td"><span class="status-badge ${badgeClass(b.status)}"><span class="status-dot ${statusDotClass(b.status)}"></span>${escapeHtml(formatStatusLabel(b.status))}</span></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderAdminTransactionsTable() {
  const el = getEl('admin-transactions-table-container');
  if (!el) return;
  const rows = state.adminCache.transactions || [];
  if (!rows.length) {
    el.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">No wallet/payment entries recorded yet.</div>';
    return;
  }

  el.innerHTML = `
    <table class="admin-table">
      <thead><tr><th class="admin-th">User</th><th class="admin-th">Type</th><th class="admin-th">Method</th><th class="admin-th">Amount</th><th class="admin-th">Description</th></tr></thead>
      <tbody>
        ${rows.slice(0, 15).map(p => `
          <tr>
            <td class="admin-td">${escapeHtml(p.user_name)}<br><span style="font-size:11px; color:var(--text-secondary);">${escapeHtml(p.user_email)}</span></td>
            <td class="admin-td">${escapeHtml(formatStatusLabel(p.type))}</td>
            <td class="admin-td">${escapeHtml(p.method || 'Wallet')}</td>
            <td class="admin-td tabular">${formatInr(p.amount)}</td>
            <td class="admin-td">${escapeHtml(p.description || '')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderAdminHostsTable() {
  const el = getEl('admin-hosts-table-container');
  if (!el) return;

  const q = (getEl('admin-host-search')?.value || '').trim().toLowerCase();
  const f = getEl('admin-host-filter')?.value || 'all';

  const rows = (state.adminCache.hosts || []).filter(h => {
    const matchF = f === 'all' || h.verification_status === f;
    const matchQ = !q || `${h.name} ${h.email} ${h.city} ${h.pincode}`.toLowerCase().includes(q);
    return matchF && matchQ;
  });

  if (!rows.length) {
    el.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:14px;">No hosts match current filter.</div>';
    return;
  }

  el.innerHTML = `
    <table class="admin-table">
      <thead><tr><th class="admin-th">Host</th><th class="admin-th">Address &amp; City</th><th class="admin-th">UPI ID</th><th class="admin-th">KYC Status</th><th class="admin-th">Actions</th></tr></thead>
      <tbody>
        ${rows.map(h => `
          <tr>
            <td class="admin-td"><strong>${escapeHtml(h.name)}</strong><br><span style="font-size:11px; color:var(--text-secondary);">${escapeHtml(h.email)}</span></td>
            <td class="admin-td">${escapeHtml(h.address)}<br><span style="font-size:11px; color:var(--text-secondary);">${escapeHtml(h.city)} ${escapeHtml(h.pincode)}</span></td>
            <td class="admin-td tabular">${escapeHtml(h.upi_id || '-')}</td>
            <td class="admin-td"><span class="status-badge ${badgeClass(h.verification_status)}"><span class="status-dot ${statusDotClass(h.verification_status)}"></span>${escapeHtml(formatStatusLabel(h.verification_status))}</span></td>
            <td class="admin-td">
              <button class="btn-table-action approve" onclick="adminVerifyHost('${escapeHtml(h.user_id)}', 'verified')">Verify</button>
              <button class="btn-table-action reject" onclick="adminVerifyHost('${escapeHtml(h.user_id)}', 'rejected')">Reject</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderAdminChargersTable() {
  const el = getEl('admin-chargers-table-container');
  if (!el) return;

  const q = (getEl('admin-charger-search')?.value || '').trim().toLowerCase();
  const f = getEl('admin-charger-filter')?.value || 'all';

  const rows = (state.adminCache.chargers || []).filter(c => {
    const matchF = f === 'all' || c.verification_status === f;
    const matchQ = !q || `${c.name} ${c.code} ${c.host_name}`.toLowerCase().includes(q);
    return matchF && matchQ;
  });

  if (!rows.length) {
    el.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:14px;">No chargers match current filter.</div>';
    return;
  }

  el.innerHTML = `
    <table class="admin-table">
      <thead><tr><th class="admin-th">Code &amp; Charger</th><th class="admin-th">Host</th><th class="admin-th">Hardware &amp; Tariff</th><th class="admin-th">Audit</th><th class="admin-th">Actions</th></tr></thead>
      <tbody>
        ${rows.map(c => `
          <tr>
            <td class="admin-td"><strong>${escapeHtml(c.name)}</strong><br><span class="tabular" style="font-size:11px; color:var(--text-secondary);">${escapeHtml(c.code)}</span></td>
            <td class="admin-td">${escapeHtml(c.host_name)}</td>
            <td class="admin-td tabular">${escapeHtml(c.connector_type)} | ${c.power_kw} kW<br><span style="font-size:11px; color:var(--text-secondary);">${c.billing_type === 'time' ? formatInr(c.time_rate_per_hour, 0) + '/hr' : formatInr(c.price_per_kwh, 0) + '/kWh'}</span></td>
            <td class="admin-td"><span class="status-badge ${badgeClass(c.verification_status)}"><span class="status-dot ${statusDotClass(c.verification_status)}"></span>${escapeHtml(formatStatusLabel(c.verification_status))}</span></td>
            <td class="admin-td">
              <button class="btn-table-action approve" onclick="adminVerifyCharger('${escapeHtml(c.id)}', 'approved')">Approve</button>
              <button class="btn-table-action reject" onclick="adminVerifyCharger('${escapeHtml(c.id)}', 'rejected')">Reject</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderAdminUsersTable() {
  const el = getEl('admin-users-table-container');
  if (!el) return;

  const q = (getEl('admin-user-search')?.value || '').trim().toLowerCase();
  const roleF = getEl('admin-user-role-filter')?.value || 'all';

  const rows = (state.adminCache.users || []).filter(u => {
    const matchR = roleF === 'all' || u.role === roleF;
    const matchQ = !q || `${u.name} ${u.email} ${u.phone || ''}`.toLowerCase().includes(q);
    return matchR && matchQ;
  });

  if (!rows.length) {
    el.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:14px;">No users match search filter.</div>';
    return;
  }

  el.innerHTML = `
    <table class="admin-table">
      <thead><tr><th class="admin-th">Name &amp; Contact</th><th class="admin-th">Role</th><th class="admin-th">Wallet</th><th class="admin-th">Status</th><th class="admin-th">Access Control</th></tr></thead>
      <tbody>
        ${rows.map(u => `
          <tr>
            <td class="admin-td"><strong>${escapeHtml(u.name)}</strong><br><span style="font-size:11px; color:var(--text-secondary);">${escapeHtml(u.email)}</span></td>
            <td class="admin-td"><span class="role-badge role-${escapeHtml(u.role)}">${escapeHtml(formatStatusLabel(u.role))}</span></td>
            <td class="admin-td tabular">${formatInr(u.wallet_balance || 0)}</td>
            <td class="admin-td"><span class="status-badge ${u.is_suspended ? 'status-offline' : 'status-available'}"><span class="status-dot ${u.is_suspended ? 'red' : 'green'}"></span>${u.is_suspended ? 'Suspended' : 'Active'}</span></td>
            <td class="admin-td">
              ${u.role !== 'admin'
                ? `<button class="btn-table-action suspend" onclick="adminToggleUserSuspend('${escapeHtml(u.id)}')">${u.is_suspended ? 'Restore' : 'Suspend'}</button>`
                : '<span style="font-size:11px; color:var(--text-muted);">Protected</span>'}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderAdminDisputesTable() {
  const el = getEl('admin-disputes-table-container');
  if (!el) return;
  const rows = state.adminCache.disputes || [];

  if (!rows.length) {
    el.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:16px;">No disputes filed. Platform arbitration queue is clear.</div>';
    return;
  }

  el.innerHTML = `
    <table class="admin-table">
      <thead><tr><th class="admin-th">Booking</th><th class="admin-th">Raised By</th><th class="admin-th">Reason &amp; Notes</th><th class="admin-th">Status</th><th class="admin-th">Resolution</th></tr></thead>
      <tbody>
        ${rows.map(d => `
          <tr>
            <td class="admin-td tabular"><strong>${escapeHtml(d.booking_code)}</strong><br><span style="font-size:11px; color:var(--text-secondary);">${escapeHtml(d.charger_name)} (${formatInr(d.total_amount)})</span></td>
            <td class="admin-td">${escapeHtml(d.raised_by_name)}<br><span style="font-size:11px; color:var(--text-secondary);">${escapeHtml(formatStatusLabel(d.raised_by_role))}</span></td>
            <td class="admin-td">${escapeHtml(d.reason)}${d.resolution_notes ? `<br><span style="font-size:11px; color:var(--accent-green);">Note: ${escapeHtml(d.resolution_notes)}</span>` : ''}</td>
            <td class="admin-td"><span class="status-badge ${badgeClass(d.status)}"><span class="status-dot ${statusDotClass(d.status)}"></span>${escapeHtml(formatStatusLabel(d.status))}</span></td>
            <td class="admin-td">
              ${d.status === 'open'
                ? `<button class="btn-table-action approve" onclick="adminResolveDispute('${escapeHtml(d.id)}', 'resolved')">Resolve</button>
                   <button class="btn-table-action reject" onclick="adminResolveDispute('${escapeHtml(d.id)}', 'dismissed')">Dismiss</button>`
                : '<span style="font-size:11px; color:var(--text-muted);">Closed</span>'}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderAdminLogs() {
  const el = getEl('admin-full-logs-container');
  if (!el) return;
  const logs = state.adminCache.logs || [];
  if (!logs.length) {
    el.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">No audit log events recorded yet.</div>';
    return;
  }

  el.innerHTML = logs.map(l => `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; padding:10px 0; border-bottom:1px solid var(--border-color); gap:12px;">
      <div>
        <div style="font-size:12px; font-weight:600; color:var(--text-primary);">${escapeHtml(l.action)}</div>
        <div style="font-size:12px; color:var(--text-secondary);">${escapeHtml(l.details)}</div>
      </div>
      <div class="tabular" style="font-size:11px; color:var(--text-muted); white-space:nowrap;">${escapeHtml(l.created_at || '')}</div>
    </div>
  `).join('');
}

async function adminVerifyHost(hostUserId, status) {
  try {
    await apiFetch(`/admin/hosts/${hostUserId}/verify`, { method: 'POST', body: { status } });
    showToast(`Host KYC marked ${status}`, 'success');
    loadAdminData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function adminVerifyCharger(chargerId, status) {
  try {
    await apiFetch(`/admin/chargers/${chargerId}/verify`, { method: 'POST', body: { status } });
    showToast(`Charger marked ${status}`, 'success');
    loadAdminData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function adminToggleUserSuspend(userId) {
  try {
    const res = await apiFetch(`/admin/users/${userId}/toggle-suspend`, { method: 'POST' });
    showToast(res.isSuspended ? 'User account suspended' : 'User account restored', 'info');
    loadAdminData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function adminResolveDispute(disputeId, status) {
  const notes = status === 'resolved'
    ? 'Arbitrated in favor of verified claim with ledger adjustment notice.'
    : 'Dismissed after telemetry log verification.';
  try {
    await apiFetch(`/admin/disputes/${disputeId}/resolve`, {
      method: 'POST',
      body: { status, resolutionNotes: notes }
    });
    showToast(`Dispute ${status}`, 'success');
    loadAdminData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -------------------- Platform Policies & Support Modal --------------------
function openComplianceDoc(section) {
  const docs = {
    terms: {
      title: 'Terms of Service',
      html: `
        <p style="margin-bottom:10px;">ChargeEase EV connects electric vehicle drivers with verified residential and semi-private charger hosts for scheduled charging slots.</p>
        <ul style="padding-left:18px; line-height:1.7;">
          <li>Drivers must arrive within 15 minutes of their reserved slot start window.</li>
          <li>Exact host driveway gate numbers and phone numbers are privacy-gated until host confirmation.</li>
          <li>Platform commission (10% of base tariff) and GST on the commission (18%) are disclosed prior to reservation confirmation.</li>
          <li>Wallet balances and payment gateway calls in this prototype run in simulated demo mode for hackathon verification.</li>
        </ul>`
    },
    privacy: {
      title: 'Privacy & Location Policy',
      html: `
        <p style="margin-bottom:10px;">Protecting residential host addresses and driver movement telemetry is mandatory on ChargeEase EV.</p>
        <ul style="padding-left:18px; line-height:1.7;">
          <li>Pre-booking charger listings display only sector/corridor locality and masked approximate coordinates.</li>
          <li>Exact access instructions unlock solely for confirmed or active bookings involving the respective driver and host.</li>
          <li>GPS queries are used exclusively to compute road distance and reachability buffer checks.</li>
        </ul>`
    },
    safety: {
      title: 'Electrical & Driveway Safety Guidelines',
      html: `
        <ul style="padding-left:18px; line-height:1.7;">
          <li>All listed chargers require proper earthing, MCB/RCCB residual current protection, and weather-shielded enclosures.</li>
          <li>Never use unrated extension cords or spliced adapters on Type 2 or 16A charging points.</li>
          <li>Hosts must keep fire safety clearance around parked EVs and mark chargers offline during electrical maintenance.</li>
          <li>Report any arcing, overheating plug, or blocked bay immediately via Booking -> Report issue.</li>
        </ul>`
    },
    refunds: {
      title: 'Cancellation & Refund Policy',
      html: `
        <ul style="padding-left:18px; line-height:1.7;">
          <li>Bookings cancelled before host acceptance or prior to slot commencement are eligible for full refund in the demo wallet ledger.</li>
          <li>If a confirmed host charger is offline or inaccessible upon arrival, drivers can open a dispute ticket for admin arbitration.</li>
          <li>Time-billed 16A sockets bill reserved duration irrespective of onboard vehicle taper rate.</li>
        </ul>`
    },
    support: {
      title: 'Help & Operations Support',
      html: `
        <p style="margin-bottom:10px;">Need assistance with an active slot, KYC review, or charger hardware verification?</p>
        <div style="padding:12px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-md); font-size:12px; line-height:1.7;">
          <strong>Support Desk:</strong> support@chargeease.demo<br>
          <strong>Emergency Corridor Assistance:</strong> Use Report issue inside Bookings for priority Admin arbitration.<br>
          <strong>Environment Notice:</strong> Telemetry streams and payment settlements are simulated for demonstration.
        </div>`
    }
  };

  const doc = docs[section] || docs.support;
  const modal = getEl('compliance-modal');
  const titleEl = getEl('compliance-modal-title');
  const bodyEl = getEl('compliance-modal-body');

  if (titleEl) titleEl.textContent = doc.title;
  if (bodyEl) bodyEl.innerHTML = doc.html;
  if (modal) modal.classList.add('open', 'active');
}
