# Project: SIH Student Admission & Institute Seat Capacity System

## Architecture
- **Backend**: FastAPI (`backend/main.py`), SQLite 3 (`backend/apaar_verify.db`), Seeder (`backend/seed.py`).
  - Models: `students`, `institutions`, `capacity`, `enrollments`, `requests`, `audit_log`.
  - Service logic: Admission eligibility validation, capacity checks, atomic SQLite transactions for acceptance (seat decrement, enrollment status to ACTIVE, student affiliation update).
- **Frontend**: React 19 + Vite 8 SPA (`frontend/src/App.jsx`, `frontend/src/services/`).
  - Navigation: Persona-aware sidebar rendering in `SidebarContent`.
  - Student Interface: Conditional rendering of admission request menu and form based on `status === 'UNENROLLED'`; real-time institute seat checking with full-seat warning alerts.
  - Institute Interface: Incoming requests queue table with institutional capacity header; disabled "Accept & Verify" button when available empty seats = 0.
- **Verification Suite**:
  - Backend API Tests: `pytest` + FastAPI `TestClient` in `backend/tests/test_admission_suite.py`.
  - Frontend Component/Flow Tests: `vitest` + `@testing-library/react` + `jsdom` in `frontend/src/__tests__/admission.test.jsx`.
  - Unified Runner: Root `package.json` with `npm test`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Student Enrollment Status API & Schema | Add `enrollment_status` & `institute_id` columns, implement `GET /students/{apaar_id}/status` | M1 (Backend) | R1, R3 |
| 2 | Institute Seat Availability API & Schema | Add `available_seats` to capacity, implement `GET /institutions/{institute_id}/seats` & enriched `/institutions` | M1 (Backend) | R1, R2, R3 |
| 3 | Admission Request Submission Endpoint | Validate UNENROLLED status and seat capacity before creating request | M1 (Backend) | R1, R3 |
| 4 | Institute Queue Listing Endpoint | List pending requests with student details and institute capacity | M1 (Backend) | R2, R3 |
| 5 | Admission Acceptance & Atomic Mutation | Enforce available seats > 0, decrement seats, set student ACTIVE, update affiliation | M1 (Backend) | R2, R3 |
| 6 | Students Menu Eligibility Filtering | Hide admission tab/interface for ACTIVE/FLAGGED; show only for UNENROLLED | M2 (Frontend) | R1 |
| 7 | Student Full-Seat Warning & Submission Guard | Show alert when institute seats == 0 and disable submission | M2 (Frontend) | R1 |
| 8 | Institute Queue & Seat-Disabled Accept Button | Show capacity header, disable "Accept & Verify" when empty seats == 0 | M2 (Frontend) | R2 |
| 9 | Backend Automated Verification Suite | Comprehensive pytest suite verifying all API gates and state transitions | E2E Testing Track / M3 | R4 |
| 10 | Frontend Automated Verification Suite | Vitest suite verifying UI visibility, alerts, queue, and disabled accept button | E2E Testing Track / M3 | R4 |
| 11 | Unified Test Runner & Integration | Root `npm test` running full verification suite | E2E Testing Track / M3 | R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Backend Data Models, Capacity & API Endpoints | Implement SQLite schema updates (`enrollment_status`, `institute_id`, `available_seats`), seed deterministic personas (`INST_FULL_06`), endpoints `/students/{id}/status`, `/institutions/{id}/seats`, `/admission/request` (or enhanced `/enrollment/request`), `/admission/requests` (or `/enrollment/requests`), and atomic acceptance `/admission/accept` (or `/enrollment/process-request`). | none | DONE |
| M2 | Frontend Students Menu & Institute Interface | Update `SidebarContent` to hide admission tab for non-UNENROLLED, update admission view to alert on 0 seats, add capacity overview to institute requests, and disable "Accept & Verify" when empty seats == 0. | M1 contracts | DONE |
| M3 | Final Milestone: E2E Verification & Hardening | Phase 1: Verify 100% pass on E2E test suite (Tiers 1-4). Phase 2: Tier 5 adversarial coverage hardening. | M1, M2, E2E Testing Track | DONE |

## Parallel Track: E2E Testing Track
- **Owner**: E2E Testing Orchestrator
- **Scope**: Build opaque-box test infrastructure and comprehensive test suite across Tiers 1-4 for R1-R4, publish `TEST_INFRA.md` and `TEST_READY.md`.

## Interface Contracts

### 1. `GET /students/{apaar_id}/status`
- **Request**: Path param `apaar_id: str`
- **Response (200 OK)**:
  ```json
  {
    "apaar_id": "100000000008",
    "name": "Student Test 08",
    "enrollment_status": "UNENROLLED",
    "status": "UNENROLLED",
    "is_eligible_for_admission": true,
    "institute_id": null,
    "institute_name": null,
    "message": "Student is unenrolled and eligible to submit admission requests."
  }
  ```

### 2. `GET /institutions/{institute_id}/seats`
- **Request**: Path param `institute_id: str`, query `program: Optional[str] = 'B.Tech'`
- **Response (200 OK)**:
  ```json
  {
    "institute_id": "INST_DEL_01",
    "institute_name": "Delhi Engineering & Technology Institute",
    "program": "B.Tech",
    "academic_year": "2026-27",
    "sanctioned_intake": 120,
    "verified_students": 118,
    "available_seats": 2,
    "empty_seats": 2,
    "is_full": false
  }
  ```

### 3. `POST /enrollment/request` (or `POST /admission/request`)
- **Request (JSON)**:
  ```json
  {
    "apaar_id": "100000000008",
    "institute_id": "INST_DEL_01",
    "program": "B.Tech",
    "year": 1,
    "type": "join"
  }
  ```
- **Validation**:
  - If student `enrollment_status != 'UNENROLLED'` -> HTTP 400 (`"INELIGIBLE_FOR_ADMISSION"`)
  - If institute `available_seats <= 0` -> HTTP 400 (`"SEATS_FULL"`)
- **Response (200 OK)**:
  ```json
  {
    "status": "SUCCESS",
    "request_id": "REQ_...",
    "state": "SUBMITTED",
    "message": "Admission request submitted and sent to institute queue."
  }
  ```

### 4. `GET /enrollment/requests` (or `GET /admission/requests`)
- **Request**: Query `institute_id: Optional[str]`, `state: Optional[str]`
- **Response (200 OK)**:
  ```json
  [
    {
      "id": "REQ_...",
      "apaar_id": "100000000008",
      "student_name": "Student Test 08",
      "type": "join",
      "program": "B.Tech",
      "year": 1,
      "state": "SUBMITTED",
      "institute_id": "INST_DEL_01",
      "institute_name": "Delhi Engineering & Technology Institute",
      "institute_available_seats": 2,
      "can_accept": true,
      "created_at": "2026-10-28T..."
    }
  ]
  ```

### 5. `POST /enrollment/process-request` (or `POST /admission/accept`)
- **Request (JSON)**:
  ```json
  {
    "request_id": "REQ_...",
    "action": "APPROVE"
  }
  ```
- **Validation**:
  - If target institute `available_seats <= 0` -> HTTP 400 (`"SEATS_FULL"`)
- **State Mutations (Atomic Transaction)**:
  - `capacity.verified_students += 1`, `capacity.available_seats = MAX(0, available_seats - 1)`
  - `students.enrollment_status = 'ACTIVE'`, `students.institute_id = :target_institute`
  - `enrollments.status = 'ACTIVE'` (inserted)
  - `requests.state = 'APPROVED'`
  - Append to `audit_log`
- **Response (200 OK)**:
  ```json
  {
    "status": "APPROVED",
    "message": "Admission request accepted successfully. Student enrollment is now ACTIVE and institute affiliation updated.",
    "enrollment_id": "ENR_...",
    "student_status": "ACTIVE",
    "affiliated_institute_id": "INST_DEL_01",
    "remaining_available_seats": 1,
    "verified_students_count": 119
  }
  ```

## Code Layout
- Backend Source: `backend/main.py`, `backend/seed.py`, `backend/requirements.txt`
- Backend Tests: `backend/tests/test_admission_suite.py`, `backend/tests/conftest.py`, `backend/test_scenarios.py`
- Frontend Source: `frontend/src/App.jsx`, `frontend/src/services/studentService.js`, `frontend/src/services/instituteService.js`, `frontend/src/services/enrollmentService.js`
- Frontend Tests: `frontend/src/__tests__/admission.test.jsx`, `frontend/vitest.config.js`, `frontend/src/setupTests.js`
- Root Config: `package.json`
