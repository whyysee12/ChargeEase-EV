# ChargeEase EV - Full-Stack Product Architecture
### Peer-to-Peer EV Charging Network & Mobility Platform

Find a charger you can actually reach, trust, and afford.

ChargeEase EV connects electric vehicle drivers with verified residential hosts, housing societies, and commercial parking docks across Delhi NCR and the Greater Noida Expressway corridor. Engineered on Node.js with zero external npm runtime dependencies, native `node:sqlite` persistence, role-based access control, atomic slot concurrency locking, privacy-gated charger addresses, and a reachability-aware routing engine.

---

## Quick Start

```bash
# Run the full-stack server
node server.js
```

- **Web Application URL:** `http://localhost:3000`
- **Health Check API:** `http://localhost:3000/api/health`

### Run Automated API Test Suite
```bash
node test_api.js
```

---

## Demo Role Credentials (Seeded Non-Production Dataset)

Use the top Workspace Role switcher in the UI or sign in manually using the seeded hackathon credentials:

| Role | Email | Password | Entity | Capabilities |
| :--- | :--- | :--- | :--- | :--- |
| **Admin** | `admin@chargeease.com` | `Admin@123` | Platform Operations | Host KYC verification, charger listing audit, user suspension, bookings & transactions monitor, disputes arbitration, audit logs |
| **Host** | `host@chargeease.com` | `Host@123` | Amit Verma | Charger onboarding & editing, remote online/offline toggle, booking approvals/rejections, itemized payout & earnings ledger |
| **Driver** | `driver@chargeease.com` | `Driver@123` | Rahul Sharma | Action-first readiness workspace, map discovery & filtering, reachability range engine, slot booking, simulated telemetry & wallet, vehicle garage |

---

## Architecture & Technology Stack

- **Runtime & Server:** Node.js v22 native `http` module (`server.js` + `backend/api.js`).
- **Relational Database:** Built-in `node:sqlite` (`chargeease.db`) with Write-Ahead Logging (WAL) and foreign key constraints (`backend/db.js`).
- **Authentication & RBAC:** Per-user salted `crypto.scryptSync` password hashing and HMAC-SHA256 bearer tokens with server-side role enforcement.
- **Mapping & Routing:** Local `leaflet.js` / `leaflet.css` with crisp dark/light OpenStreetMap tiles and live OSRM road routing (with straight-corridor distance estimate fallback when public OSRM routing is unreachable).
- **EV Mobility Design System:** Graphite neutral surface hierarchy (`#0A0A0B` to `#23262D`), restrained semantic status indicators (`#10B981`, `#3B82F6`, `#F59E0B`, `#EF4444`), tabular numerals, skeleton loading states, and zero emojis.

---

## Key Workflows & Transparency Disclosures

1. **Privacy-Gated Charger Discovery:** Pre-booking views mask exact house/gate instructions and display sector-level approximate locations until a booking transitions to `confirmed`, `active`, or `completed`.
2. **Reachability Engine:** Computes usable safe reach from battery SoC, vehicle pack capacity, efficiency, and configurable emergency safety reserve (`10%`, `20%`, or `30%`), separating eligible chargers from excluded ones with clear reasoning.
3. **Atomic Slot Concurrency & Dual Billing:** Slot booking checks overlap (`NOT (existing.end_time <= new.start_time OR existing.start_time >= new.end_time)`) returning `HTTP 409 Conflict`. Metered kWh and time-billed 16A chargers clearly disclose rates plus **10% platform commission + 18% GST on commission** prior to confirmation.
4. **Simulated Hardware & Payments Notice:** Wallet UPI top-ups, IoT telemetry streaming, and host payout settlements are simulated within SQLite for hackathon evaluation.

---

## REST API Reference

### Authentication (`/api/auth`)
- `POST /api/auth/register-driver` - Register driver + initial EV record
- `POST /api/auth/register-host` - Register host + pending KYC profile
- `POST /api/auth/login` - Authenticate and obtain signed bearer token
- `GET /api/auth/me` - Current authenticated user profile, garage EV, or host KYC status
- `PUT /api/auth/profile` - Update driver/host profile fields
- `PUT /api/auth/change-password` - Update account password

### Driver, Discovery & Garage (`/api/driver`, `/api/chargers`, `/api/bookings`)
- `GET /api/driver/dashboard` - Summary stats, vehicles, bookmarks, active booking, recent sessions
- `GET /api/driver/chargers` - Filter & sort chargers (`lat`, `lng`, `search`, `connector`, `billing`, `status`, `minPower`, `sortBy`)
- `POST /api/driver/analyze-location` - Sync curated nearby docks to driver GPS coordinates
- `GET /api/driver/reachability` - Usable safe reach calculation and charger eligibility classification
- `GET /api/chargers/:id/details` - Full charger specs, today's occupied booking slots, and driver reviews
- `POST /api/chargers/:id/reviews` - Post review and recompute charger average rating
- `POST /api/driver/favorites/:chargerId` - Toggle bookmarked favorite charger
- `GET|POST /api/driver/vehicles`, `PUT /api/driver/vehicles/:id/primary`, `DELETE /api/driver/vehicles/:id` - Vehicle garage CRUD
- `GET /api/driver/sessions` - Driver charging session history
- `GET /api/driver/bookings`, `POST /api/bookings`, `POST /api/bookings/:id/cancel` - Slot reservations & refunds

### Host Operations (`/api/host`)
- `GET /api/host/dashboard` - Operational summary strip, utilization %, listed chargers, booking queue
- `GET|POST /api/host/chargers`, `PUT /api/host/chargers/:id`, `POST /api/host/chargers/:id/toggle-power` - Charger CRUD & status toggle
- `POST /api/host/bookings/:id/(accept|reject)` - Approve or reject driver booking requests
- `GET /api/host/earnings` - Gross volume, deducted fees, net payouts, and itemized payout ledger

### Admin Oversight, Disputes & Audit (`/api/admin`, `/api/disputes`)
- `GET /api/admin/dashboard` - Ecosystem GMV, platform revenue, GST collected, audit logs
- `GET /api/admin/hosts`, `POST /api/admin/hosts/:id/verify` - Host KYC review
- `GET /api/admin/chargers`, `POST /api/admin/chargers/:id/verify` - Charger listing approval/rejection
- `GET /api/admin/users`, `POST /api/admin/users/:id/toggle-suspend` - User access suspension/restoration
- `GET /api/admin/bookings`, `GET /api/admin/transactions` - Platform-wide booking & payment monitors
- `GET /api/admin/disputes`, `POST /api/admin/disputes/:id/resolve`, `POST /api/disputes` - Dispute submission and arbitration

### Telemetry, Wallet & Notifications (`/api/sessions`, `/api/wallet`, `/api/notifications`)
- `POST /api/sessions/start`, `POST /api/sessions/:id/stop` - Simulated charging session lifecycle and itemized receipt settlement
- `POST /api/wallet/topup`, `GET /api/wallet/transactions` - Simulated UPI wallet recharge and ledger
- `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all` - In-app alert management
