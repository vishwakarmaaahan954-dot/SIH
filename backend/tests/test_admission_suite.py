"""
Backend Automated Test Suite for Student Admission & Institute Seat Capacity Workflow
Covers Requirements R1, R2, R3, R4 as specified in ORIGINAL_REQUEST.md & PROJECT.md.

Test Inventory:
- BE-01: Status check for UNENROLLED student returns status=UNENROLLED, is_eligible_for_admission=True, institute_id=None.
- BE-02: Status check for ACTIVE student returns status=ACTIVE, is_eligible_for_admission=False, institute_id set.
- BE-03: Status check for FLAGGED student returns status=FLAGGED, is_eligible_for_admission=False.
- BE-04: Institute seat availability query for institute with open seats returns available_seats > 0, is_full=False.
- BE-05: Institute seat availability query for full institute (INST_FULL_06 or 0 available seats) returns available_seats=0, is_full=True.
- BE-06: Valid admission request submission by UNENROLLED student to institute with available seats succeeds (state=SUBMITTED).
- BE-07: Admission request submission to full institute (0 available seats) is rejected with HTTP 400.
- BE-08: Admission request submission by ineligible student (ACTIVE or FLAGGED) is rejected with HTTP 400/403.
- BE-09: Institute request queue lists pending admission requests for that institute.
- BE-10: Accepting admission request when available seats > 0 succeeds, decrements available_seats by 1, sets student enrollment_status to ACTIVE, sets student affiliated institute_id to the accepting institute, and creates ACTIVE enrollment.
- BE-11: Accepting admission request when institute has 0 available seats is rejected with HTTP 400 and state remains unapproved.
- BE-12: Non-existent student APAAR ID returns HTTP 404 on status query.
- BE-13: Non-existent institute ID returns HTTP 404 on seats query.
- BE-14: Rejecting an admission request updates state to REJECTED and preserves institute seats and student status.
- BE-15: Attempting to accept an already processed request returns HTTP 400.
"""

import uuid
import sqlite3
import pytest
from fastapi.testclient import TestClient
from main import DATABASE_PATH


def _get_db():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _get_student_status(client: TestClient, apaar_id: str):
    """Helper to query student status supporting primary and alias routes."""
    res = client.get(f"/students/{apaar_id}/status")
    if res.status_code == 404:
        # Fallback check for alias
        res = client.get(f"/students/{apaar_id}/enrollment-status")
    return res


def _get_institute_seats(client: TestClient, institute_id: str):
    """Helper to query institute seats."""
    return client.get(f"/institutions/{institute_id}/seats")


def _submit_request(client: TestClient, payload: dict):
    """Helper to submit request supporting /enrollment/request and /admission/request."""
    res = client.post("/enrollment/request", json=payload)
    if res.status_code == 404:
        res = client.post("/admission/request", json=payload)
    return res


def _list_requests(client: TestClient, params: dict = None):
    """Helper to list requests supporting /enrollment/requests and /admission/requests."""
    res = client.get("/enrollment/requests", params=params)
    if res.status_code == 404:
        res = client.get("/admission/requests", params=params)
    return res


def _process_request(client: TestClient, payload: dict):
    """Helper to process request supporting /enrollment/process-request and /admission/accept."""
    res = client.post("/enrollment/process-request", json=payload)
    if res.status_code == 404:
        res = client.post("/admission/accept", json=payload)
    return res


# ---------------------------------------------------------------------------
# BE-01: Status check for UNENROLLED student
# ---------------------------------------------------------------------------
def test_be01_check_enrollment_status_unenrolled(client: TestClient):
    """Status check for UNENROLLED student returns status=UNENROLLED, is_eligible_for_admission=True, institute_id=None."""
    res = _get_student_status(client, "100000000008")
    assert res.status_code == 200, f"Expected 200 but got {res.status_code}: {res.text}"
    data = res.json()
    status = data.get("enrollment_status") or data.get("status")
    assert status == "UNENROLLED", f"Expected status UNENROLLED, got {status}"
    assert data.get("is_eligible_for_admission") is True, f"Expected is_eligible_for_admission True, got {data.get('is_eligible_for_admission')}"
    assert data.get("institute_id") is None, f"Expected institute_id None, got {data.get('institute_id')}"
    assert data.get("apaar_id") == "100000000008"


# ---------------------------------------------------------------------------
# BE-02: Status check for ACTIVE student
# ---------------------------------------------------------------------------
def test_be02_check_enrollment_status_active(client: TestClient):
    """Status check for ACTIVE student returns status=ACTIVE, is_eligible_for_admission=False, institute_id set."""
    res = _get_student_status(client, "100000000001")
    assert res.status_code == 200, f"Expected 200 but got {res.status_code}: {res.text}"
    data = res.json()
    status = data.get("enrollment_status") or data.get("status")
    assert status == "ACTIVE", f"Expected status ACTIVE, got {status}"
    assert data.get("is_eligible_for_admission") is False, f"Expected is_eligible_for_admission False, got {data.get('is_eligible_for_admission')}"
    assert data.get("institute_id") == "INST_DEL_01", f"Expected institute_id INST_DEL_01, got {data.get('institute_id')}"


# ---------------------------------------------------------------------------
# BE-03: Status check for FLAGGED student
# ---------------------------------------------------------------------------
def test_be03_check_enrollment_status_flagged(client: TestClient):
    """Status check for FLAGGED student returns status=FLAGGED, is_eligible_for_admission=False."""
    res = _get_student_status(client, "100000000888")
    assert res.status_code == 200, f"Expected 200 but got {res.status_code}: {res.text}"
    data = res.json()
    status = data.get("enrollment_status") or data.get("status")
    assert status == "FLAGGED", f"Expected status FLAGGED, got {status}"
    assert data.get("is_eligible_for_admission") is False, f"Expected is_eligible_for_admission False, got {data.get('is_eligible_for_admission')}"


# ---------------------------------------------------------------------------
# BE-04: Institute seat availability query for open institute
# ---------------------------------------------------------------------------
def test_be04_query_institute_seats_available(client: TestClient):
    """Institute seat availability query for institute with open seats returns available_seats > 0, is_full=False."""
    res = _get_institute_seats(client, "INST_DEL_01")
    assert res.status_code == 200, f"Expected 200 but got {res.status_code}: {res.text}"
    data = res.json()
    assert data.get("institute_id") == "INST_DEL_01"
    available = data.get("available_seats") if "available_seats" in data else data.get("empty_seats")
    assert available is not None and available > 0, f"Expected available_seats > 0, got {available}"
    assert data.get("is_full") is False, f"Expected is_full False, got {data.get('is_full')}"
    assert data.get("sanctioned_intake", 0) >= data.get("verified_students", 0)


# ---------------------------------------------------------------------------
# BE-05: Institute seat availability query for full institute
# ---------------------------------------------------------------------------
def test_be05_query_institute_seats_full(client: TestClient):
    """Institute seat availability query for full institute (INST_FULL_06 or 0 available seats) returns available_seats=0, is_full=True."""
    res = _get_institute_seats(client, "INST_FULL_06")
    assert res.status_code == 200, f"Expected 200 but got {res.status_code}: {res.text}"
    data = res.json()
    assert data.get("institute_id") == "INST_FULL_06"
    available = data.get("available_seats") if "available_seats" in data else data.get("empty_seats")
    assert available == 0, f"Expected available_seats == 0, got {available}"
    assert data.get("is_full") is True, f"Expected is_full True, got {data.get('is_full')}"


# ---------------------------------------------------------------------------
# BE-06: Valid admission request submission by UNENROLLED student
# ---------------------------------------------------------------------------
def test_be06_submit_admission_request_valid(client: TestClient):
    """Valid admission request submission by UNENROLLED student to institute with available seats succeeds (state=SUBMITTED)."""
    payload = {
        "apaar_id": "100000000008",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    }
    res = _submit_request(client, payload)
    assert res.status_code == 200, f"Expected 200 but got {res.status_code}: {res.text}"
    data = res.json()
    assert data.get("status") == "SUCCESS", f"Expected status SUCCESS, got {data.get('status')}"
    assert data.get("state") == "SUBMITTED", f"Expected state SUBMITTED, got {data.get('state')}"
    assert data.get("request_id") is not None, "Expected request_id to be generated"


# ---------------------------------------------------------------------------
# BE-07: Admission request submission to full institute rejected
# ---------------------------------------------------------------------------
def test_be07_submit_admission_request_full_seats_rejected(client: TestClient):
    """Admission request submission to full institute (0 available seats) is rejected with HTTP 400."""
    payload = {
        "apaar_id": "100000000008",
        "institute_id": "INST_FULL_06",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    }
    res = _submit_request(client, payload)
    assert res.status_code == 400, f"Expected 400 Bad Request for full institute, got {res.status_code}: {res.text}"
    detail = str(res.json()).upper()
    assert any(term in detail for term in ["SEAT", "FULL", "CAPACITY"]), f"Expected full seats explanation in error, got: {res.text}"


# ---------------------------------------------------------------------------
# BE-08: Admission request submission by ineligible student rejected
# ---------------------------------------------------------------------------
def test_be08_submit_admission_request_ineligible_student(client: TestClient):
    """Admission request submission by ineligible student (ACTIVE or FLAGGED) is rejected with HTTP 400/403."""
    # Test 8a: ACTIVE student
    payload_active = {
        "apaar_id": "100000000001",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    }
    res_active = _submit_request(client, payload_active)
    assert res_active.status_code in [400, 403, 409], f"Expected 400/403/409 for ACTIVE student, got {res_active.status_code}: {res_active.text}"
    detail_active = str(res_active.json()).upper()
    assert any(term in detail_active for term in ["INELIGIBLE", "STATUS", "ACTIVE", "ENROLLED", "DUPLICATE"]), f"Unexpected error detail: {res_active.text}"

    # Test 8b: FLAGGED student
    payload_flagged = {
        "apaar_id": "100000000888",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    }
    res_flagged = _submit_request(client, payload_flagged)
    assert res_flagged.status_code in [400, 403], f"Expected 400/403 for FLAGGED student, got {res_flagged.status_code}: {res_flagged.text}"


# ---------------------------------------------------------------------------
# BE-09: Institute request queue lists pending admission requests
# ---------------------------------------------------------------------------
def test_be09_institute_request_queue_retrieval(client: TestClient):
    """Institute request queue lists pending admission requests for that institute."""
    # Submit a request for INST_DEL_01
    submit_res = _submit_request(client, {
        "apaar_id": "100000000008",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert submit_res.status_code == 200
    req_id = submit_res.json()["request_id"]

    # Query queue for INST_DEL_01
    queue_res = _list_requests(client, params={"institute_id": "INST_DEL_01"})
    assert queue_res.status_code == 200, f"Expected 200 for request queue, got {queue_res.status_code}"
    requests = queue_res.json()
    assert isinstance(requests, list)

    matching = [r for r in requests if (r.get("request_id") == req_id or r.get("id") == req_id)]
    assert len(matching) == 1, f"Expected request {req_id} to be in INST_DEL_01 queue, found: {matching}"
    req_data = matching[0]
    assert req_data.get("apaar_id") == "100000000008"
    assert req_data.get("state") == "SUBMITTED"

    # Query queue for a different institute (INST_KA_03) — should NOT contain this request
    other_queue = _list_requests(client, params={"institute_id": "INST_KA_03"})
    if other_queue.status_code == 200:
        other_requests = other_queue.json()
        assert not any(r.get("request_id") == req_id or r.get("id") == req_id for r in other_requests), "Request leaked into other institute's queue"


# ---------------------------------------------------------------------------
# BE-10: Accepting admission request when available seats > 0
# ---------------------------------------------------------------------------
def test_be10_accept_admission_success_and_state_mutation(client: TestClient):
    """Accepting admission request when available seats > 0 succeeds, decrements available_seats by 1,
    sets student enrollment_status to ACTIVE, sets student affiliated institute_id to the accepting institute,
    and creates ACTIVE enrollment."""
    # 1. Check initial seats for INST_DEL_01
    seats_before_res = _get_institute_seats(client, "INST_DEL_01")
    assert seats_before_res.status_code == 200
    seats_before = seats_before_res.json()
    initial_available = seats_before.get("available_seats", seats_before.get("empty_seats"))
    initial_verified = seats_before.get("verified_students")
    assert initial_available > 0, f"INST_DEL_01 must have available seats, got {initial_available}"

    # 2. Submit admission request
    submit_res = _submit_request(client, {
        "apaar_id": "100000000008",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert submit_res.status_code == 200
    req_id = submit_res.json()["request_id"]

    # 3. Accept admission request
    process_res = _process_request(client, {
        "request_id": req_id,
        "action": "APPROVE"
    })
    assert process_res.status_code == 200, f"Expected 200 on approval, got {process_res.status_code}: {process_res.text}"
    proc_data = process_res.json()
    assert proc_data.get("status") in ["APPROVED", "SUCCESS"], f"Expected APPROVED/SUCCESS, got {proc_data.get('status')}"

    # 4. Verify institute available seats decremented by 1, verified_students incremented by 1
    seats_after_res = _get_institute_seats(client, "INST_DEL_01")
    assert seats_after_res.status_code == 200
    seats_after = seats_after_res.json()
    after_available = seats_after.get("available_seats", seats_after.get("empty_seats"))
    after_verified = seats_after.get("verified_students")
    assert after_available == initial_available - 1, f"Expected available seats to decrement from {initial_available} to {initial_available - 1}, got {after_available}"
    assert after_verified == initial_verified + 1, f"Expected verified students to increment from {initial_verified} to {initial_verified + 1}, got {after_verified}"

    # 5. Verify student status is now ACTIVE and affiliated with INST_DEL_01
    status_res = _get_student_status(client, "100000000008")
    assert status_res.status_code == 200
    student_status = status_res.json()
    status_val = student_status.get("enrollment_status") or student_status.get("status")
    assert status_val == "ACTIVE", f"Expected student status to be ACTIVE, got {status_val}"
    assert student_status.get("institute_id") == "INST_DEL_01", f"Expected institute_id INST_DEL_01, got {student_status.get('institute_id')}"
    assert student_status.get("is_eligible_for_admission") is False, "Active student must not be eligible for new admission"

    # 6. Verify ACTIVE enrollment row exists in DB
    conn = _get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM enrollments WHERE apaar_id = '100000000008' AND status = 'ACTIVE'")
        enr = cur.fetchone()
        assert enr is not None, "Expected active enrollment row in database"
        assert enr["institute_id"] == "INST_DEL_01"
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# BE-11: Accepting admission request when institute has 0 available seats rejected
# ---------------------------------------------------------------------------
def test_be11_accept_admission_zero_seats_rejected(client: TestClient):
    """Accepting admission request when institute has 0 available seats is rejected with HTTP 400 and state remains unapproved."""
    # Directly inject a pending request for INST_FULL_06 (which has 0 seats) to simulate a queue item
    # whose target institute has 0 available seats at time of processing
    req_id = f"REQ_TEST_FULL_{uuid.uuid4().hex[:8]}"
    conn = _get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO requests (id, type, apaar_id, from_inst, to_inst, program, year, state, created_at)
               VALUES (?, 'join', '100000000008', 'INST_FULL_06', 'INST_FULL_06', 'B.Tech', 1, 'SUBMITTED', '2026-10-28T00:00:00Z')""",
            (req_id,)
        )
        conn.commit()
    finally:
        conn.close()

    # Attempt to APPROVE the request
    process_res = _process_request(client, {
        "request_id": req_id,
        "action": "APPROVE"
    })
    assert process_res.status_code == 400, f"Expected 400 Bad Request when accepting for 0-seat institute, got {process_res.status_code}: {process_res.text}"
    detail = str(process_res.json()).upper()
    assert any(term in detail for term in ["SEAT", "FULL", "CAPACITY", "INTAKE"]), f"Expected full capacity error, got {process_res.text}"

    # Verify request state remains SUBMITTED (not approved)
    conn = _get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT state FROM requests WHERE id = ?", (req_id,))
        row = cur.fetchone()
        assert row is not None
        assert row["state"] == "SUBMITTED", f"Expected state to remain SUBMITTED, got {row['state']}"

        # Verify student enrollment_status remains UNENROLLED
        cur.execute("SELECT enrollment_status, institute_id FROM students WHERE apaar_id = '100000000008'")
        st = cur.fetchone()
        assert st["enrollment_status"] == "UNENROLLED", f"Student enrollment_status mutated unexpectedly to {st['enrollment_status']}"
        assert st["institute_id"] is None, f"Student institute_id mutated unexpectedly to {st['institute_id']}"
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Adversarial & Boundary Edge Cases
# ---------------------------------------------------------------------------
def test_be12_get_student_status_nonexistent(client: TestClient):
    """Non-existent student APAAR ID returns HTTP 404."""
    res = _get_student_status(client, "999999999999")
    assert res.status_code == 404


def test_be13_get_institute_seats_nonexistent(client: TestClient):
    """Non-existent institute ID returns HTTP 404."""
    res = _get_institute_seats(client, "INST_NONEXISTENT_99")
    assert res.status_code == 404


def test_be14_reject_admission_request_preserves_seats_and_student_status(client: TestClient):
    """Rejecting an admission request updates state to REJECTED and preserves institute seats and student status."""
    # 1. Get initial seats
    seats_before = _get_institute_seats(client, "INST_DEL_01").json()
    avail_before = seats_before.get("available_seats", seats_before.get("empty_seats"))

    # 2. Submit request
    submit_res = _submit_request(client, {
        "apaar_id": "100000000008",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    req_id = submit_res.json()["request_id"]

    # 3. Reject request
    rej_res = _process_request(client, {
        "request_id": req_id,
        "action": "REJECT",
        "rejection_reason": "Incomplete documentation"
    })
    assert rej_res.status_code == 200
    assert rej_res.json().get("status") == "REJECTED"

    # 4. Verify seats did not change
    seats_after = _get_institute_seats(client, "INST_DEL_01").json()
    avail_after = seats_after.get("available_seats", seats_after.get("empty_seats"))
    assert avail_after == avail_before, f"Seats changed unexpectedly from {avail_before} to {avail_after}"

    # 5. Verify student status is still UNENROLLED
    st = _get_student_status(client, "100000000008").json()
    assert (st.get("enrollment_status") or st.get("status")) == "UNENROLLED"


def test_be15_process_already_processed_request_rejected(client: TestClient):
    """Attempting to process an already approved/rejected request returns HTTP 400."""
    # 1. Submit and approve
    submit_res = _submit_request(client, {
        "apaar_id": "100000000008",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    req_id = submit_res.json()["request_id"]
    _process_request(client, {"request_id": req_id, "action": "APPROVE"})

    # 2. Attempt to approve again
    dup_res = _process_request(client, {"request_id": req_id, "action": "APPROVE"})
    assert dup_res.status_code == 400, f"Expected 400 for duplicate approval, got {dup_res.status_code}"
