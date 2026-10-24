# APAAR Verify: AICTE Student Data Management & Verification Platform
**Smart India Hackathon (SIH 2026) Prototype**

> **Problem Statement:** *Development of an APAAR ID-Based Student Data Management and Verification Platform for AICTE-Approved Institutions*

---

## 🏛️ 1. Architecture Overview
**APAAR Verify** acts as a compliance and verification layer sitting on top of APAAR, Academic Bank of Credits (ABC), DigiLocker, and AICTE approval engines. It integrates directly with a persistent **Supabase PostgreSQL** backend, Row-Level Security (RLS), and cryptographic verification.

```
       ┌───────────────────────────────┐
       │   Student / Institute / AICTE │
       │    React 19 + Vite Frontend   │
       └───────┬───────────────┬───────┘
               │               │ Supabase Client SDK
               │ REST APIs     ▼
       ┌───────▼───────┐  ┌───────────────────────────────┐
       │ FastAPI Core  │  │   Supabase Cloud PostgreSQL   │
       │ Gateway Proxy │  │   (Auth, RLS, Chained Audit)  │
       └───────┬───────┘  └───────────────────────────────┘
               │
 ┌─────────────▼──┐  ┌─────────────┐  ┌───────────────┐
 │ Mock APAAR     │  │ Mock ABC    │  │ DigiLocker    │
 │ (12-Digit KYC) │  │ (Credits)   │  │ (Credentials) │
 └────────────────┘  └─────────────┘  └───────────────┘
```

### Key Pillars:
1. **Paperless Zero-Upload Compliance:** Demographic and prior qualifications arrive via consent-gated mock adapters (APAAR, ABC, DigiLocker, NSP).
2. **AICTE Sanctioned Intake & Ratio Enforcement:** Hard cap on verified admissions + real-time faculty-student ratio gate (20:1 threshold) on every admission.
3. **NEP 2020 Multi-Entry & Exit Support:** Automated verification for diploma lateral entry, transfer NOCs with credit carryover, and award certificates.
4. **Rotating HMAC-SHA256 Single-Use QR Attendance:** Personal rotating QR code updated every 30 seconds, unlocked only upon active institute acceptance.
5. **Dynamic Scholarship Disbursal Gate:** Multi-rule validation (APAAR KYC, attendance cutoff, family income, host institute compliance, scheme exclusivity) with disbursal-time drift re-checks.
6. **Tamper-Evident SHA-256 Audit Trail:** Cryptographically linked hash chain (`hash = SHA256(prev_hash + payload)`) across all lifecycle transitions with 1-click audit integrity validation.
7. **Supabase Integration & RLS:** Persistent PostgreSQL storage with Row-Level Security, Supabase Auth session management, and `user_profiles` role mapping.

---

## ⚙️ 2. Supabase Integration & Environment Configuration

### Environment Variables
Copy `frontend/.env.example` to `frontend/.env`:
```bash
cp frontend/.env.example frontend/.env
```

Contents of `frontend/.env`:
```env
# Supabase Project Configuration
VITE_SUPABASE_URL=https://wdioyfgiodoggqelfmnm.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndkaW95Zmdpb2RvZ2dxZWxmbW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NTc1NDQsImV4cCI6MjEwODQzMzU0NH0.w7St9qk37Zo2QmuvXv0HoQYcnhkj31ZXpXbOYMW4Ns4

# Optional Backend Core API Gateway
VITE_API_BASE=http://localhost:8000
```

### Database Schema Mapping
| Application Entity | Supabase Database Table | Description |
|---|---|---|
| User Profiles & Roles | `public.user_profiles` | Maps `auth.users(id)` to `role`, `apaar_id`, `institute_id` |
| Student Demographics | `public.students` | Master APAAR-verified demographic records |
| AICTE Institutions | `public.institutes` | Approved colleges and their AICTE unique codes |
| Intake & Faculty Ratio | `public.capacity` | Sanctioned intake, verified seats, faculty FTE |
| Student Enrollments | `public.enrollments` | Active/Historical admissions (1 active admission hard rule) |
| Academic Credits | `public.credit_ledger` | Deposited academic credits from ABC |
| Admission Requests | `public.requests` | Join, transfer, and lateral entry application queues |
| Attendance Records | `public.attendance` | Single-use nonce, session, timestamp attendance logs |
| Attendance Summaries | `public.attendance_summary` | Monthly days present, days held, attendance percentage |
| Schemes & Rules | `public.schemes`, `public.scheme_rules` | Configurable scholarship rules (income, gender, attendance) |
| Benefit Claims | `public.claims_ledger` | Disbursed scholarship claims |
| Dynamic System Rules | `public.rules` | System-wide thresholds (ratios, confirmation windows) |
| Grievance Records | `public.grievances` | Student dispute lodging and AICTE resolution history |
| Immutable Audit Chain | `public.audit_log` | Cryptographically chained SHA-256 event trail |

### Applying Seed & RLS Migration
The schema and seed migration is located at `supabase/migrations/20261025000000_seed_and_rls.sql`. You can execute this file in the Supabase SQL Editor to populate the initial master data and verify RLS policies.

---

## 🚀 3. Quickstart & Running Instructions

### Running the Application (From Root)
```bash
# Run dev server
npm run dev

# Or build for production
npm run build
```

### Running Frontend Directly
```bash
cd frontend
npm run dev
```
- Web Application: [http://localhost:5173/](http://localhost:5173/)

### Backend (Optional Gateway)
```bash
cd backend
python3 -m uvicorn main:app --reload --port 8000
```
- API Docs & Swagger UI: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 🧪 4. Walkthrough of the 10 Demonstration Scenarios

| Scenario # | Description | How to Verify in Web App |
|---|---|---|
| **1** | Student join request → Institute approval → QR unlocks | Switch persona to `Student Test 08` (Unenrolled), submit a Join request to `Delhi Engineering`. Switch role to `Institute Admin`, click `Accept & Verify`. Switch back to Student: attendance QR is unlocked and live! |
| **2** | Teacher QR scan → Duplicate rejection → Expired token | In `Institute Admin` > `Scan Attendance`, click `Verify & Mark Attendance`. Result shows `Attendance Recorded Successfully`. Click again: rejected with `Already marked for this session today`. Click `Test Expired / Tampered`: rejected with `Tampered or invalid token signature`. |
| **3** | Diploma student lateral entry to Year 2 | In Student view, select `Karthik Rajan` (Polytechnic Diploma holder). Submit a `Lateral Entry` request. The qualification is recognized and accepted directly into Year 2. A non-diploma applicant is blocked. |
| **4** | Dual active admission prevention | Student `Priya Sharma` (already ACTIVE at Delhi Engineering) tries to join another institute. The gate rejects with `DUPLICATE ENROLLMENT REJECTED: Multi-college dual active admissions are strictly prohibited`. |
| **5** | Inter-College Transfer with ABC Credits | Submit a `Transfer` request from College A to College B. On approval, old enrollment closes as `TRANSFERRED_OUT`, new one becomes `ACTIVE`, ABC credits transfer, and old college scanner rejects their token. |
| **6** | Faculty ratio breach & Under-filled detection | Open `AICTE Officer` > `Compliance Radar`. `National Institute of Applied Sciences (INST_UP_02)` shows in RED with `Ratio Breach (31.67:1 > 20:1)`. `Chennai Autonomous (INST_TN_05)` is flagged as `Under-filled (20.0% occupancy)`. |
| **7** | Ghost Student Detection | In `AICTE Officer` > `Compliance Radar`, view the `Ghost Student Anomaly Flags` panel. Enrolled student `Suresh Kumar` (100000000005) is flagged for 0 scans in confirmation window. |
| **8** | Scholarship Eligibility & Disbursal Gates | In Student > `Scholarship Schemes`: Priya Sharma qualifies for `Pragati Scholarship` and disburses. Rohan Verma (62.5% att) is blocked for `Minimum Attendance`. Ananya Deshmukh (₹12L) is blocked for `Annual Family Income`. Conflicting schemes are blocked. |
| **9** | Disbursal-time drift refusal | For an eligible student, click `[Demo 9] Drop Attendance to 50%` to simulate real-time drop after token issuance. Click `Claim Benefit Disbursal`: real-time gate re-evaluation immediately blocks payout! |
| **10** | Dispute Resolution & Tamper-Evident Trail | Go to `Tamper-Evident Audit Trail`. Click `Verify Audit Chain`: displays green `Chain Intact`. Click `Trigger Demo Tamper`: chain turns RED with exact tampered block ID and reason. Submit & resolve grievances under `Grievances`. |
