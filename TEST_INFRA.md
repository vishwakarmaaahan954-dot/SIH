# Testing Infrastructure Architecture (SIH / APAAR Verify)

## Overview
This document defines the complete testing infrastructure established for the SIH APAAR Verification and Institutional Admission system, fulfilling **Requirement R4** from `ORIGINAL_REQUEST.md`.

The testing infrastructure operates on a hermetic, multi-tiered architecture enabling end-to-end and component-level verification across both backend and frontend subsystems without relying on external cloud services.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       AUTOMATED VERIFICATION SUITE                          │
├──────────────────────────────────────┬──────────────────────────────────────┤
│               TIER 1                 │                TIER 2                │
│       Backend API Test Suite         │    Frontend Component & Logic Suite  │
│      (pytest + FastAPI TestClient)   │    (vitest + React Testing Library)  │
│   backend/tests/test_admission_suite.py  frontend/src/__tests__/admission.test.jsx
├──────────────────────────────────────┴──────────────────────────────────────┤
│                               TIER 3                                        │
│               Unified Root Test Runner (`npm test`)                         │
│       Root package.json -> runs Tier 1 (pytest) and Tier 2 (vitest)         │
├─────────────────────────────────────────────────────────────────────────────┤
│                               TIER 4                                        │
│               Legacy Demo Scenarios Verification                            │
│                 `npm run test:e2e` (test_scenarios.py)                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Subsystem Configurations

### 1.1 Backend Test Infrastructure
- **Engine**: `pytest 9.2.0` (in `backend/.venv`)
- **HTTP Client**: FastAPI `TestClient` (backed by `httpx 0.28.1`)
- **Database Engine**: Local SQLite 3 (`backend/apaar_verify.db`)
- **Isolation Strategy**: Autouse pytest fixture `reset_database` in `backend/tests/conftest.py` calls `init_db()` and `seed.seed_master_data()` before every test function, ensuring complete state isolation.
- **Test File**: `backend/tests/test_admission_suite.py`
- **Configuration File**: `backend/tests/conftest.py`

### 1.2 Frontend Test Infrastructure
- **Engine**: `vitest 5.0.5` (in `frontend/package.json`)
- **DOM Environment**: `jsdom 30.1.3`
- **Testing Library**: `@testing-library/react 16.3.3` + `@testing-library/jest-dom 7.0.1`
- **Configuration File**: `frontend/vitest.config.js`
- **Setup & Matchers File**: `frontend/src/setupTests.js` (configures jest-dom vitest matchers, `window.alert`, `ResizeObserver`, `IntersectionObserver`, and `navigator.mediaDevices` mocks)
- **Test File**: `frontend/src/__tests__/admission.test.jsx`

### 1.3 Unified Workspace Test Runner
Root `package.json` contains unified runners:
```json
{
  "scripts": {
    "test": "npm run test:backend && npm run test:frontend",
    "test:backend": "cd backend && .venv/bin/pytest tests/ -v",
    "test:frontend": "npm run test --prefix frontend",
    "test:e2e": "cd backend && .venv/bin/python3 test_scenarios.py"
  }
}
```

---

## 2. Test Execution Commands

| Target | Command | Description |
|---|---|---|
| **Full Suite** | `npm test` | Runs both Backend API test suite and Frontend component test suite sequentially. |
| **Backend Only** | `npm run test:backend` | Executes pytest against `backend/tests/test_admission_suite.py` with verbose output. |
| **Frontend Only** | `npm run test:frontend` | Executes vitest against `frontend/src/__tests__/admission.test.jsx`. |
| **Direct Backend Pytest** | `./backend/.venv/bin/pytest backend/tests/ -v` | Direct virtual environment invocation of backend tests. |
| **Direct Frontend Vitest** | `cd frontend && npx vitest run` | Direct invocation of frontend tests. |
| **E2E Demo Scenarios** | `npm run test:e2e` | Executes the 10 legacy demonstration scenarios via `test_scenarios.py`. |

---

## 3. Test Isolation & Determinism
1. **Zero External Network Dependencies**: All tests run locally against the embedded SQLite database and mocked services; no active Supabase connection or internet access is required.
2. **Deterministic Personas**: Tests exercise deterministic personas specified in `PROJECT.md`:
   - `100000000008` (Student Test 08): Unenrolled fresh applicant.
   - `100000000001` (Priya Sharma): Active student at `INST_DEL_01`.
   - `100000000888` (Aarav Gupta): Flagged student.
   - `INST_DEL_01`: Institute with available seats (`sanctioned_intake=120, verified=118, available=2`).
   - `INST_FULL_06`: Institute at full capacity (`sanctioned_intake=50, verified=50, available=0`).

---

## 4. Discovered Implementation Defects (Escalation)
During infrastructure validation, the following defect was identified in implementation source code:
- **`frontend/src/App.jsx:577, 595`**: Calls `setIsLoadingProfile(true)` and `setIsLoadingProfile(false)`, but `isLoadingProfile` state is undeclared in `App.jsx`, triggering `ReferenceError: setIsLoadingProfile is not defined`.
- **Interim Test Harness Remediation**: Added `globalThis.setIsLoadingProfile = vi.fn();` in `frontend/src/setupTests.js` so test execution can proceed cleanly.
- **Required Fix for M2 Frontend Worker**: Add `const [isLoadingProfile, setIsLoadingProfile] = useState(false);` to `App.jsx`.
