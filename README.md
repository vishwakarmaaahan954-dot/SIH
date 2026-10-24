# APAAR Verify: AICTE Student Data Management & Verification Platform
**Smart India Hackathon (SIH 2026) Prototype**

> **Problem Statement:** *Development of an APAAR ID-Based Student Data Management and Verification Platform for AICTE-Approved Institutions*

---

## 🏛️ 1. Architecture Overview
**APAAR Verify** acts as a compliance and verification layer sitting on top of APAAR, Academic Bank of Credits (ABC), DigiLocker, and AICTE approval engines. It is **not** a duplicate database of students, but an authoritative state machine and verification gatekeeper.

```
       ┌───────────────────────────────┐
       │   Student / Institute / AICTE │
       │    React + Tailwind Frontend  │
       └───────────────┬───────────────┘
                       │ REST APIs
       ┌───────────────▼───────────────┐
       │      FastAPI Backend Core     │
       │  (Rules Engine, QR & Crypto)  │
       └───┬───────────┬───────────┬───┘
           │           │           │
 ┌─────────▼──┐  ┌─────▼─────┐  ┌──▼──────────┐
 │ Mock APAAR │  │ Mock ABC  │  │ DigiLocker  │
 │  Gateway   │  │  Ledger   │  │ Credentials │
 └────────────┘  └───────────┘  └─────────────┘
```

### Key Pillars:
1. **Paperless Zero-Upload Compliance:** Demographic and prior qualifications arrive via consent-gated mock adapters (APAAR, ABC, DigiLocker, NSP).
2. **AICTE Sanctioned Intake & Ratio Enforcement:** Hard cap on verified admissions + real-time faculty-student ratio gate on every admission.
3. **NEP 2020 Multi-Entry & Exit Support:** Automated verification for diploma lateral entry, transfer NOCs with credit carryover, and award certificates.
4. **Rotating HMAC-SHA256 Single-Use QR Attendance:** Personal rotating QR code updated every 30 seconds, unlocked only upon active institute acceptance.
5. **Dynamic Scholarship Disbursal Gate:** Multi-rule validation (APAAR KYC, attendance cutoff, family income, host institute compliance, scheme exclusivity) with disbursal-time drift re-checks.
6. **Tamper-Evident SHA-256 Audit Trail:** Blockchain-like hash linkage (`hash = SHA256(prev_hash + payload)`) across all lifecycle transitions with 1-click audit integrity validation.

---

## 🚀 2. Quickstart & Running Instructions

### Backend (FastAPI)
The backend requires Python 3.10+ and the packages installed in the local environment:
```bash
cd backend
python3 -m uvicorn main:app --reload --port 8000
```
- API Docs & Swagger UI: [http://localhost:8000/docs](http://localhost:8000/docs)
- Reset/Seed Database:
  ```bash
  python3 seed.py
  ```

### Frontend (React + Vite + Tailwind)
```bash
cd frontend
npm run dev
```
- Live Web Application: [http://localhost:5173/](http://localhost:5173/)

### Automated Scenario Test Suite
Run the full 10-scenario regression test:
```bash
cd backend
python3 test_scenarios.py
```

---

## 🧪 3. Walkthrough of the 10 Demonstration Scenarios

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

