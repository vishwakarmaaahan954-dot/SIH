"""
Adversarial Challenger Test Suite - Milestone 1 Backend
Role: teamwork_challenger (Critic / Empirical Challenger)

Adversarial Coverage:
1. Malformed JSON payloads, non-existent APAAR IDs, non-existent Institute IDs on submission & status endpoints.
2. Concurrent / duplicate processing of already APPROVED or REJECTED admission requests (idempotency or clean 400 rejection).
3. Rejection action (`action: "REJECT"`): seat count preservation, student UNENROLLED preservation, request state REJECTED.
4. Cryptographic audit log chaining integrity: valid chained hashes for admission events, tamper detection.
"""

import json
import uuid
import hashlib
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
import pytest
from fastapi.testclient import TestClient
from main import DATABASE_PATH, app


def _get_db():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ===========================================================================
# 1. MALFORMED JSON, NON-EXISTENT APAAR IDs, NON-EXISTENT INSTITUTE IDs
# ===========================================================================

def test_fuzz_malformed_json_on_admission_submission(client: TestClient):
    """Test malformed JSON bodies and bad schemas on POST /admission/request and /enrollment/request."""
    endpoints = ["/admission/request", "/enrollment/request"]

    for ep in endpoints:
        # Case A: Syntactically broken raw JSON bytes
        res_raw = client.post(ep, content=b'{"apaar_id": "100000000008", broken_json', headers={"Content-Type": "application/json"})
        assert res_raw.status_code == 422, f"Expected 422 for malformed raw JSON on {ep}, got {res_raw.status_code}"

        # Case B: Empty JSON object
        res_empty = client.post(ep, json={})
        assert res_empty.status_code == 422, f"Expected 422 for empty dict on {ep}, got {res_empty.status_code}"

        # Case C: Missing required field institute_id
        res_missing_inst = client.post(ep, json={"apaar_id": "100000000008"})
        assert res_missing_inst.status_code == 422, f"Expected 422 for missing institute_id on {ep}, got {res_missing_inst.status_code}"

        # Case D: Missing required field apaar_id
        res_missing_apaar = client.post(ep, json={"institute_id": "INST_DEL_01"})
        assert res_missing_apaar.status_code == 422, f"Expected 422 for missing apaar_id on {ep}, got {res_missing_apaar.status_code}"

        # Case E: Incompatible field data types
        res_bad_types = client.post(ep, json={
            "apaar_id": 100000000008,  # int instead of str
            "institute_id": ["INST_DEL_01"],  # list instead of str
            "year": "first_year"  # str instead of int
        })
        assert res_bad_types.status_code == 422, f"Expected 422 for bad types on {ep}, got {res_bad_types.status_code}"

        # Case F: Non-dict payload (JSON array)
        res_array = client.post(ep, json=[{"apaar_id": "100000000008", "institute_id": "INST_DEL_01"}])
        assert res_array.status_code == 422, f"Expected 422 for list payload on {ep}, got {res_array.status_code}"

        # Case G: String primitive payload
        res_str = client.post(ep, json="not_an_object")
        assert res_str.status_code == 422, f"Expected 422 for string payload on {ep}, got {res_str.status_code}"


def test_fuzz_malformed_json_on_process_request(client: TestClient):
    """Test malformed JSON bodies on POST /admission/accept and /enrollment/process-request."""
    endpoints = ["/admission/accept", "/enrollment/process-request"]

    for ep in endpoints:
        # Case A: Broken raw JSON bytes
        res_raw = client.post(ep, content=b'{"request_id": "REQ_123", ', headers={"Content-Type": "application/json"})
        assert res_raw.status_code == 422, f"Expected 422 for broken raw JSON on {ep}, got {res_raw.status_code}"

        # Case B: Empty JSON object (missing request_id)
        res_empty = client.post(ep, json={})
        assert res_empty.status_code == 422, f"Expected 422 for empty dict on {ep}, got {res_empty.status_code}"

        # Case C: Array payload
        res_array = client.post(ep, json=[{"request_id": "REQ_123"}])
        assert res_array.status_code == 422, f"Expected 422 for array payload on {ep}, got {res_array.status_code}"


def test_fuzz_nonexistent_apaar_ids(client: TestClient):
    """Test non-existent APAAR IDs on status queries and admission submission."""
    non_existent_ids = [
        "999999999999",
        "000000000000",
        "NONEXISTENT",
        "100000000008' OR '1'='1",
        "../../../etc/passwd"
    ]

    for bad_id in non_existent_ids:
        # Status query
        res_status = client.get(f"/students/{bad_id}/status")
        assert res_status.status_code == 404, f"Expected 404 for student {bad_id} on /students/status, got {res_status.status_code}"

        # Status alias query
        res_alias = client.get(f"/students/{bad_id}/enrollment-status")
        assert res_alias.status_code == 404, f"Expected 404 for student {bad_id} on /students/enrollment-status, got {res_alias.status_code}"

        # Submission with non-existent student
        res_sub = client.post("/admission/request", json={
            "apaar_id": bad_id,
            "institute_id": "INST_DEL_01",
            "program": "B.Tech",
            "year": 1,
            "type": "join"
        })
        assert res_sub.status_code == 404, f"Expected 404 for submission with bad student {bad_id}, got {res_sub.status_code}: {res_sub.text}"
        assert "Student APAAR record not found" in res_sub.json().get("detail", "")


def test_fuzz_nonexistent_institute_ids(client: TestClient):
    """Test non-existent Institute IDs on seat queries, submission endpoints, and queue filters."""
    non_existent_insts = [
        "INST_DOES_NOT_EXIST",
        "INST_FAKE_999",
        "INST_DEL_01' OR '1'='1",
        "../../etc/passwd"
    ]

    for bad_inst in non_existent_insts:
        # Seats query
        res_seats = client.get(f"/institutions/{bad_inst}/seats")
        assert res_seats.status_code == 404, f"Expected 404 for institute seats query with {bad_inst}, got {res_seats.status_code}"

        # Submission to non-existent institute
        res_sub = client.post("/admission/request", json={
            "apaar_id": "100000000008",
            "institute_id": bad_inst,
            "program": "B.Tech",
            "year": 1,
            "type": "join"
        })
        assert res_sub.status_code == 404, f"Expected 404 for submission to bad institute {bad_inst}, got {res_sub.status_code}: {res_sub.text}"
        assert "Target institution not found" in res_sub.json().get("detail", "")

        # Target institute override non-existent
        res_sub_target = client.post("/admission/request", json={
            "apaar_id": "100000000008",
            "institute_id": "INST_DEL_01",
            "target_institute_id": bad_inst,
            "program": "B.Tech",
            "year": 1,
            "type": "join"
        })
        assert res_sub_target.status_code == 404, f"Expected 404 for submission with bad target_institute_id {bad_inst}, got {res_sub_target.status_code}"

        # Queue filter by non-existent institute returns empty list without error
        res_queue = client.get("/admission/requests", params={"institute_id": bad_inst})
        assert res_queue.status_code == 200
        assert res_queue.json() == []


def test_fuzz_nonexistent_request_ids_on_process(client: TestClient):
    """Test non-existent request IDs on approval and rejection."""
    bad_req_ids = [
        "REQ_DOES_NOT_EXIST",
        "REQ_FAKE_12345",
        "REQ_999' OR '1'='1"
    ]

    for bad_req in bad_req_ids:
        # Approve attempt
        res_app = client.post("/admission/accept", json={"request_id": bad_req, "action": "APPROVE"})
        assert res_app.status_code == 404, f"Expected 404 for approval of bad req {bad_req}, got {res_app.status_code}"

        # Reject attempt
        res_rej = client.post("/admission/accept", json={"request_id": bad_req, "action": "REJECT"})
        assert res_rej.status_code == 404, f"Expected 404 for rejection of bad req {bad_req}, got {res_rej.status_code}"


# ===========================================================================
# 2. CONCURRENT / DUPLICATE PROCESSING (IDEMPOTENCY & CLEAN 400)
# ===========================================================================

def test_duplicate_processing_sequential(client: TestClient):
    """Verify that already APPROVED or REJECTED requests are rejected with clean HTTP 400 on subsequent attempts."""
    # Test A: APPROVED request cannot be approved or rejected again
    sub1 = client.post("/admission/request", json={
        "apaar_id": "100000000008",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert sub1.status_code == 200
    req_id1 = sub1.json()["request_id"]

    # First approval -> 200
    app1 = client.post("/admission/accept", json={"request_id": req_id1, "action": "APPROVE"})
    assert app1.status_code == 200

    # Second approval -> 400
    dup_app = client.post("/admission/accept", json={"request_id": req_id1, "action": "APPROVE"})
    assert dup_app.status_code == 400, f"Expected 400 for duplicate approval, got {dup_app.status_code}: {dup_app.text}"
    assert "already processed with status APPROVED" in dup_app.json().get("detail", "")

    # Rejection of already approved request -> 400
    dup_rej = client.post("/admission/accept", json={"request_id": req_id1, "action": "REJECT"})
    assert dup_rej.status_code == 400, f"Expected 400 for reject on approved request, got {dup_rej.status_code}: {dup_rej.text}"
    assert "already processed with status APPROVED" in dup_rej.json().get("detail", "")

    # Test B: REJECTED request cannot be rejected or approved again
    sub2 = client.post("/admission/request", json={
        "apaar_id": "100000000009",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert sub2.status_code == 200
    req_id2 = sub2.json()["request_id"]

    # First rejection -> 200
    rej1 = client.post("/admission/accept", json={"request_id": req_id2, "action": "REJECT", "rejection_reason": "Test"})
    assert rej1.status_code == 200

    # Second rejection -> 400
    dup_rej2 = client.post("/admission/accept", json={"request_id": req_id2, "action": "REJECT"})
    assert dup_rej2.status_code == 400, f"Expected 400 for duplicate rejection, got {dup_rej2.status_code}: {dup_rej2.text}"
    assert "already processed with status REJECTED" in dup_rej2.json().get("detail", "")

    # Approval of already rejected request -> 400
    dup_app2 = client.post("/admission/accept", json={"request_id": req_id2, "action": "APPROVE"})
    assert dup_app2.status_code == 400, f"Expected 400 for approve on rejected request, got {dup_app2.status_code}: {dup_app2.text}"
    assert "already processed with status REJECTED" in dup_app2.json().get("detail", "")


def test_concurrent_duplicate_approvals_race_condition(client: TestClient):
    """Stress test: 10 parallel threads attempting to APPROVE the exact same request concurrently.
    Requirement: Exactly ONE thread succeeds with 200; all other threads receive clean 400 rejection.
    Empirical finding: Without database-level concurrency locking or atomic check, secondary threads
    trigger unhandled sqlite3.IntegrityError / HTTP 500 crashes instead of clean 400 rejection.
    """
    # 1. Setup pending request
    sub = client.post("/admission/request", json={
        "apaar_id": "100000000008",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert sub.status_code == 200
    req_id = sub.json()["request_id"]

    seats_before = client.get("/institutions/INST_DEL_01/seats").json()
    avail_before = seats_before["available_seats"]
    verified_before = seats_before["verified_students"]

    # 2. Fire 10 concurrent approval requests using raise_server_exceptions=False
    def do_approve():
        c = TestClient(app, raise_server_exceptions=False)
        return c.post("/admission/accept", json={"request_id": req_id, "action": "APPROVE"})

    workers = 10
    results = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(do_approve) for _ in range(workers)]
        for fut in as_completed(futures):
            results.append(fut.result())

    status_codes = [r.status_code for r in results]
    successes = [r for r in results if r.status_code == 200]
    clean_400_failures = [r for r in results if r.status_code in [400, 409]]
    server_error_500 = [r for r in results if r.status_code == 500]

    # Verify requirement: Exactly 1 success, and all 9 others must be clean 400/409 (not 500 crashes)
    assert len(successes) == 1, f"Expected 1 success out of {workers}, got {len(successes)}. Statuses: {status_codes}"
    assert len(server_error_500) == 0, f"Concurrency race caused unhandled HTTP 500 crash ({len(server_error_500)} requests crashed): {status_codes}"
    assert len(clean_400_failures) == workers - 1, f"Expected {workers - 1} clean 400 rejections, got {len(clean_400_failures)}"


def test_concurrent_approve_and_reject_race_condition(client: TestClient):
    """Stress test: 4 threads sending APPROVE and 4 threads sending REJECT concurrently for the same request.
    Requirement: Exactly ONE operation wins (200), all others receive clean 400/409 (no 500 crashes).
    """
    sub = client.post("/admission/request", json={
        "apaar_id": "100000000008",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    req_id = sub.json()["request_id"]

    def do_action(action: str):
        c = TestClient(app, raise_server_exceptions=False)
        return c.post("/admission/accept", json={
            "request_id": req_id,
            "action": action,
            "rejection_reason": "Race test rejection" if action == "REJECT" else None
        })

    tasks = ["APPROVE"] * 4 + ["REJECT"] * 4
    results = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(do_action, action) for action in tasks]
        for fut in as_completed(futures):
            results.append(fut.result())

    status_codes = [r.status_code for r in results]
    successes = [r for r in results if r.status_code == 200]
    server_errors = [r for r in results if r.status_code == 500]
    clean_rejections = [r for r in results if r.status_code in [400, 409]]

    assert len(successes) == 1, f"Expected exactly 1 winning response, got {len(successes)}. Statuses: {status_codes}"
    assert len(server_errors) == 0, f"Concurrency race caused unhandled HTTP 500 crashes: {status_codes}"
    assert len(clean_rejections) == 7, f"Expected 7 clean rejections, got {len(clean_rejections)}"


def test_concurrent_approvals_last_available_seat_exhaustion(client: TestClient):
    """Stress test: Institute has only 1 available seat left.
    Two different students (100000000008 and 100000000009) have submitted requests.
    Two threads concurrently attempt to approve both students.
    Requirement: Only ONE student can be approved. The second MUST be rejected with HTTP 400 (SEATS_FULL).
    Available seats MUST NOT become negative (-1), and verified_students MUST NOT exceed sanctioned_intake.
    """
    # 1. Artificially set INST_DEL_01 capacity to 1 available seat (intake 120, verified 119)
    conn = _get_db()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE capacity SET verified_students = 119, available_seats = 1 WHERE institute_id = 'INST_DEL_01' AND program = 'B.Tech'")
        conn.commit()
    finally:
        conn.close()

    seats_init = client.get("/institutions/INST_DEL_01/seats").json()
    assert seats_init["available_seats"] == 1
    assert seats_init["verified_students"] == 119

    # 2. Both students submit requests
    # Student 8:
    sub1 = client.post("/admission/request", json={
        "apaar_id": "100000000008",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert sub1.status_code == 200
    req_id1 = sub1.json()["request_id"]

    # Student 9:
    sub2 = client.post("/admission/request", json={
        "apaar_id": "100000000009",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert sub2.status_code == 200
    req_id2 = sub2.json()["request_id"]

    # 3. Concurrently approve both requests
    def approve_req(rid):
        c = TestClient(app, raise_server_exceptions=False)
        return c.post("/admission/accept", json={"request_id": rid, "action": "APPROVE"})

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(approve_req, req_id1)
        f2 = executor.submit(approve_req, req_id2)
        res1 = f1.result()
        res2 = f2.result()

    responses = [res1, res2]
    successes = [r for r in responses if r.status_code == 200]
    rejected = [r for r in responses if r.status_code == 400]

    assert len(successes) == 1, f"Expected exactly 1 student to get the last seat, got {len(successes)}: {[r.status_code for r in responses]}"
    assert len(rejected) == 1, f"Expected 1 student to be rejected with 400 (SEATS_FULL), got {len(rejected)}"

    # 4. Invariant: Available seats must be 0, never negative, verified_students must not exceed 120
    seats_final = client.get("/institutions/INST_DEL_01/seats").json()
    assert seats_final["available_seats"] == 0, f"Available seats must be 0, got {seats_final['available_seats']}"
    assert seats_final["verified_students"] == 120, f"Verified students must be 120, got {seats_final['verified_students']}"


# ===========================================================================
# 3. REJECTION ACTION (action: "REJECT") INVARIANTS & INTEGRITY
# ===========================================================================

def test_rejection_action_full_invariants(client: TestClient):
    """Verify that rejection action preserves seat count, student UNENROLLED status, marks request as REJECTED,
    and writes cryptographic audit log.
    """
    # 1. Record seats before
    seats_before = client.get("/institutions/INST_DEL_01/seats").json()
    avail_before = seats_before["available_seats"]
    verified_before = seats_before["verified_students"]

    # 2. Record student status before
    status_before = client.get("/students/100000000008/status").json()
    assert status_before["status"] == "UNENROLLED"
    assert status_before["is_eligible_for_admission"] is True
    assert status_before["institute_id"] is None

    # 3. Submit request
    sub_res = client.post("/admission/request", json={
        "apaar_id": "100000000008",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert sub_res.status_code == 200
    req_id = sub_res.json()["request_id"]

    # 4. Reject request with explicit reason
    reason_text = "Disqualification due to missing marksheet certification"
    rej_res = client.post("/admission/accept", json={
        "request_id": req_id,
        "action": "REJECT",
        "rejection_reason": reason_text
    })
    assert rej_res.status_code == 200, f"Expected 200 on rejection, got {rej_res.status_code}: {rej_res.text}"
    rej_data = rej_res.json()
    assert rej_data.get("status") == "REJECTED"
    assert "rejected" in rej_data.get("message", "").lower()

    # 5. Verify seat count preserved
    seats_after = client.get("/institutions/INST_DEL_01/seats").json()
    assert seats_after["available_seats"] == avail_before, f"Seats changed unexpectedly! Expected {avail_before}, got {seats_after['available_seats']}"
    assert seats_after["verified_students"] == verified_before, f"Verified count changed unexpectedly! Expected {verified_before}, got {seats_after['verified_students']}"

    # 6. Verify student status preserved as UNENROLLED
    status_after = client.get("/students/100000000008/status").json()
    assert status_after["status"] == "UNENROLLED", f"Student status mutated! Expected UNENROLLED, got {status_after['status']}"
    assert status_after["is_eligible_for_admission"] is True
    assert status_after["institute_id"] is None

    # 7. Verify DB state
    conn = _get_db()
    try:
        cur = conn.cursor()
        # Request state
        cur.execute("SELECT state FROM requests WHERE id = ?", (req_id,))
        assert cur.fetchone()["state"] == "REJECTED"

        # Student row
        cur.execute("SELECT enrollment_status, institute_id FROM students WHERE apaar_id = '100000000008'")
        st = cur.fetchone()
        assert st["enrollment_status"] == "UNENROLLED"
        assert st["institute_id"] is None

        # Enrollments table: NO active enrollment created
        cur.execute("SELECT COUNT(*) as cnt FROM enrollments WHERE apaar_id = '100000000008' AND status = 'ACTIVE'")
        assert cur.fetchone()["cnt"] == 0

        # Audit log event: Must exist and contain rejection reason
        cur.execute("SELECT * FROM audit_log WHERE action = 'REQUEST_REJECTED' AND record_id = ?", (req_id,))
        log = cur.fetchone()
        assert log is not None, "Defect: REQUEST_REJECTED event was not persisted to audit_log table due to uncommitted append_audit_event call!"
        payload = json.loads(log["payload"])
        assert payload.get("reason") == reason_text
    finally:
        conn.close()


def test_rejection_action_case_insensitivity_and_empty_reason(client: TestClient):
    """Verify rejection works with lowercase action ('reject') and empty rejection reason."""
    sub = client.post("/admission/request", json={
        "apaar_id": "100000000008",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    req_id = sub.json()["request_id"]

    rej = client.post("/admission/accept", json={
        "request_id": req_id,
        "action": "reject"
    })
    assert rej.status_code == 200
    assert rej.json().get("status") == "REJECTED"

    # Verify request state is REJECTED
    conn = _get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT state FROM requests WHERE id = ?", (req_id,))
        assert cur.fetchone()["state"] == "REJECTED"
    finally:
        conn.close()


# ===========================================================================
# 4. CRYPTOGRAPHIC AUDIT LOG CHAINING INTEGRITY
# ===========================================================================

def test_cryptographic_audit_chain_integrity_on_admission_flow(client: TestClient):
    """Verify cryptographic hash chaining across admission submission, approval, and rejection events."""
    # 1. Perform submission + approval
    sub1 = client.post("/admission/request", json={
        "apaar_id": "100000000008",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert sub1.status_code == 200
    req_id1 = sub1.json()["request_id"]

    app1 = client.post("/admission/accept", json={"request_id": req_id1, "action": "APPROVE"})
    assert app1.status_code == 200

    # 2. Perform submission + rejection
    sub2 = client.post("/admission/request", json={
        "apaar_id": "100000000009",
        "institute_id": "INST_DEL_01",
        "program": "B.Tech",
        "year": 1,
        "type": "join"
    })
    assert sub2.status_code == 200
    req_id2 = sub2.json()["request_id"]

    rej2 = client.post("/admission/accept", json={
        "request_id": req_id2,
        "action": "REJECT",
        "rejection_reason": "Audit verification test rejection"
    })
    assert rej2.status_code == 200

    # 3. Independent Cryptographic Chain Verification from Genesis to Tip
    conn = _get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM audit_log ORDER BY id ASC")
        logs = cur.fetchall()
        assert len(logs) >= 5, (
            f"Defect: Expected at least 5 audit logs (genesis + 2 submissions + 1 approval + 1 rejection), "
            f"but found only {len(logs)}. Admission audit logs are not being committed to database!"
        )

        prev_hash = "0000000000000000000000000000000000000000000000000000000000000000"
        actions_found = set()

        for idx, row in enumerate(logs):
            row_dict = dict(row)
            actions_found.add(row_dict["action"])

            # Verify previous hash link
            assert row_dict["prev_hash"] == prev_hash, (
                f"Broken prev_hash chain at log ID {row_dict['id']}: expected {prev_hash}, got {row_dict['prev_hash']}"
            )

            # Recompute expected SHA-256 hash
            raw_str = f"{prev_hash}{row_dict['payload']}"
            expected_hash = hashlib.sha256(raw_str.encode("utf-8")).hexdigest()

            # Verify current hash matches expected SHA-256
            assert row_dict["hash"] == expected_hash, (
                f"Hash mismatch at log ID {row_dict['id']}: expected {expected_hash}, got {row_dict['hash']}"
            )

            prev_hash = row_dict["hash"]

        # Verify admission events are present in the audit log
        assert "ENROLLMENT_REQUEST_JOIN" in actions_found, "Missing ENROLLMENT_REQUEST_JOIN event in audit log"
        assert "ENROLLMENT_ACTIVATED" in actions_found, "Missing ENROLLMENT_ACTIVATED event in audit log"
        assert "REQUEST_REJECTED" in actions_found, "Missing REQUEST_REJECTED event in audit log"
    finally:
        conn.close()

    # 4. Verify endpoint GET /audit/verify confirms INTACT status
    ver_res = client.get("/audit/verify")
    assert ver_res.status_code == 200
    assert ver_res.json()["status"] == "INTACT"
    assert ver_res.json()["total_records_verified"] == len(logs)


def test_cryptographic_audit_chain_tamper_detection(client: TestClient):
    """Verify that tampering with any historical audit log payload is immediately caught as COMPROMISED."""
    # 1. Check clean baseline
    ver_baseline = client.get("/audit/verify").json()
    assert ver_baseline["status"] == "INTACT"

    # 2. Inject tamper directly into a historical audit record
    conn = _get_db()
    tampered_id = None
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, payload FROM audit_log ORDER BY id DESC LIMIT 1")
        row = cur.fetchone()
        assert row is not None
        tampered_id = row["id"]
        tampered_payload = json.dumps({"tampered": True, "fake_field": "unauthorized"}, sort_keys=True)
        cur.execute("UPDATE audit_log SET payload = ? WHERE id = ?", (tampered_payload, tampered_id))
        conn.commit()
    finally:
        conn.close()

    # 3. Call GET /audit/verify
    ver_tampered = client.get("/audit/verify").json()
    assert ver_tampered["status"] == "COMPROMISED", f"Tampering was not detected! Output: {ver_tampered}"
    assert ver_tampered.get("failed_at_id") == tampered_id
    assert "mismatch" in ver_tampered.get("reason", "").lower() or "tampering" in ver_tampered.get("reason", "").lower()
