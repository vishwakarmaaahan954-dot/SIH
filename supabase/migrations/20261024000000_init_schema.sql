-- SIH 2026: APAAR Verify PostgreSQL Schema for Supabase
-- Problem Statement: Development of an APAAR ID-Based Student Data Management and Verification Platform for AICTE-Approved Institutions

-- Enable pgcrypto for SHA-256 hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Students Master
CREATE TABLE IF NOT EXISTS students (
    apaar_id VARCHAR(12) PRIMARY KEY,
    name TEXT NOT NULL,
    dob DATE NOT NULL,
    category TEXT NOT NULL,
    gender TEXT NOT NULL,
    domicile TEXT NOT NULL,
    prior_qualification TEXT NOT NULL,
    family_income NUMERIC(12, 2) NOT NULL,
    consent BOOLEAN DEFAULT FALSE,
    is_identity_verified BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Institutions
CREATE TABLE IF NOT EXISTS institutions (
    id TEXT PRIMARY KEY,
    aicte_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Capacity & Ratio Limits
CREATE TABLE IF NOT EXISTS capacity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institute_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    program TEXT NOT NULL,
    academic_year TEXT NOT NULL,
    sanctioned_intake INTEGER NOT NULL,
    faculty_fte INTEGER NOT NULL,
    lateral_seats INTEGER NOT NULL,
    verified_students INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (institute_id, program, academic_year)
);

-- 4. Enrollments (Append-only history with partial unique index)
CREATE TABLE IF NOT EXISTS enrollments (
    id TEXT PRIMARY KEY,
    apaar_id VARCHAR(12) NOT NULL REFERENCES students(apaar_id),
    institute_id TEXT NOT NULL REFERENCES institutions(id),
    program TEXT NOT NULL,
    year INTEGER NOT NULL,
    entry_type TEXT CHECK (entry_type IN ('regular', 'lateral', 'transfer')),
    status TEXT CHECK (status IN ('CLAIMED', 'LISTED', 'ACTIVE', 'TRANSFERRED_OUT', 'EXITED')),
    start_date DATE NOT NULL,
    end_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hard Rule: Only ONE ACTIVE enrollment per student nationwide
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_enrollment_uniq
ON enrollments(apaar_id) WHERE status = 'ACTIVE';

-- 5. Academic Credit Ledger (ABC)
CREATE TABLE IF NOT EXISTS academic_credit_ledger (
    id TEXT PRIMARY KEY,
    apaar_id VARCHAR(12) NOT NULL REFERENCES students(apaar_id),
    course TEXT NOT NULL,
    credits INTEGER NOT NULL,
    source_institute TEXT NOT NULL,
    valid_till DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Results
CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY,
    apaar_id VARCHAR(12) NOT NULL REFERENCES students(apaar_id),
    academic_year TEXT NOT NULL,
    passed BOOLEAN NOT NULL,
    marks_pct NUMERIC(5, 2) NOT NULL
);

-- 7. Requests (State machine: SUBMITTED -> INSTITUTE_REVIEW -> APPROVED/REJECTED -> AICTE_RECORDED)
CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    type TEXT CHECK (type IN ('join', 'lateral', 'transfer', 'exit', 'reentry')),
    apaar_id VARCHAR(12) NOT NULL REFERENCES students(apaar_id),
    from_inst TEXT REFERENCES institutions(id),
    to_inst TEXT REFERENCES institutions(id),
    program TEXT DEFAULT 'B.Tech',
    year INTEGER DEFAULT 1,
    state TEXT CHECK (state IN ('SUBMITTED', 'INSTITUTE_REVIEW', 'APPROVED', 'REJECTED', 'AICTE_RECORDED')),
    details_json JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Attendance Logs
CREATE TABLE IF NOT EXISTS attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    apaar_id VARCHAR(12) NOT NULL REFERENCES students(apaar_id),
    institute_id TEXT NOT NULL REFERENCES institutions(id),
    date DATE NOT NULL,
    session TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT CHECK (source IN ('QR', 'manual')),
    device_id TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (apaar_id, date, session)
);

-- 9. Attendance Summary
CREATE TABLE IF NOT EXISTS attendance_summary (
    apaar_id VARCHAR(12) NOT NULL REFERENCES students(apaar_id),
    month TEXT NOT NULL,
    days_present INTEGER NOT NULL,
    days_held INTEGER NOT NULL,
    attendance_pct NUMERIC(5, 2) NOT NULL,
    PRIMARY KEY (apaar_id, month)
);

-- 10. Faculty Attendance
CREATE TABLE IF NOT EXISTS faculty_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    faculty_id TEXT NOT NULL,
    institute_id TEXT NOT NULL REFERENCES institutions(id),
    date DATE NOT NULL,
    lectures_delivered INTEGER NOT NULL
);

-- 11. Schemes & Rules
CREATE TABLE IF NOT EXISTS schemes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    authority TEXT NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheme_rules (
    scheme_id TEXT PRIMARY KEY REFERENCES schemes(id) ON DELETE CASCADE,
    rules_json JSONB NOT NULL
);

-- 12. Claims Ledger
CREATE TABLE IF NOT EXISTS claims_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    apaar_id VARCHAR(12) NOT NULL REFERENCES students(apaar_id),
    scheme_id TEXT NOT NULL REFERENCES schemes(id),
    status TEXT CHECK (status IN ('APPLIED', 'DISBURSED', 'REVOKED')),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (apaar_id, scheme_id, status)
);

-- 13. Dynamic Configurable Rules
CREATE TABLE IF NOT EXISTS rules (
    key TEXT PRIMARY KEY,
    value_json JSONB NOT NULL
);

-- 14. Grievances
CREATE TABLE IF NOT EXISTS grievances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    apaar_id VARCHAR(12) NOT NULL REFERENCES students(apaar_id),
    issue TEXT NOT NULL,
    status TEXT CHECK (status IN ('SUBMITTED', 'UNDER_INVESTIGATION', 'RESOLVED', 'REJECTED')),
    assigned_to TEXT,
    resolution TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- 15. Audit Log (Cryptographically chained SHA-256)
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    record_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 16. Used Nonces (Replay Attack Prevention)
CREATE TABLE IF NOT EXISTS used_nonces (
    nonce TEXT PRIMARY KEY,
    used_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------
-- STORED PROCEDURES (RPC) REQUIRED BY EDGE FUNCTIONS
-- ------------------------------------------------------------------

-- Procedure 1: Atomic Audit Event Recorder
CREATE OR REPLACE FUNCTION record_audit_event(
    p_actor TEXT,
    p_action TEXT,
    p_record_id TEXT,
    p_payload JSONB
) RETURNS BIGINT AS $$
DECLARE
    v_prev_hash TEXT;
    v_current_hash TEXT;
    v_log_id BIGINT;
BEGIN
    SELECT hash INTO v_prev_hash FROM audit_log ORDER BY id DESC LIMIT 1;
    IF v_prev_hash IS NULL THEN
        v_prev_hash := '0000000000000000000000000000000000000000000000000000000000000000';
    END IF;

    -- SHA-256(prev_hash + payload_text)
    v_current_hash := encode(digest(v_prev_hash || p_payload::text, 'sha256'), 'hex');

    INSERT INTO audit_log (actor, action, record_id, payload, prev_hash, hash, timestamp)
    VALUES (p_actor, p_action, p_record_id, p_payload, v_prev_hash, v_current_hash, NOW())
    RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Procedure 2: Atomic QR Attendance Recorder
CREATE OR REPLACE FUNCTION record_qr_attendance(
    p_apaar_id TEXT,
    p_scanner_institute_id TEXT,
    p_nonce TEXT,
    p_device_id TEXT DEFAULT 'SCANNER_01',
    p_actor_auth_id TEXT DEFAULT '00000000-0000-0000-0000-000000000000'
) RETURNS JSONB AS $$
DECLARE
    v_today DATE := CURRENT_DATE;
    v_session TEXT := 'FORENOON';
    v_month TEXT := to_char(v_today, 'YYYY-MM');
    v_student_name TEXT;
    v_att_id UUID := gen_random_uuid();
    v_new_pres INT;
    v_new_held INT;
    v_new_pct NUMERIC(5,2);
BEGIN
    -- 1. Check Nonce (Prevent replay attack)
    IF EXISTS (SELECT 1 FROM used_nonces WHERE nonce = p_nonce) THEN
        RETURN jsonb_build_object('status', 'REJECTED', 'reason', 'Single-use token already consumed (Replay attack prevented)');
    END IF;

    -- 2. Check duplicate attendance today for session
    IF EXISTS (SELECT 1 FROM attendance WHERE apaar_id = p_apaar_id AND date = v_today AND session = v_session) THEN
        SELECT name INTO v_student_name FROM students WHERE apaar_id = p_apaar_id;
        RETURN jsonb_build_object(
            'status', 'REJECTED',
            'reason', 'Already marked for this session today',
            'student_name', v_student_name,
            'apaar_id_masked', 'XXXXXXXX' || right(p_apaar_id, 4)
        );
    END IF;

    -- 3. Log Attendance
    INSERT INTO attendance (id, apaar_id, institute_id, date, session, status, source, device_id, timestamp)
    VALUES (v_att_id, p_apaar_id, p_scanner_institute_id, v_today, v_session, 'PRESENT', 'QR', p_device_id, NOW());

    -- 4. Mark Nonce as used
    INSERT INTO used_nonces (nonce, used_at) VALUES (p_nonce, NOW());

    -- 5. Update Monthly Attendance Summary
    IF EXISTS (SELECT 1 FROM attendance_summary WHERE apaar_id = p_apaar_id AND month = v_month) THEN
        SELECT days_present + 1, GREATEST(days_held, days_present + 1)
        INTO v_new_pres, v_new_held
        FROM attendance_summary WHERE apaar_id = p_apaar_id AND month = v_month;

        v_new_pct := ROUND((v_new_pres::numeric / v_new_held::numeric) * 100, 1);

        UPDATE attendance_summary
        SET days_present = v_new_pres, days_held = v_new_held, attendance_pct = v_new_pct
        WHERE apaar_id = p_apaar_id AND month = v_month;
    ELSE
        INSERT INTO attendance_summary (apaar_id, month, days_present, days_held, attendance_pct)
        VALUES (p_apaar_id, v_month, 1, 1, 100.0);
    END IF;

    -- 6. Fetch Student Name for live card
    SELECT name INTO v_student_name FROM students WHERE apaar_id = p_apaar_id;

    -- 7. Audit Log
    PERFORM record_audit_event(
        'FACULTY_SCANNER',
        'ATTENDANCE_RECORDED',
        v_att_id::text,
        jsonb_build_object(
            'apaar_id', p_apaar_id,
            'institute_id', p_scanner_institute_id,
            'session', v_session,
            'device_id', p_device_id
        )
    );

    RETURN jsonb_build_object(
        'status', 'SUCCESS',
        'message', 'Attendance recorded successfully via Signed QR',
        'student_name', v_student_name,
        'apaar_id_masked', 'XXXXXXXX' || right(p_apaar_id, 4),
        'date', v_today::text
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

