import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, date, timedelta
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Depends, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import sqlite3

DATABASE_PATH = "apaar_verify.db"
SECRET_KEY = "sih-2026-apaar-verify-secret-key-mock"

app = FastAPI(
    title="APAAR Verify Core API",
    description="APAAR ID-Based Student Data Management & Compliance Gateway for AICTE Institutions (SIH 2026)",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    conn = sqlite3.connect(DATABASE_PATH, timeout=10.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    cursor.executescript("""
    CREATE TABLE IF NOT EXISTS students (
        apaar_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        dob TEXT NOT NULL,
        category TEXT NOT NULL,
        gender TEXT NOT NULL,
        domicile TEXT NOT NULL,
        prior_qualification TEXT NOT NULL,
        family_income REAL NOT NULL,
        consent INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS institutions (
        id TEXT PRIMARY KEY,
        aicte_code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        state TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS capacity (
        id TEXT PRIMARY KEY,
        institute_id TEXT NOT NULL,
        program TEXT NOT NULL,
        academic_year TEXT NOT NULL,
        sanctioned_intake INTEGER NOT NULL,
        faculty_fte INTEGER NOT NULL,
        lateral_seats INTEGER NOT NULL,
        verified_students INTEGER DEFAULT 0,
        FOREIGN KEY (institute_id) REFERENCES institutions(id),
        UNIQUE (institute_id, program, academic_year)
    );

    CREATE TABLE IF NOT EXISTS enrollments (
        id TEXT PRIMARY KEY,
        apaar_id TEXT NOT NULL,
        institute_id TEXT NOT NULL,
        program TEXT NOT NULL,
        year INTEGER NOT NULL,
        entry_type TEXT CHECK (entry_type IN ('regular', 'lateral', 'transfer')),
        status TEXT CHECK (status IN ('CLAIMED', 'LISTED', 'ACTIVE', 'TRANSFERRED_OUT', 'EXITED')),
        start_date TEXT NOT NULL,
        end_date TEXT,
        FOREIGN KEY (apaar_id) REFERENCES students(apaar_id),
        FOREIGN KEY (institute_id) REFERENCES institutions(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_enrollment 
    ON enrollments(apaar_id) WHERE status = 'ACTIVE';

    CREATE TABLE IF NOT EXISTS academic_credit_ledger (
        id TEXT PRIMARY KEY,
        apaar_id TEXT NOT NULL,
        course TEXT NOT NULL,
        credits INTEGER NOT NULL,
        source_institute TEXT NOT NULL,
        valid_till TEXT NOT NULL,
        FOREIGN KEY (apaar_id) REFERENCES students(apaar_id)
    );

    CREATE TABLE IF NOT EXISTS results (
        id TEXT PRIMARY KEY,
        apaar_id TEXT NOT NULL,
        academic_year TEXT NOT NULL,
        passed INTEGER NOT NULL,
        marks_pct REAL NOT NULL,
        FOREIGN KEY (apaar_id) REFERENCES students(apaar_id)
    );

    CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        type TEXT CHECK (type IN ('join', 'lateral', 'transfer', 'exit', 'reentry')),
        apaar_id TEXT NOT NULL,
        from_inst TEXT,
        to_inst TEXT,
        program TEXT DEFAULT 'B.Tech',
        year INTEGER DEFAULT 1,
        state TEXT CHECK (state IN ('SUBMITTED', 'INSTITUTE_REVIEW', 'APPROVED', 'REJECTED', 'AICTE_RECORDED')),
        details_json TEXT,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance (
        id TEXT PRIMARY KEY,
        apaar_id TEXT NOT NULL,
        institute_id TEXT NOT NULL,
        date TEXT NOT NULL,
        session TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT CHECK (source IN ('QR', 'manual')),
        device_id TEXT,
        timestamp TEXT NOT NULL,
        UNIQUE (apaar_id, date, session)
    );

    CREATE TABLE IF NOT EXISTS attendance_summaries (
        apaar_id TEXT NOT NULL,
        month TEXT NOT NULL,
        days_present INTEGER NOT NULL,
        days_held INTEGER NOT NULL,
        attendance_pct REAL NOT NULL,
        PRIMARY KEY (apaar_id, month)
    );

    CREATE TABLE IF NOT EXISTS faculty_attendance (
        id TEXT PRIMARY KEY,
        faculty_id TEXT NOT NULL,
        institute_id TEXT NOT NULL,
        date TEXT NOT NULL,
        lectures_delivered INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schemes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        authority TEXT NOT NULL,
        active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS scheme_rules (
        scheme_id TEXT PRIMARY KEY,
        rules_json TEXT NOT NULL,
        FOREIGN KEY (scheme_id) REFERENCES schemes(id)
    );

    CREATE TABLE IF NOT EXISTS scholarship_claims_ledger (
        id TEXT PRIMARY KEY,
        apaar_id TEXT NOT NULL,
        scheme_id TEXT NOT NULL,
        status TEXT CHECK (status IN ('APPLIED', 'DISBURSED', 'REVOKED')),
        timestamp TEXT NOT NULL,
        UNIQUE (apaar_id, scheme_id, status)
    );

    CREATE TABLE IF NOT EXISTS configurable_rules (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grievances (
        id TEXT PRIMARY KEY,
        apaar_id TEXT NOT NULL,
        issue TEXT NOT NULL,
        status TEXT CHECK (status IN ('SUBMITTED', 'UNDER_INVESTIGATION', 'RESOLVED', 'REJECTED')),
        assigned_to TEXT,
        resolution TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        record_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL,
        timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS used_nonces (
        nonce TEXT PRIMARY KEY,
        used_at TEXT NOT NULL
    );
    """)
    conn.commit()
    conn.close()

init_db()

# ---------------- AUDIT SERVICE ----------------

def append_audit_event(conn: sqlite3.Connection, actor: str, action: str, record_id: str, payload: dict):
    cursor = conn.cursor()
    cursor.execute("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1")
    row = cursor.fetchone()
    prev_hash = row["hash"] if row else "0000000000000000000000000000000000000000000000000000000000000000"
    payload_str = json.dumps(payload, sort_keys=True)
    raw_str = f"{prev_hash}{payload_str}"
    current_hash = hashlib.sha256(raw_str.encode("utf-8")).hexdigest()
    ts = datetime.utcnow().isoformat()
    cursor.execute(
        "INSERT INTO audit_log (actor, action, record_id, payload, prev_hash, hash, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (actor, action, record_id, payload_str, prev_hash, current_hash, ts)
    )

# ---------------- MOCK ADAPTERS ----------------

class MockAPAARAdapter:
    @staticmethod
    def verify_identity(apaar_id: str, name: str, dob: str) -> dict:
        if not apaar_id or len(apaar_id) != 12 or not apaar_id.isdigit():
            return {"verified": False, "reason": "Invalid APAAR format: must be 12 digits"}
        if apaar_id.endswith("999"):
            return {"verified": False, "reason": "APAAR record suspended or unlinked"}
        if apaar_id.endswith("888"):
            return {"verified": False, "reason": "Identity demographic mismatch: Name/DOB verification failed with Central Aadhaar/APAAR Registry"}
        return {"verified": True, "masked_id": f"XXXXXXXX{apaar_id[-4:]}", "kyc_status": "COMPLETED"}

class MockABCAdapter:
    @staticmethod
    def get_student_credits(conn: sqlite3.Connection, apaar_id: str) -> List[dict]:
        cursor = conn.cursor()
        cursor.execute("SELECT course, credits, source_institute, valid_till FROM academic_credit_ledger WHERE apaar_id = ?", (apaar_id,))
        return [dict(r) for r in cursor.fetchall()]

class MockDigiLockerAdapter:
    @staticmethod
    def fetch_credentials(conn: sqlite3.Connection, apaar_id: str) -> dict:
        cursor = conn.cursor()
        cursor.execute("SELECT prior_qualification, category, family_income, domicile FROM students WHERE apaar_id = ?", (apaar_id,))
        row = cursor.fetchone()
        if not row:
            return {}
        return dict(row)

# ---------------- SCHEME ELIGIBILITY ENGINE ----------------

def evaluate_scheme_criteria(conn: sqlite3.Connection, apaar_id: str, scheme_id: str) -> dict:
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM students WHERE apaar_id = ?", (apaar_id,))
    student = cursor.fetchone()
    if not student:
        return {"status": "BLOCKED", "overall_reason": "Student record not found", "breakdown": []}

    cursor.execute("SELECT * FROM schemes WHERE id = ?", (scheme_id,))
    scheme = cursor.fetchone()
    if not scheme or not scheme["active"]:
        return {"status": "BLOCKED", "overall_reason": "Scheme inactive or does not exist", "breakdown": []}

    cursor.execute("SELECT rules_json FROM scheme_rules WHERE scheme_id = ?", (scheme_id,))
    rules_row = cursor.fetchone()
    rules = json.loads(rules_row["rules_json"]) if rules_row else {}

    breakdown = []
    overall_pass = True

    # Check 1: Consent & APAAR Identity
    apaar_check = MockAPAARAdapter.verify_identity(apaar_id, student["name"], student["dob"])
    if apaar_check["verified"] and student["consent"] == 1:
        breakdown.append({"criterion": "APAAR Identity & Consent", "required": "Verified & Consented", "actual": "Verified", "status": "PASS", "source": "APAAR Mock Gateway"})
    else:
        overall_pass = False
        reason = apaar_check.get("reason", "Missing DPDP Consent")
        breakdown.append({"criterion": "APAAR Identity & Consent", "required": "Verified & Consented", "actual": f"Unverified ({reason})", "status": "FAIL", "source": "APAAR Mock Gateway"})

    # Check 2: Active Verified Enrollment
    cursor.execute("SELECT e.*, c.faculty_fte, c.verified_students, c.sanctioned_intake FROM enrollments e LEFT JOIN capacity c ON e.institute_id = c.institute_id AND e.program = c.program WHERE e.apaar_id = ? AND e.status = 'ACTIVE'", (apaar_id,))
    enrollment = cursor.fetchone()
    if rules.get("requires_active_enrollment", True):
        if enrollment:
            breakdown.append({"criterion": "Active Verified Enrollment", "required": "ACTIVE", "actual": f"ACTIVE ({enrollment['institute_id']})", "status": "PASS", "source": "Enrollment Ledger"})
        else:
            overall_pass = False
            breakdown.append({"criterion": "Active Verified Enrollment", "required": "ACTIVE", "actual": "None / Non-Active", "status": "FAIL", "source": "Enrollment Ledger"})

    # Check 3: Institute Compliance (Intake cap & faculty ratio)
    if rules.get("institute_must_be_compliant", True) and enrollment:
        inst_compliant = True
        max_ratio = 20.0
        cursor.execute("SELECT value_json FROM configurable_rules WHERE key = 'ratio_limits'")
        r_conf = cursor.fetchone()
        if r_conf:
            max_ratio = float(json.loads(r_conf["value_json"]).get(enrollment["program"], 20.0))
        ratio = enrollment["verified_students"] / max(1, enrollment["faculty_fte"])
        if enrollment["verified_students"] > enrollment["sanctioned_intake"] or ratio > max_ratio:
            inst_compliant = False

        if inst_compliant:
            breakdown.append({"criterion": "Host Institute Compliance", "required": "Intake & Ratio within AICTE Caps", "actual": f"Compliant (Ratio {ratio:.1f}:1)", "status": "PASS", "source": "AICTE Portal"})
        else:
            overall_pass = False
            breakdown.append({"criterion": "Host Institute Compliance", "required": "Intake & Ratio within AICTE Caps", "actual": f"Non-Compliant (Ratio {ratio:.1f}:1 > Max {max_ratio}:1)", "status": "FAIL", "source": "AICTE Portal"})

    # Check 4: Attendance Threshold
    if "min_attendance_pct" in rules and rules["min_attendance_pct"] is not None:
        min_att = rules["min_attendance_pct"]
        cursor.execute("SELECT AVG(attendance_pct) as avg_att FROM attendance_summaries WHERE apaar_id = ?", (apaar_id,))
        att_row = cursor.fetchone()
        actual_att = att_row["avg_att"] if att_row and att_row["avg_att"] is not None else 0.0
        if actual_att >= min_att:
            breakdown.append({"criterion": "Minimum Attendance", "required": f">= {min_att}%", "actual": f"{actual_att:.1f}%", "status": "PASS", "source": "Attendance Engine"})
        else:
            overall_pass = False
            breakdown.append({"criterion": "Minimum Attendance", "required": f">= {min_att}%", "actual": f"{actual_att:.1f}% (Needs +{(min_att - actual_att):.1f}%)", "status": "FAIL", "source": "Attendance Engine"})

    # Check 5: Family Income Limit
    if "max_family_income" in rules and rules["max_family_income"] is not None:
        max_inc = rules["max_family_income"]
        actual_inc = student["family_income"]
        if actual_inc <= max_inc:
            breakdown.append({"criterion": "Annual Family Income", "required": f"<= INR {max_inc:,.0f}", "actual": f"INR {actual_inc:,.0f}", "status": "PASS", "source": "DigiLocker"})
        else:
            overall_pass = False
            breakdown.append({"criterion": "Annual Family Income", "required": f"<= INR {max_inc:,.0f}", "actual": f"INR {actual_inc:,.0f} (Exceeds Limit)", "status": "FAIL", "source": "DigiLocker"})

    # Check 6: Gender requirement
    if "gender" in rules and rules["gender"] is not None:
        req_gender = rules["gender"]
        if student["gender"].lower() == req_gender.lower():
            breakdown.append({"criterion": "Gender Eligibility", "required": req_gender, "actual": student["gender"], "status": "PASS", "source": "APAAR Profile"})
        else:
            overall_pass = False
            breakdown.append({"criterion": "Gender Eligibility", "required": req_gender, "actual": student["gender"], "status": "FAIL", "source": "APAAR Profile"})

    # Check 7: Allowed Categories
    if "allowed_categories" in rules and rules["allowed_categories"]:
        allowed_cats = rules["allowed_categories"]
        if student["category"] in allowed_cats:
            breakdown.append({"criterion": "Category Quota", "required": f"In {allowed_cats}", "actual": student["category"], "status": "PASS", "source": "DigiLocker"})
        else:
            overall_pass = False
            breakdown.append({"criterion": "Category Quota", "required": f"In {allowed_cats}", "actual": student["category"], "status": "FAIL", "source": "DigiLocker"})

    # Check 8: Scheme Exclusivity & Duplicate Claims
    cursor.execute("SELECT scheme_id FROM scholarship_claims_ledger WHERE apaar_id = ? AND status = 'DISBURSED'", (apaar_id,))
    disbursed_claims = [r["scheme_id"] for r in cursor.fetchall()]
    if scheme_id in disbursed_claims:
        overall_pass = False
        breakdown.append({"criterion": "Duplicate Claim Prevention", "required": "No Prior Disbursal", "actual": "Already Claimed/Disbursed", "status": "FAIL", "source": "NSP Claims Ledger"})
    else:
        exclusive_with = rules.get("exclusive_with_schemes", [])
        conflicting = [s for s in exclusive_with if s in disbursed_claims]
        if conflicting:
            overall_pass = False
            breakdown.append({"criterion": "Scheme Exclusivity", "required": f"Cannot combine with {conflicting}", "actual": f"Active Conflict: {conflicting[0]}", "status": "FAIL", "source": "NSP Claims Ledger"})
        else:
            breakdown.append({"criterion": "Duplicate & Exclusivity Gate", "required": "No Conflicting Disbursals", "actual": "Clean Record", "status": "PASS", "source": "NSP Claims Ledger"})

    token = None
    if overall_pass:
        exp = int(time.time()) + 900
        payload = f"{apaar_id}|{scheme_id}|{exp}"
        sig = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
        token = f"{payload}|{sig}"

    return {
        "scheme_id": scheme_id,
        "scheme_name": scheme["name"],
        "status": "ELIGIBLE" if overall_pass else "BLOCKED",
        "eligibility_token": token,
        "breakdown": breakdown,
        "notice": "Criteria are illustrative; use official scheme guidelines."
    }

# ---------------- FASTAPI ENDPOINTS ----------------

class LoginRequest(BaseModel):
    role: str
    apaar_id: Optional[str] = None
    institute_id: Optional[str] = None
    otp: str
    consent: Optional[bool] = False

@app.post("/auth/login")
def login(req: LoginRequest, db: sqlite3.Connection = Depends(get_db)):
    if req.otp != "123456":
        raise HTTPException(status_code=401, detail="Invalid Demonstration OTP (Use 123456)")

    cursor = db.cursor()
    if req.role == "Student":
        if not req.apaar_id:
            raise HTTPException(status_code=400, detail="APAAR ID is mandatory for Student login")
        cursor.execute("SELECT * FROM students WHERE apaar_id = ?", (req.apaar_id,))
        student = cursor.fetchone()
        if not student:
            raise HTTPException(status_code=404, detail="Student APAAR record not found")
        if req.consent:
            cursor.execute("UPDATE students SET consent = 1 WHERE apaar_id = ?", (req.apaar_id,))
            db.commit()
            append_audit_event(db, req.apaar_id, "DPDP_CONSENT_GRANTED", req.apaar_id, {"consent": True})
        return {
            "role": "Student",
            "apaar_id": req.apaar_id,
            "masked_id": f"XXXXXXXX{req.apaar_id[-4:]}",
            "name": student["name"],
            "consent": bool(req.consent or student["consent"])
        }

    elif req.role == "Institute Admin / Teacher":
        inst_id = req.institute_id or "INST_DEL_01"
        cursor.execute("SELECT * FROM institutions WHERE id = ?", (inst_id,))
        inst = cursor.fetchone()
        return {
            "role": req.role,
            "institute_id": inst_id,
            "institute_name": inst["name"] if inst else "Delhi Engineering & Technology Institute",
            "token": f"mock-jwt-token-for-institute-{inst_id}"
        }

    elif req.role == "AICTE Officer":
        return {
            "role": req.role,
            "token": "mock-jwt-token-for-aicte-regulatory-officer"
        }
    raise HTTPException(status_code=400, detail="Invalid role specified")

# Metadata queries
@app.get("/institutions")
def get_institutions(db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("""
    SELECT i.id, i.aicte_code, i.name, i.state, c.program, c.sanctioned_intake, c.faculty_fte, c.lateral_seats, c.verified_students
    FROM institutions i
    LEFT JOIN capacity c ON i.id = c.institute_id
    """)
    rows = cursor.fetchall()
    return [dict(r) for r in rows]

@app.get("/students")
def get_all_students(db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT apaar_id, name, dob, category, gender, domicile, prior_qualification, family_income, consent FROM students")
    return [dict(r) for r in cursor.fetchall()]

@app.get("/students/{apaar_id}")
def get_student_details(apaar_id: str, db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT * FROM students WHERE apaar_id = ?", (apaar_id,))
    student = cursor.fetchone()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    cursor.execute("""
    SELECT e.*, i.name as institute_name 
    FROM enrollments e 
    JOIN institutions i ON e.institute_id = i.id 
    WHERE e.apaar_id = ?
    ORDER BY e.start_date DESC
    """, (apaar_id,))
    enrollments = [dict(r) for r in cursor.fetchall()]

    credits = MockABCAdapter.get_student_credits(db, apaar_id)

    cursor.execute("SELECT * FROM attendance_summaries WHERE apaar_id = ?", (apaar_id,))
    att = [dict(r) for r in cursor.fetchall()]

    cursor.execute("SELECT * FROM results WHERE apaar_id = ?", (apaar_id,))
    results = [dict(r) for r in cursor.fetchall()]

    return {
        "student": dict(student),
        "enrollments": enrollments,
        "credits": credits,
        "attendance_summaries": att,
        "results": results
    }

# ---------------- ENROLLMENT WORKFLOW & STATE MACHINE ----------------

class JoinRequestPayload(BaseModel):
    apaar_id: str
    institute_id: str
    program: str = "B.Tech"
    year: int = 1
    type: str = "join" # join, lateral, transfer, exit, reentry
    target_institute_id: Optional[str] = None

@app.post("/enrollment/request")
def create_enrollment_request(data: JoinRequestPayload, db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT * FROM students WHERE apaar_id = ?", (data.apaar_id,))
    student = cursor.fetchone()
    if not student:
        raise HTTPException(status_code=404, detail="Student APAAR record not found")

    req_id = str(uuid.uuid4())
    ts = datetime.utcnow().isoformat()

    cursor.execute(
        "INSERT INTO requests (id, type, apaar_id, from_inst, to_inst, program, year, state, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?)",
        (req_id, data.type, data.apaar_id, data.institute_id, data.target_institute_id or data.institute_id, data.program, data.year, json.dumps(data.dict()), ts)
    )
    db.commit()
    append_audit_event(db, data.apaar_id, f"ENROLLMENT_REQUEST_{data.type.upper()}", req_id, data.dict())
    return {"status": "SUCCESS", "request_id": req_id, "state": "SUBMITTED", "message": f"{data.type.capitalize()} request created and submitted to institute queue."}

@app.get("/enrollment/requests")
def list_enrollment_requests(institute_id: Optional[str] = None, apaar_id: Optional[str] = None, db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    query = """
    SELECT r.*, s.name as student_name, s.prior_qualification, s.dob, s.category, s.gender,
           i1.name as from_inst_name, i2.name as to_inst_name
    FROM requests r
    JOIN students s ON r.apaar_id = s.apaar_id
    LEFT JOIN institutions i1 ON r.from_inst = i1.id
    LEFT JOIN institutions i2 ON r.to_inst = i2.id
    WHERE 1=1
    """
    params = []
    if institute_id:
        query += " AND (r.to_inst = ? OR r.from_inst = ?)"
        params.extend([institute_id, institute_id])
    if apaar_id:
        query += " AND r.apaar_id = ?"
        params.append(apaar_id)

    query += " ORDER BY r.created_at DESC"
    cursor.execute(query, tuple(params))
    return [dict(r) for r in cursor.fetchall()]

class ProcessRequestPayload(BaseModel):
    request_id: str
    action: str # APPROVE or REJECT
    rejection_reason: Optional[str] = None

@app.post("/enrollment/process-request")
def process_enrollment_request(data: ProcessRequestPayload, db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT * FROM requests WHERE id = ?", (data.request_id,))
    req = cursor.fetchone()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req["state"] in ["APPROVED", "REJECTED"]:
        raise HTTPException(status_code=400, detail=f"Request already processed with status {req['state']}")

    apaar_id = req["apaar_id"]
    dest_inst_id = req["to_inst"]
    program = req["program"]
    req_type = req["type"]

    if data.action == "REJECT":
        cursor.execute("UPDATE requests SET state = 'REJECTED' WHERE id = ?", (data.request_id,))
        db.commit()
        append_audit_event(db, dest_inst_id, "REQUEST_REJECTED", data.request_id, {"reason": data.rejection_reason})
        return {"status": "REJECTED", "message": "Request marked as rejected"}

    # APPROVE PATH: Enforce 5 Hard Gates in ONE Transaction
    cursor.execute("SELECT * FROM students WHERE apaar_id = ?", (apaar_id,))
    student = cursor.fetchone()

    # Gate A: Duplicate Active Admission Check
    cursor.execute("SELECT * FROM enrollments WHERE apaar_id = ? AND status = 'ACTIVE'", (apaar_id,))
    active_enr = cursor.fetchone()
    if active_enr and req_type != "transfer":
        raise HTTPException(
            status_code=409,
            detail=f"DUPLICATE ENROLLMENT REJECTED: Student already has an ACTIVE enrollment at Institute {active_enr['institute_id']}. Multi-college dual active admissions are strictly prohibited under AICTE norms."
        )

    # Gate B: APAAR & Name/DOB Demographic Verification
    apaar_ver = MockAPAARAdapter.verify_identity(apaar_id, student["name"], student["dob"])
    if not apaar_ver["verified"]:
        raise HTTPException(
            status_code=400,
            detail=f"APAAR IDENTITY MISMATCH: {apaar_ver.get('reason')}. Diverted to manual officer review."
        )

    # Gate C: Lateral Entry Qualification Check
    if req_type == "lateral":
        if "diploma" not in student["prior_qualification"].lower():
            raise HTTPException(
                status_code=400,
                detail=f"LATERAL ELIGIBILITY FAILED: Prior qualification is '{student['prior_qualification']}'. NEP AICTE norms require a recognized Polytechnic/Technical Diploma for Year-2 Lateral Entry."
            )

    # Gate D & E: Capacity hard cap & Faculty-Student Ratio Check
    cursor.execute("SELECT * FROM capacity WHERE institute_id = ? AND program = ?", (dest_inst_id, program))
    cap = cursor.fetchone()
    if not cap:
        raise HTTPException(status_code=404, detail="Institution program capacity record not found")

    new_verified = cap["verified_students"] + 1
    sanctioned = cap["sanctioned_intake"]
    faculty_fte = max(1, cap["faculty_fte"])

    # Hard cap check
    if new_verified > sanctioned:
        # Find alternatives
        cursor.execute("""
        SELECT i.name, c.institute_id, (c.sanctioned_intake - c.verified_students) as vacant
        FROM capacity c
        JOIN institutions i ON c.institute_id = i.id
        WHERE c.program = ? AND (c.sanctioned_intake - c.verified_students) > 0
        LIMIT 3
        """, (program,))
        alternatives = [dict(r) for r in cursor.fetchall()]
        raise HTTPException(
            status_code=400,
            detail={
                "error": "SANCTIONED_INTAKE_EXCEEDED",
                "message": f"Hard cap breach: Verified admissions ({new_verified}) exceeds sanctioned intake ({sanctioned}).",
                "alternative_institutions_with_vacancies": alternatives
            }
        )

    # Ratio check
    cursor.execute("SELECT value_json FROM configurable_rules WHERE key = 'ratio_limits'")
    ratio_limits = json.loads(cursor.fetchone()["value_json"])
    max_ratio = float(ratio_limits.get(program, 20.0))
    projected_ratio = new_verified / faculty_fte
    if projected_ratio > max_ratio:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "FACULTY_RATIO_BREACH",
                "message": f"Admission would breach AICTE faculty-student ratio limit ({projected_ratio:.2f}:1 exceeds max permitted {max_ratio}:1 with {faculty_fte} FTE faculty).",
            }
        )

    # All Gates Passed: Execute State Transitions
    today_str = date.today().isoformat()

    # If Transfer, close old enrollment atomically
    if req_type == "transfer":
        if active_enr:
            cursor.execute("UPDATE enrollments SET status = 'TRANSFERRED_OUT', end_date = ? WHERE id = ?", (today_str, active_enr["id"]))
            # Decrement old institute counter
            cursor.execute("UPDATE capacity SET verified_students = MAX(0, verified_students - 1) WHERE institute_id = ? AND program = ?", (active_enr["institute_id"], active_enr["program"]))
            append_audit_event(db, dest_inst_id, "ENROLLMENT_TRANSFERRED_OUT", active_enr["id"], {"from": active_enr["institute_id"], "to": dest_inst_id})

    # Create new ACTIVE enrollment
    new_enr_id = str(uuid.uuid4())
    year_level = 2 if req_type == "lateral" else req["year"]
    cursor.execute(
        "INSERT INTO enrollments (id, apaar_id, institute_id, program, year, entry_type, status, start_date) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)",
        (new_enr_id, apaar_id, dest_inst_id, program, year_level, req_type if req_type in ['regular', 'lateral', 'transfer'] else 'regular', today_str)
    )

    # Increment destination institute counter
    cursor.execute("UPDATE capacity SET verified_students = verified_students + 1 WHERE id = ?", (cap["id"],))

    # Update request state to APPROVED
    cursor.execute("UPDATE requests SET state = 'APPROVED' WHERE id = ?", (data.request_id,))

    db.commit()
    append_audit_event(db, dest_inst_id, "ENROLLMENT_ACTIVATED", new_enr_id, {
        "apaar_id": apaar_id,
        "institute_id": dest_inst_id,
        "entry_type": req_type,
        "new_verified_count": new_verified
    })

    return {
        "status": "APPROVED",
        "message": "Enrollment verified and activated. Personal attendance QR token unlocked.",
        "enrollment_id": new_enr_id,
        "new_intake_count": new_verified
    }

# ---------------- QR ATTENDANCE ENGINE ----------------

@app.get("/attendance/qr/{apaar_id}")
def generate_attendance_qr(apaar_id: str, db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT * FROM enrollments WHERE apaar_id = ? AND status = 'ACTIVE'", (apaar_id,))
    enr = cursor.fetchone()
    if not enr:
        raise HTTPException(status_code=403, detail="QR attendance is available only to students with active, institute-verified enrollment.")

    now = int(time.time())
    expires_at = now + 30
    nonce = str(uuid.uuid4())[:8]
    apaar_id_hash = hashlib.sha256(apaar_id.encode()).hexdigest()[:16]

    payload = f"{apaar_id_hash}:{enr['id']}:{enr['institute_id']}:{now}:{expires_at}:{nonce}"
    signature = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
    signed_token = f"{payload}:{signature}"

    return {
        "signed_token": signed_token,
        "expires_in_seconds": 30,
        "issued_at": now,
        "institute_id": enr["institute_id"]
    }

class ScanPayload(BaseModel):
    signed_token: str
    scanner_institute_id: str
    device_id: str = "DEV_LAB_01"

@app.post("/attendance/scan")
def scan_attendance(data: ScanPayload, db: sqlite3.Connection = Depends(get_db)):
    parts = data.signed_token.split(":")
    if len(parts) != 7:
        raise HTTPException(status_code=400, detail="Invalid QR token format")

    apaar_id_hash, enr_id, token_inst_id, issued_at_str, expires_at_str, nonce, signature = parts
    payload = f"{apaar_id_hash}:{enr_id}:{token_inst_id}:{issued_at_str}:{expires_at_str}:{nonce}"
    expected_sig = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]

    if not hmac.compare_digest(signature, expected_sig):
        raise HTTPException(status_code=400, detail="Tampered or invalid token signature")

    now = int(time.time())
    if now > int(expires_at_str):
        raise HTTPException(status_code=400, detail="QR token expired. Student must refresh rotating screen.")

    cursor = db.cursor()
    cursor.execute("SELECT nonce FROM used_nonces WHERE nonce = ?", (nonce,))
    if cursor.fetchone():
        raise HTTPException(status_code=400, detail="Single-use token already consumed (Replay attack prevented)")

    if token_inst_id != data.scanner_institute_id:
        raise HTTPException(status_code=403, detail=f"Institution mismatch: token belongs to {token_inst_id}, scanned by {data.scanner_institute_id}")

    cursor.execute("SELECT * FROM enrollments WHERE id = ? AND status = 'ACTIVE'", (enr_id,))
    enr = cursor.fetchone()
    if not enr:
        raise HTTPException(status_code=403, detail="Student has no active verified enrollment at this institution")

    student_apaar = enr["apaar_id"]
    cursor.execute("SELECT name FROM students WHERE apaar_id = ?", (student_apaar,))
    st_info = cursor.fetchone()
    st_name = st_info["name"] if st_info else "Student"

    today_str = date.today().isoformat()
    session = "FORENOON"

    cursor.execute("SELECT id FROM attendance WHERE apaar_id = ? AND date = ? AND session = ?", (student_apaar, today_str, session))
    if cursor.fetchone():
        return {
            "status": "REJECTED",
            "reason": "Already marked for this session today",
            "apaar_id_masked": f"XXXXXXXX{student_apaar[-4:]}",
            "student_name": st_name
        }

    att_id = str(uuid.uuid4())
    ts = datetime.utcnow().isoformat()
    cursor.execute(
        "INSERT INTO attendance (id, apaar_id, institute_id, date, session, status, source, device_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (att_id, student_apaar, token_inst_id, today_str, session, "PRESENT", "QR", data.device_id, ts)
    )
    cursor.execute("INSERT INTO used_nonces (nonce, used_at) VALUES (?, ?)", (nonce, ts))

    # Update summary counter
    month_str = today_str[:7]
    cursor.execute("SELECT * FROM attendance_summaries WHERE apaar_id = ? AND month = ?", (student_apaar, month_str))
    curr_summary = cursor.fetchone()
    if curr_summary:
        new_pres = curr_summary["days_present"] + 1
        new_held = max(new_pres, curr_summary["days_held"])
        new_pct = round((new_pres / new_held) * 100, 1)
        cursor.execute("UPDATE attendance_summaries SET days_present = ?, days_held = ?, attendance_pct = ? WHERE apaar_id = ? AND month = ?", (new_pres, new_held, new_pct, student_apaar, month_str))
    else:
        cursor.execute("INSERT INTO attendance_summaries VALUES (?, ?, 1, 1, 100.0)", (student_apaar, month_str))

    db.commit()
    append_audit_event(db, "FACULTY_SCANNER", "ATTENDANCE_RECORDED", att_id, {"apaar_id": student_apaar, "inst": token_inst_id, "session": session})
    return {
        "status": "SUCCESS",
        "message": "Attendance recorded successfully via Signed QR",
        "apaar_id_masked": f"XXXXXXXX{student_apaar[-4:]}",
        "student_name": st_name,
        "date": today_str
    }

@app.post("/attendance/reset-demo")
def reset_demo_attendance(db: sqlite3.Connection = Depends(get_db)):
    """Allows demo reset of today's attendance logs so demonstrators can repeat Scenario 2 seamlessly"""
    cursor = db.cursor()
    cursor.execute("DELETE FROM attendance")
    cursor.execute("DELETE FROM used_nonces")
    db.commit()
    return {"status": "SUCCESS", "message": "Attendance logs and nonces cleared for demo."}


# ---------------- SCHEME APIS & GATE ----------------

@app.get("/eligibility/{apaar_id}")
def check_single_scheme(apaar_id: str, scheme: str = Query(..., description="Scheme ID"), db: sqlite3.Connection = Depends(get_db)):
    return evaluate_scheme_criteria(db, apaar_id, scheme)

@app.get("/eligibility/{apaar_id}/schemes")
def check_all_schemes(apaar_id: str, db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT id, name FROM schemes WHERE active = 1")
    schemes = cursor.fetchall()
    results = []
    for s in schemes:
        eval_res = evaluate_scheme_criteria(db, apaar_id, s["id"])
        results.append(eval_res)
    return results

class DisburseRequest(BaseModel):
    apaar_id: str
    scheme_id: str
    eligibility_token: str

@app.post("/schemes/disburse")
def disburse_scheme_benefit(req: DisburseRequest, db: sqlite3.Connection = Depends(get_db)):
    parts = req.eligibility_token.split("|")
    if len(parts) != 4:
        raise HTTPException(status_code=400, detail="Malformed eligibility token")

    token_apaar, token_scheme, exp_str, sig = parts
    payload = f"{token_apaar}|{token_scheme}|{exp_str}"
    expected_sig = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(sig, expected_sig):
        raise HTTPException(status_code=400, detail="Invalid token signature")

    if int(time.time()) > int(exp_str):
        raise HTTPException(status_code=400, detail="Eligibility token expired; eligibility must be freshly re-verified")

    # Dynamic re-evaluation to catch real-time drift (Scenario 9)
    live_eval = evaluate_scheme_criteria(db, req.apaar_id, req.scheme_id)
    if live_eval["status"] != "ELIGIBLE":
        raise HTTPException(status_code=403, detail=f"Disbursal blocked: Real-time criteria re-evaluation failed! Attendance or compliance changed since token issuance.")

    claim_id = str(uuid.uuid4())
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO scholarship_claims_ledger (id, apaar_id, scheme_id, status, timestamp) VALUES (?, ?, ?, 'DISBURSED', ?)",
        (claim_id, req.apaar_id, req.scheme_id, datetime.utcnow().isoformat())
    )
    db.commit()
    append_audit_event(db, "NSP_MOCK_DISBURSER", "SCHEME_DISBURSED", claim_id, {"apaar_id": req.apaar_id, "scheme": req.scheme_id})
    return {"status": "SUCCESS", "message": "Scholarship disbursed successfully", "claim_id": claim_id}

@app.post("/schemes/simulate-attendance-drop/{apaar_id}")
def simulate_attendance_drop(apaar_id: str, db: sqlite3.Connection = Depends(get_db)):
    """Used for Demo Scenario 9: Drops attendance below cutoff to test disbursal time re-evaluation gate"""
    cursor = db.cursor()
    cursor.execute("UPDATE attendance_summaries SET days_present = 12, days_held = 24, attendance_pct = 50.0 WHERE apaar_id = ?", (apaar_id,))
    db.commit()
    append_audit_event(db, "DEMO_SIMULATOR", "ATTENDANCE_DROPPED_TEST", apaar_id, {"new_pct": 50.0})
    return {"status": "SUCCESS", "message": f"Attendance for {apaar_id} dropped to 50.0% to test disbursal gate refusal."}

# ---------------- GRIEVANCE WORKFLOW ----------------

class GrievanceCreate(BaseModel):
    apaar_id: str
    issue: str

@app.post("/grievances")
def create_grievance(data: GrievanceCreate, db: sqlite3.Connection = Depends(get_db)):
    gid = str(uuid.uuid4())
    ts = datetime.utcnow().isoformat()
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO grievances (id, apaar_id, issue, status, assigned_to, created_at) VALUES (?, ?, ?, 'SUBMITTED', 'AICTE_DESK', ?)",
        (gid, data.apaar_id, data.issue, ts)
    )
    db.commit()
    append_audit_event(db, data.apaar_id, "GRIEVANCE_RAISED", gid, {"issue": data.issue})
    return {"status": "SUCCESS", "grievance_id": gid, "message": "Grievance submitted to AICTE Helpdesk manual queue."}

@app.get("/grievances")
def list_grievances(db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("""
    SELECT g.*, s.name as student_name
    FROM grievances g
    JOIN students s ON g.apaar_id = s.apaar_id
    ORDER BY g.created_at DESC
    """)
    return [dict(r) for r in cursor.fetchall()]

class GrievanceResolve(BaseModel):
    grievance_id: str
    resolution: str

@app.post("/grievances/resolve")
def resolve_grievance(data: GrievanceResolve, db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    ts = datetime.utcnow().isoformat()
    cursor.execute("UPDATE grievances SET status = 'RESOLVED', resolution = ?, resolved_at = ? WHERE id = ?", (data.resolution, ts, data.grievance_id))
    db.commit()
    append_audit_event(db, "AICTE_OFFICER", "GRIEVANCE_RESOLVED", data.grievance_id, {"resolution": data.resolution})
    return {"status": "SUCCESS", "message": "Grievance resolved and written to audit log."}

# ---------------- AICTE REGULATORY MONITORING & DRIFT RECONCILIATION ----------------

@app.get("/aicte/compliance-overview")
def get_aicte_overview(db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("""
    SELECT 
        i.id, i.aicte_code, i.name, i.state,
        c.program, c.sanctioned_intake, c.faculty_fte, c.verified_students,
        (CAST(c.verified_students AS REAL) / MAX(1, c.faculty_fte)) as actual_ratio
    FROM institutions i
    JOIN capacity c ON i.id = c.institute_id
    """)
    rows = cursor.fetchall()
    
    cursor.execute("SELECT value_json FROM configurable_rules WHERE key = 'ratio_limits'")
    ratio_limits = json.loads(cursor.fetchone()["value_json"])

    overview = []
    for r in rows:
        max_ratio = float(ratio_limits.get(r["program"], 20.0))
        ratio_breached = r["actual_ratio"] > max_ratio
        intake_breached = r["verified_students"] > r["sanctioned_intake"]
        occupancy_pct = round((r["verified_students"] / max(1, r["sanctioned_intake"])) * 100, 1)
        under_filled = occupancy_pct < 40.0

        overview.append({
            "institute_id": r["id"],
            "aicte_code": r["aicte_code"],
            "name": r["name"],
            "state": r["state"],
            "program": r["program"],
            "sanctioned_intake": r["sanctioned_intake"],
            "verified_students": r["verified_students"],
            "occupancy_pct": occupancy_pct,
            "faculty_fte": r["faculty_fte"],
            "actual_ratio": round(r["actual_ratio"], 2),
            "max_ratio": max_ratio,
            "violations": {
                "ratio_breach": ratio_breached,
                "intake_breach": intake_breached,
                "under_filled": under_filled
            }
        })
    return overview

@app.get("/aicte/ghost-students")
def get_ghost_students(db: sqlite3.Connection = Depends(get_db)):
    """Scenario 7: Enrolled student with zero QR attendance marks in confirmation window"""
    cursor = db.cursor()
    cursor.execute("""
    SELECT e.apaar_id, s.name, e.institute_id, i.name as institute_name, e.start_date,
           COALESCE(SUM(a.days_present), 0) as total_attendance
    FROM enrollments e
    JOIN students s ON e.apaar_id = s.apaar_id
    JOIN institutions i ON e.institute_id = i.id
    LEFT JOIN attendance_summaries a ON e.apaar_id = a.apaar_id
    WHERE e.status = 'ACTIVE'
    GROUP BY e.apaar_id
    HAVING total_attendance == 0
    """)
    return [dict(r) for r in cursor.fetchall()]

@app.post("/aicte/reconciliation")
def run_nightly_reconciliation(db: sqlite3.Connection = Depends(get_db)):
    """Nightly reconciliation job recomputing verified intake counts from raw active enrollments vs capacity table counters"""
    cursor = db.cursor()
    cursor.execute("SELECT id, institute_id, program, verified_students FROM capacity")
    capacities = cursor.fetchall()

    reconciliation_report = []
    drift_detected = False

    for c in capacities:
        cursor.execute(
            "SELECT COUNT(*) as raw_count FROM enrollments WHERE institute_id = ? AND program = ? AND status = 'ACTIVE'",
            (c["institute_id"], c["program"])
        )
        raw_count = cursor.fetchone()["raw_count"]
        counter_val = c["verified_students"]
        drift = raw_count - counter_val

        if drift != 0:
            drift_detected = True
            cursor.execute("UPDATE capacity SET verified_students = ? WHERE id = ?", (raw_count, c["id"]))

        reconciliation_report.append({
            "institute_id": c["institute_id"],
            "program": c["program"],
            "recorded_counter": counter_val,
            "raw_enrollment_rows": raw_count,
            "drift": drift,
            "reconciled": drift != 0
        })

    db.commit()
    append_audit_event(db, "AICTE_RECONCILIATION_CRON", "RECONCILIATION_RUN", "DAILY_JOB", {
        "report": reconciliation_report,
        "drift_detected": drift_detected
    })
    return {
        "status": "COMPLETED",
        "drift_detected": drift_detected,
        "timestamp": datetime.utcnow().isoformat(),
        "details": reconciliation_report
    }

# ---------------- AUDIT LOG TRAIL & DEMO TAMPERING ----------------

@app.get("/audit/logs")
def get_audit_logs(db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT 50")
    return [dict(r) for r in cursor.fetchall()]

@app.get("/audit/verify")
def verify_audit_chain(db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT * FROM audit_log ORDER BY id ASC")
    logs = cursor.fetchall()

    prev_hash = "0000000000000000000000000000000000000000000000000000000000000000"
    for log in logs:
        if log["prev_hash"] != prev_hash:
            return {"status": "COMPROMISED", "failed_at_id": log["id"], "reason": "Previous hash link broken"}
        raw_str = f"{prev_hash}{log['payload']}"
        expected_hash = hashlib.sha256(raw_str.encode("utf-8")).hexdigest()
        if log["hash"] != expected_hash:
            return {"status": "COMPROMISED", "failed_at_id": log["id"], "reason": "Payload hash mismatch detected (Tampering)"}
        prev_hash = log["hash"]

    return {"status": "INTACT", "total_records_verified": len(logs)}

@app.post("/audit/tamper-demo")
def tamper_audit_log(db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT id, payload FROM audit_log ORDER BY id DESC LIMIT 1")
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Audit log empty, cannot tamper")

    tampered_payload = json.dumps({"tampered": True, "unauthorized_change": "Malicious payload injection test"}, sort_keys=True)
    cursor.execute("UPDATE audit_log SET payload = ? WHERE id = ?", (tampered_payload, row["id"]))
    db.commit()
    return {"status": "TAMPERED", "tampered_record_id": row["id"]}
