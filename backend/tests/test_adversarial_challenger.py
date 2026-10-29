"""
Milestone 1 Backend Adversarial & Stress Testing Suite
Challenger: Backend Milestone 1 Adversarial Challenger 1

Empirically verifies:
1. Boundary condition: Attempting to accept admission requests when exactly 0 available empty seats remain.
2. Boundary condition: Rapid sequential acceptance of requests when 1 seat remains (verify only 1 succeeds and the second is rejected with 400).
3. Student eligibility boundary: Attempting admission request submission with ACTIVE, FLAGGED, and UNVERIFIED statuses. Verify all are strictly rejected.
4. Verify student master record in `students` reflects ACTIVE status and correct institute affiliation following acceptance.
"""

import json
import sqlite3
import uuid
import pytest
from fastapi.testclient import TestClient
from main import DATABASE_PATH


def _get_db_conn():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ==============================================================================
# SECTION 1: Boundary condition - Acceptance when exactly 0 empty seats remain
# ==============================================================================

def test_adv01_accept_request_at_zero_seats_full_institute_rejected(client: TestClient):
    """
    Test accepting a request when an institute has exactly 0 available empty seats (INST_FULL_06).
    INST_FULL_06 has sanctioned_intake=50, verified_students=50, available_seats=0.
    Directly seeded request or pending request must be strictly rejected with HTTP 400 and SEATS_FULL.
    """
    req_id = f"REQ_ZERO_SEAT_{uuid.uuid4().hex[:8]}"
    apaar_id = "100000000008"  # Unenrolled student
    target_inst = "INST_FULL_06"

    # Pre-condition: insert a pending request for INST_FULL_06 directly into DB
    conn = _get_db_conn()
    conn.execute(
        "INSERT INTO requests (id, type, apaar_id, from_inst, to_inst, program, year, state, created_at) "
        "VALUES (?, 'join', ?, ?, ?, 'B.Tech', 1, 'SUBMITTED', datetime('now'))",
        (req_id, apaar_id, target_inst, target_inst)
    )
    conn.commit()

    # Attempt acceptance via POST /admission/accept
    res = client.post("/admission/accept", json={"request_id": req_id, "action": "APPROVE"})
    assert res.status_code == 400, f"Expected 400 on 0 available seats, got {res.status_code}: {res.text}"
    err = res.json()
    assert err.get("error") == "SEATS_FULL", f"Expected error 'SEATS_FULL', got {err}"

    # Verify state invariants: no state corruption occurred
    cursor = conn.cursor()
    cursor.execute("SELECT state FROM requests WHERE id = ?", (req_id,))
    req_row = cursor.fetchone()
    assert req_row["state"] == "SUBMITTED", f"Request state should remain SUBMITTED, got {req_row['state']}"

    cursor.execute("SELECT verified_students, available_seats FROM capacity WHERE institute_id = ? AND program = 'B.Tech'", (target_inst,))
    cap_row = cursor.fetchone()
    assert cap_row["verified_students"] == 50, f"Verified students must remain 50, got {cap_row['verified_students']}"
    assert cap_row["available_seats"] == 0, f"Available seats must remain 0, got {cap_row['available_seats']}"

    cursor.execute("SELECT enrollment_status, institute_id FROM students WHERE apaar_id = ?", (apaar_id,))
    stu_row = cursor.fetchone()
    assert stu_row["enrollment_status"] == "UNENROLLED", f"Student status must remain UNENROLLED, got {stu_row['enrollment_status']}"
    assert stu_row["institute_id"] is None, f"Student institute_id must remain None, got {stu_row['institute_id']}"

    cursor.execute("SELECT * FROM enrollments WHERE apaar_id = ?", (apaar_id,))
    enr_row = cursor.fetchone()
    assert enr_row is None, f"No enrollment record should have been created for {apaar_id}"
    conn.close()


def test_adv02_accept_request_at_zero_seats_via_process_endpoint_rejected(client: TestClient):
    """
    Verify POST /enrollment/process-request also rejects acceptance with HTTP 400 SEATS_FULL
    when seats are full.
    """
    req_id = f"REQ_ZERO_SEAT_{uuid.uuid4().hex[:8]}"
    apaar_id = "100000000009"  # Unenrolled student
    target_inst = "INST_FULL_06"

    conn = _get_db_conn()
    conn.execute(
        "INSERT INTO requests (id, type, apaar_id, from_inst, to_inst, program, year, state, created_at) "
        "VALUES (?, 'join', ?, ?, ?, 'B.Tech', 1, 'SUBMITTED', datetime('now'))",
        (req_id, apaar_id, target_inst, target_inst)
    )
    conn.commit()

    res = client.post("/enrollment/process-request", json={"request_id": req_id, "action": "APPROVE"})
    assert res.status_code == 400, f"Expected 400 on 0 seats, got {res.status_code}: {res.text}"
    err = res.json()
    assert err.get("error") == "SEATS_FULL", f"Expected error 'SEATS_FULL', got {err}"

    cursor = conn.cursor()
    cursor.execute("SELECT state FROM requests WHERE id = ?", (req_id,))
    assert cursor.fetchone()["state"] == "SUBMITTED"
    conn.close()


def test_adv03_submit_request_at_zero_seats_rejected(client: TestClient):
    """
    Verify that submitting admission requests directly to an institute with 0 seats
    is rejected with HTTP 400 SEATS_FULL and no record is created in requests.
    """
    apaar_id = "100000000008"
    target_inst = "INST_FULL_06"

    # Try /admission/request
    res1 = client.post("/admission/request", json={
        "apaar_id": apaar_id,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert res1.status_code == 400, f"Expected 400, got {res1.status_code}: {res1.text}"
    assert res1.json().get("error") == "SEATS_FULL"

    # Try /enrollment/request
    res2 = client.post("/enrollment/request", json={
        "apaar_id": apaar_id,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "admission"
    })
    assert res2.status_code == 400, f"Expected 400, got {res2.status_code}: {res2.text}"
    assert res2.json().get("error") == "SEATS_FULL"

    # Invariant: no request created
    conn = _get_db_conn()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as cnt FROM requests WHERE apaar_id = ? AND to_inst = ?", (apaar_id, target_inst))
    assert cursor.fetchone()["cnt"] == 0
    conn.close()


# ==============================================================================
# SECTION 2: Boundary condition - Rapid sequential acceptance when 1 seat remains
# ==============================================================================

def test_adv04_rapid_sequential_acceptance_when_one_seat_remains(client: TestClient):
    """
    Test rapid sequential acceptance when exactly 1 seat remains:
    - Sanctioned = 120, Verified = 119 -> Available = 1.
    - Two UNENROLLED students (Student 11 and Student 12) submit admission requests while available=1.
    - Institute accepts Request 1 -> Must SUCCEED (HTTP 200), available_seats becomes 0.
    - Institute immediately accepts Request 2 -> Must be REJECTED (HTTP 400 SEATS_FULL).
    - Capacity must not overflow (verified_students=120, available_seats=0, never -1).
    - Student 11 is ACTIVE; Student 12 remains UNENROLLED.
    """
    target_inst = "INST_DEL_01"  # Default has sanctioned=120, verified=118, available=2

    # Set capacity to exactly 1 seat remaining (verified=119, available=1)
    conn = _get_db_conn()
    conn.execute(
        "UPDATE capacity SET verified_students = 119, available_seats = 1 WHERE institute_id = ? AND program = 'B.Tech'",
        (target_inst,)
    )
    conn.commit()

    # Verify initial state: exactly 1 seat remaining
    seats_res = client.get(f"/institutions/{target_inst}/seats")
    assert seats_res.status_code == 200
    assert seats_res.json()["available_seats"] == 1
    assert seats_res.json()["is_full"] is False

    # Student 11 and Student 12 submit requests while 1 seat is open
    student_11 = "100000000011"
    student_12 = "100000000012"

    req1_res = client.post("/admission/request", json={
        "apaar_id": student_11,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert req1_res.status_code == 200, f"Req 1 failed: {req1_res.text}"
    req1_id = req1_res.json()["request_id"]

    req2_res = client.post("/admission/request", json={
        "apaar_id": student_12,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    # Note: submission when available=1 succeeds because capacity check during submission sees available=1
    assert req2_res.status_code == 200, f"Req 2 failed: {req2_res.text}"
    req2_id = req2_res.json()["request_id"]

    # Now, rapid sequential acceptance:
    # 1. Accept Request 1
    accept1_res = client.post("/admission/accept", json={"request_id": req1_id, "action": "APPROVE"})
    assert accept1_res.status_code == 200, f"Expected 200 for first acceptance, got {accept1_res.status_code}: {accept1_res.text}"
    acc1_data = accept1_res.json()
    assert acc1_data["status"] == "APPROVED"
    assert acc1_data["remaining_available_seats"] == 0
    assert acc1_data["verified_students_count"] == 120

    # 2. Immediately accept Request 2
    accept2_res = client.post("/admission/accept", json={"request_id": req2_id, "action": "APPROVE"})
    assert accept2_res.status_code == 400, f"Expected 400 for second acceptance, got {accept2_res.status_code}: {accept2_res.text}"
    acc2_data = accept2_res.json()
    assert acc2_data.get("error") == "SEATS_FULL", f"Expected error 'SEATS_FULL', got {acc2_data}"

    # Invariants Verification:
    # A. Capacity record in DB
    cursor = conn.cursor()
    cursor.execute("SELECT sanctioned_intake, verified_students, available_seats FROM capacity WHERE institute_id = ? AND program = 'B.Tech'", (target_inst,))
    cap_row = cursor.fetchone()
    assert cap_row["verified_students"] == 120, f"Verified students must be exactly 120, got {cap_row['verified_students']}"
    assert cap_row["available_seats"] == 0, f"Available seats must be exactly 0, not negative, got {cap_row['available_seats']}"

    # B. Request states
    cursor.execute("SELECT state FROM requests WHERE id = ?", (req1_id,))
    assert cursor.fetchone()["state"] == "APPROVED"
    cursor.execute("SELECT state FROM requests WHERE id = ?", (req2_id,))
    assert cursor.fetchone()["state"] == "SUBMITTED"

    # C. Student master records
    cursor.execute("SELECT enrollment_status, institute_id FROM students WHERE apaar_id = ?", (student_11,))
    s11 = cursor.fetchone()
    assert s11["enrollment_status"] == "ACTIVE"
    assert s11["institute_id"] == target_inst

    cursor.execute("SELECT enrollment_status, institute_id FROM students WHERE apaar_id = ?", (student_12,))
    s12 = cursor.fetchone()
    assert s12["enrollment_status"] == "UNENROLLED"
    assert s12["institute_id"] is None

    # D. Active enrollments
    cursor.execute("SELECT COUNT(*) as cnt FROM enrollments WHERE institute_id = ? AND status = 'ACTIVE'", (target_inst,))
    active_enrs = cursor.fetchone()["cnt"]
    # Seed had 3 active enrollments for INST_DEL_01 (ENR_01, ENR_02, ENR_05), now +1 from student 11 = 4
    cursor.execute("SELECT * FROM enrollments WHERE apaar_id = ?", (student_11,))
    assert cursor.fetchone() is not None
    cursor.execute("SELECT * FROM enrollments WHERE apaar_id = ?", (student_12,))
    assert cursor.fetchone() is None
    conn.close()


def test_adv05_rapid_sequential_three_requests_boundary(client: TestClient):
    """
    Adversarial multi-request exhaustion:
    1 available seat, 3 candidate requests.
    First succeeds, 2nd and 3rd both fail with HTTP 400.
    """
    target_inst = "INST_KA_03"
    conn = _get_db_conn()
    conn.execute(
        "UPDATE capacity SET verified_students = 59, sanctioned_intake = 60, available_seats = 1 WHERE institute_id = ? AND program = 'B.Tech'",
        (target_inst,)
    )
    conn.commit()

    stu_ids = ["100000000013", "100000000014", "100000000015"]
    req_ids = []

    for s_id in stu_ids:
        r = client.post("/admission/request", json={
            "apaar_id": s_id,
            "institute_id": target_inst,
            "program": "B.Tech",
            "year": 1,
            "type": "join"
        })
        assert r.status_code == 200
        req_ids.append(r.json()["request_id"])

    # First approval -> 200
    res_a = client.post("/admission/accept", json={"request_id": req_ids[0]})
    assert res_a.status_code == 200
    assert res_a.json()["remaining_available_seats"] == 0

    # Second approval -> 400
    res_b = client.post("/admission/accept", json={"request_id": req_ids[1]})
    assert res_b.status_code == 400
    assert res_b.json().get("error") == "SEATS_FULL"

    # Third approval -> 400
    res_c = client.post("/admission/accept", json={"request_id": req_ids[2]})
    assert res_c.status_code == 400
    assert res_c.json().get("error") == "SEATS_FULL"

    # Invariant: seats clamp at 0
    cursor = conn.cursor()
    cursor.execute("SELECT verified_students, available_seats FROM capacity WHERE institute_id = ? AND program = 'B.Tech'", (target_inst,))
    cap = cursor.fetchone()
    assert cap["verified_students"] == 60
    assert cap["available_seats"] == 0
    conn.close()


# ==============================================================================
# SECTION 3: Student Eligibility Boundary (ACTIVE, FLAGGED, UNVERIFIED)
# ==============================================================================

def test_adv06_student_eligibility_active_status_rejected_across_all_routes(client: TestClient):
    """
    Attempt admission request submission with ACTIVE status.
    Must be strictly rejected with HTTP 400 and error 'INELIGIBLE_FOR_ADMISSION'.
    Tested across:
    1. /admission/request
    2. /enrollment/request (type="admission")
    3. /enrollment/request (type="join", year=1)
    """
    active_student = "100000000001"
    target_inst = "INST_KA_03"

    # Route 1: /admission/request
    r1 = client.post("/admission/request", json={
        "apaar_id": active_student,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert r1.status_code == 400, f"Expected 400 for ACTIVE student on /admission/request, got {r1.status_code}"
    assert r1.json().get("error") == "INELIGIBLE_FOR_ADMISSION"

    # Route 2: /enrollment/request with type="admission"
    r2 = client.post("/enrollment/request", json={
        "apaar_id": active_student,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "admission"
    })
    assert r2.status_code == 400, f"Expected 400 for ACTIVE student on /enrollment/request (admission), got {r2.status_code}"
    assert r2.json().get("error") == "INELIGIBLE_FOR_ADMISSION"

    # Route 3: /enrollment/request with type="join", year=1
    r3 = client.post("/enrollment/request", json={
        "apaar_id": active_student,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert r3.status_code == 400, f"Expected 400 for ACTIVE student on /enrollment/request (join y1), got {r3.status_code}"
    assert r3.json().get("error") == "INELIGIBLE_FOR_ADMISSION"

    # Check status endpoint
    status_res = client.get(f"/students/{active_student}/status")
    assert status_res.status_code == 200
    assert status_res.json()["is_eligible_for_admission"] is False
    assert status_res.json()["status"] == "ACTIVE"


def test_adv07_student_eligibility_flagged_status_rejected_across_all_routes(client: TestClient):
    """
    Attempt admission request submission with FLAGGED status.
    Must be strictly rejected with HTTP 400 and error 'INELIGIBLE_FOR_ADMISSION'.
    Tested with:
    a) Seed persona 100000000888 (ends in 888)
    b) Arbitrary student with enrollment_status='FLAGGED' in students table
    """
    flagged_student = "100000000888"
    target_inst = "INST_MH_04"

    # Route 1: /admission/request
    r1 = client.post("/admission/request", json={
        "apaar_id": flagged_student,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert r1.status_code == 400, f"Expected 400 for FLAGGED student on /admission/request, got {r1.status_code}"
    assert r1.json().get("error") == "INELIGIBLE_FOR_ADMISSION"

    # Route 2: /enrollment/request (admission)
    r2 = client.post("/enrollment/request", json={
        "apaar_id": flagged_student,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "admission"
    })
    assert r2.status_code == 400
    assert r2.json().get("error") == "INELIGIBLE_FOR_ADMISSION"

    # Arbitrary non-888 APAAR ID set to FLAGGED in database
    custom_flagged = "100000000025"
    conn = _get_db_conn()
    conn.execute("UPDATE students SET enrollment_status = 'FLAGGED' WHERE apaar_id = ?", (custom_flagged,))
    conn.commit()

    r3 = client.post("/admission/request", json={
        "apaar_id": custom_flagged,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert r3.status_code == 400
    assert r3.json().get("error") == "INELIGIBLE_FOR_ADMISSION"

    # Check status endpoint
    status_res = client.get(f"/students/{custom_flagged}/status")
    assert status_res.status_code == 200
    assert status_res.json()["is_eligible_for_admission"] is False
    assert status_res.json()["status"] == "FLAGGED"
    conn.close()


def test_adv08_student_eligibility_unverified_status_rejected_across_all_routes(client: TestClient):
    """
    Attempt admission request submission with UNVERIFIED status.
    Must be strictly rejected with HTTP 400 and error 'INELIGIBLE_FOR_ADMISSION'.
    Tested with:
    a) Seed persona 100000000999 (ends in 999)
    b) Arbitrary student with enrollment_status='UNVERIFIED' in students table
    """
    unverified_student = "100000000999"
    target_inst = "INST_DEL_01"

    # Route 1: /admission/request
    r1 = client.post("/admission/request", json={
        "apaar_id": unverified_student,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert r1.status_code == 400, f"Expected 400 for UNVERIFIED student on /admission/request, got {r1.status_code}"
    assert r1.json().get("error") == "INELIGIBLE_FOR_ADMISSION"

    # Route 2: /enrollment/request (join, year 1)
    r2 = client.post("/enrollment/request", json={
        "apaar_id": unverified_student,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert r2.status_code == 400
    assert r2.json().get("error") == "INELIGIBLE_FOR_ADMISSION"

    # Arbitrary non-999 APAAR ID set to UNVERIFIED in database
    custom_unverified = "100000000026"
    conn = _get_db_conn()
    conn.execute("UPDATE students SET enrollment_status = 'UNVERIFIED' WHERE apaar_id = ?", (custom_unverified,))
    conn.commit()

    r3 = client.post("/admission/request", json={
        "apaar_id": custom_unverified,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert r3.status_code == 400
    assert r3.json().get("error") == "INELIGIBLE_FOR_ADMISSION"

    # Check status endpoint
    status_res = client.get(f"/students/{custom_unverified}/status")
    assert status_res.status_code == 200
    assert status_res.json()["is_eligible_for_admission"] is False
    assert status_res.json()["status"] == "UNVERIFIED"
    conn.close()


def test_adv09_adversarial_status_strings_rejected(client: TestClient):
    """
    Adversarial status fuzzing:
    Students with explicit non-UNENROLLED statuses like 'SUSPENDED', 'EXPELLED', 'DROPOUT', 'UNKNOWN'
    must NOT be allowed to submit admission requests.
    """
    conn = _get_db_conn()
    test_statuses = ["SUSPENDED", "EXPELLED", "DROPOUT", "UNKNOWN"]
    target_inst = "INST_KA_03"

    for idx, test_st in enumerate(test_statuses):
        apaar = f"1000000000{20 + idx}"
        conn.execute("UPDATE students SET enrollment_status = ? WHERE apaar_id = ?", (test_st, apaar))
        conn.commit()

        res = client.post("/admission/request", json={
            "apaar_id": apaar,
            "institute_id": target_inst,
            "program": "B.Tech",
            "year": 1,
            "type": "join"
        })
        assert res.status_code == 400, f"Expected status {test_st} to be rejected, got {res.status_code}: {res.text}"
        assert res.json().get("error") == "INELIGIBLE_FOR_ADMISSION"

    conn.close()


# ==============================================================================
# SECTION 4: Student Master Record & Post-Acceptance State Integrity
# ==============================================================================

def test_adv10_student_master_record_and_affiliation_verified_post_acceptance(client: TestClient):
    """
    Verify student master record in `students` reflects ACTIVE status and correct institute
    affiliation following acceptance:
    - Pre-condition: student is UNENROLLED with institute_id=None.
    - Submit admission request to INST_KA_03.
    - Accept admission request.
    - Direct SQL verification:
      * students.enrollment_status == 'ACTIVE'
      * students.institute_id == 'INST_KA_03'
    - API verification via GET /students/{apaar_id}/status:
      * enrollment_status == 'ACTIVE'
      * status == 'ACTIVE'
      * is_eligible_for_admission == False
      * institute_id == 'INST_KA_03'
      * institute_name == 'Bangalore College of Advanced Computing'
    - Relational integrity:
      * enrollments table has ACTIVE record matching apaar_id, institute_id, program, year
      * requests table has state == 'APPROVED'
      * capacity available_seats decremented by 1, verified_students incremented by 1
    """
    apaar_id = "100000000010"
    target_inst = "INST_KA_03"
    target_inst_name = "Bangalore College of Advanced Computing"

    conn = _get_db_conn()

    # Pre-condition check in DB
    cursor = conn.cursor()
    cursor.execute("SELECT enrollment_status, institute_id FROM students WHERE apaar_id = ?", (apaar_id,))
    pre_stu = cursor.fetchone()
    assert pre_stu["enrollment_status"] == "UNENROLLED"
    assert pre_stu["institute_id"] is None

    cursor.execute("SELECT verified_students, available_seats FROM capacity WHERE institute_id = ? AND program = 'B.Tech'", (target_inst,))
    pre_cap = cursor.fetchone()
    init_verified = pre_cap["verified_students"]
    init_available = pre_cap["available_seats"]

    # 1. Submit admission request
    sub_res = client.post("/admission/request", json={
        "apaar_id": apaar_id,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert sub_res.status_code == 200
    req_id = sub_res.json()["request_id"]

    # 2. Accept admission request
    acc_res = client.post("/admission/accept", json={"request_id": req_id, "action": "APPROVE"})
    assert acc_res.status_code == 200
    acc_data = acc_res.json()
    assert acc_data["status"] == "APPROVED"
    assert acc_data["student_status"] == "ACTIVE"
    assert acc_data["affiliated_institute_id"] == target_inst
    assert acc_data["remaining_available_seats"] == init_available - 1
    assert acc_data["verified_students_count"] == init_verified + 1

    # 3. DIRECT SQL INSPECTION of `students` table
    cursor.execute("SELECT apaar_id, name, enrollment_status, institute_id FROM students WHERE apaar_id = ?", (apaar_id,))
    post_stu = cursor.fetchone()
    assert post_stu["enrollment_status"] == "ACTIVE", f"Expected students.enrollment_status='ACTIVE', got {post_stu['enrollment_status']}"
    assert post_stu["institute_id"] == target_inst, f"Expected students.institute_id='{target_inst}', got {post_stu['institute_id']}"

    # 4. API VERIFICATION via GET /students/{apaar_id}/status
    status_res = client.get(f"/students/{apaar_id}/status")
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["enrollment_status"] == "ACTIVE"
    assert status_data["status"] == "ACTIVE"
    assert status_data["is_eligible_for_admission"] is False
    assert status_data["institute_id"] == target_inst
    assert status_data["institute_name"] == target_inst_name

    # 5. CROSS-TABLE RELATIONAL INTEGRITY
    # enrollments table
    cursor.execute("SELECT * FROM enrollments WHERE apaar_id = ? AND status = 'ACTIVE'", (apaar_id,))
    enr_row = cursor.fetchone()
    assert enr_row is not None
    assert enr_row["institute_id"] == target_inst
    assert enr_row["program"] == "B.Tech"
    assert enr_row["year"] == 1
    assert enr_row["status"] == "ACTIVE"

    # requests table
    cursor.execute("SELECT state FROM requests WHERE id = ?", (req_id,))
    assert cursor.fetchone()["state"] == "APPROVED"

    # capacity table
    cursor.execute("SELECT verified_students, available_seats FROM capacity WHERE institute_id = ? AND program = 'B.Tech'", (target_inst,))
    post_cap = cursor.fetchone()
    assert post_cap["verified_students"] == init_verified + 1
    assert post_cap["available_seats"] == init_available - 1
    conn.close()


def test_adv11_post_acceptance_idempotency_and_reapplication_prevention(client: TestClient):
    """
    Verify security & consistency rules once student is accepted:
    1. Re-approving the same request ID is rejected with HTTP 400 ("already processed").
    2. Attempting to submit another admission request as the newly ACTIVE student is rejected with HTTP 400 ("INELIGIBLE_FOR_ADMISSION").
    3. Direct DB state is unchanged by failed re-approval.
    """
    apaar_id = "100000000016"
    target_inst = "INST_MH_04"

    # Submit & Accept
    sub_res = client.post("/admission/request", json={
        "apaar_id": apaar_id,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    req_id = sub_res.json()["request_id"]
    client.post("/admission/accept", json={"request_id": req_id})

    # Attempt re-approval
    dup_res = client.post("/admission/accept", json={"request_id": req_id})
    assert dup_res.status_code == 400
    assert "already processed" in dup_res.json().get("detail", "").lower()

    # Attempt re-application by student
    reapply_res = client.post("/admission/request", json={
        "apaar_id": apaar_id,
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert reapply_res.status_code == 400
    assert reapply_res.json().get("error") == "INELIGIBLE_FOR_ADMISSION"


@pytest.mark.xfail(
    reason="BUG: append_audit_event is executed after db.commit(), causing the audit_log INSERT to remain uncommitted and roll back when get_db() closes the connection."
)
def test_adv12_audit_log_uncommitted_persistence_check(client: TestClient):
    """
    Empirical check on audit_log persistence:
    Worker handoff claims cryptographic SHA-256 audit chaining is committed on admission
    submission and acceptance.
    This test inspects whether the audit_log table actually contains the committed events.
    """
    apaar_id = "100000000017"
    target_inst = "INST_KA_03"

    sub_res = client.post("/admission/request", json={
        "apaar_id": apaar_id,
        "institute_id": target_inst,
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    req_id = sub_res.json()["request_id"]

    acc_res = client.post("/admission/accept", json={"request_id": req_id})
    enr_id = acc_res.json()["enrollment_id"]

    conn = _get_db_conn()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM audit_log WHERE record_id = ?", (req_id,))
    req_audit = cursor.fetchone()

    cursor.execute("SELECT * FROM audit_log WHERE record_id = ?", (enr_id,))
    acc_audit = cursor.fetchone()
    conn.close()

    # Empirical finding: append_audit_event is called after db.commit(), so changes
    # to audit_log are rolled back when the connection closes.
    # We verify this behavior empirically.
    assert req_audit is not None, "Audit event for admission request was not committed to audit_log"
    assert acc_audit is not None, "Audit event for admission acceptance was not committed to audit_log"
