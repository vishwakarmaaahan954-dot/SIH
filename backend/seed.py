import sqlite3
import json
import uuid
import hashlib
from datetime import datetime
from main import init_db

DATABASE_PATH = "apaar_verify.db"

def seed_master_data():
    init_db()
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    # Clear tables
    tables = [
        "students", "institutions", "capacity", "enrollments",
        "academic_credit_ledger", "results", "requests", "attendance",
        "attendance_summaries", "faculty_attendance", "schemes",
        "scheme_rules", "scholarship_claims_ledger", "configurable_rules",
        "grievances", "audit_log", "used_nonces"
    ]
    for t in tables:
        cursor.execute(f"DELETE FROM {t};")
    conn.commit()

    # 1. Configurable Rules
    rules = {
        "ratio_limits": json.dumps({"B.Tech": 20.0, "M.Tech": 15.0, "MCA": 20.0}),
        "min_occupancy_pct": json.dumps(40.0),
        "credit_validity_years": json.dumps(7),
        "confirmation_window_days": json.dumps(15),
        "anomaly_threshold_days_absent": json.dumps(14)
    }
    for k, v in rules.items():
        cursor.execute("INSERT INTO configurable_rules (key, value_json) VALUES (?, ?)", (k, v))

    # 2. Institutions
    institutions = [
        ("INST_DEL_01", "1-1001", "Delhi Engineering & Technology Institute", "Delhi"),
        ("INST_UP_02", "1-1002", "National Institute of Applied Sciences", "Uttar Pradesh"),
        ("INST_KA_03", "1-1003", "Bangalore College of Advanced Computing", "Karnataka"),
        ("INST_MH_04", "1-1004", "Maharashtra Institute of Information Tech", "Maharashtra"),
        ("INST_TN_05", "1-1005", "Chennai Autonomous Engineering College", "Tamil Nadu"),
        ("INST_FULL_06", "1-1006", "Apex Institute of Advanced Engineering", "Maharashtra")
    ]
    cursor.executemany("INSERT INTO institutions VALUES (?, ?, ?, ?)", institutions)

    # 3. Capacity
    # Note: INST_UP_02 is configured with intentional faculty-student ratio violation (Scenario 6)
    # INST_TN_05 is configured with intentional under-filling (<40% occupancy)
    # INST_FULL_06 is configured at 100% capacity with 0 available seats
    capacities = [
        ("CAP_01", "INST_DEL_01", "B.Tech", "2026-27", 120, 8, 12, 118, 2),
        ("CAP_02", "INST_UP_02", "B.Tech", "2026-27", 100, 3, 10, 95, 5), # Ratio: 95/3 = 31.6:1 (Breach > 20)
        ("CAP_03", "INST_KA_03", "B.Tech", "2026-27", 60, 5, 6, 45, 15),
        ("CAP_04", "INST_MH_04", "B.Tech", "2026-27", 120, 10, 12, 100, 20),
        ("CAP_05", "INST_TN_05", "B.Tech", "2026-27", 100, 6, 10, 20, 80), # Occupancy: 20% (Under-filled)
        ("CAP_06", "INST_FULL_06", "B.Tech", "2026-27", 50, 10, 5, 50, 0), # 100% full capacity
    ]
    cursor.executemany("INSERT INTO capacity (id, institute_id, program, academic_year, sanctioned_intake, faculty_fte, lateral_seats, verified_students, available_seats) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", capacities)

    # 4. Schemes & Rule Definitions
    schemes = [
        ("SCH_PRAGATI", "AICTE Pragati Scholarship for Girls", "AICTE", 1),
        ("SCH_POST_MATRIC", "Central Post-Matric SC/ST Scheme", "Ministry of Social Justice", 1),
        ("SCH_MERIT_CUM", "National Merit-Cum-Means Technical Grant", "AICTE / MoE", 1)
    ]
    cursor.executemany("INSERT INTO schemes VALUES (?, ?, ?, ?)", schemes)

    scheme_rules = [
        ("SCH_PRAGATI", json.dumps({
            "gender": "Female",
            "max_family_income": 800000.0,
            "min_attendance_pct": 75.0,
            "requires_active_enrollment": True,
            "institute_must_be_compliant": True,
            "exclusive_with_schemes": ["SCH_MERIT_CUM"]
        })),
        ("SCH_POST_MATRIC", json.dumps({
            "allowed_categories": ["SC", "ST"],
            "max_family_income": 250000.0,
            "min_attendance_pct": 70.0,
            "requires_active_enrollment": True,
            "institute_must_be_compliant": False
        })),
        ("SCH_MERIT_CUM", json.dumps({
            "min_attendance_pct": 75.0,
            "max_family_income": 600000.0,
            "requires_active_enrollment": True,
            "institute_must_be_compliant": True,
            "exclusive_with_schemes": ["SCH_PRAGATI"]
        }))
    ]
    cursor.executemany("INSERT INTO scheme_rules VALUES (?, ?)", scheme_rules)

    # 5. Students (Deterministic Test Personas)
    students = [
        # Scenario 1 & 8: High-performing, fully eligible girl student
        ("100000000001", "Priya Sharma", "2005-04-12", "General", "Female", "Delhi", "Class XII Science", 450000.0, 1, "ACTIVE", "INST_DEL_01"),
        # Scenario 8: Low attendance (62%)
        ("100000000002", "Rohan Verma", "2004-09-21", "OBC", "Male", "Uttar Pradesh", "Class XII Science", 320000.0, 1, "ACTIVE", "INST_DEL_01"),
        # Scenario 8: High family income (INR 1,200,000)
        ("100000000003", "Ananya Deshmukh", "2005-01-15", "General", "Female", "Maharashtra", "Class XII Science", 1200000.0, 1, "ACTIVE", "INST_MH_04"),
        # Scenario 3: Lateral Entry Diploma Candidate
        ("100000000004", "Karthik Rajan", "2003-11-05", "OBC", "Male", "Karnataka", "Polytechnic Diploma in CS", 280000.0, 1, "ACTIVE", "INST_KA_03"),
        # Scenario 7: Ghost student candidate (Enrolled, zero attendance scans)
        ("100000000005", "Suresh Kumar", "2004-07-19", "SC", "Male", "Delhi", "Class XII Science", 180000.0, 1, "ACTIVE", "INST_DEL_01"),
        # Scenario 10: Name mismatch on APAAR (Ends with 888)
        ("100000000888", "Aarav Gupta", "2005-02-28", "General", "Male", "Delhi", "Class XII Science", 500000.0, 1, "FLAGGED", None),
        # Unverified APAAR ID (Ends with 999)
        ("100000000999", "Vikram Singh", "2004-12-10", "General", "Male", "Haryana", "Class XII Science", 400000.0, 0, "UNVERIFIED", None),
    ]

    # Fill up to 30 students (100000000008 is UNENROLLED, along with 100000000009-30)
    for i in range(8, 31):
        apaar = f"1000000000{i:02d}"
        gender = "Female" if i % 2 == 0 else "Male"
        cat = "General" if i % 3 == 0 else ("OBC" if i % 3 == 1 else "SC")
        students.append((
            apaar, f"Student Test {i}", "2005-01-01", cat, gender, "Delhi", "Class XII", 350000.0 + (i * 10000), 1, "UNENROLLED", None
        ))

    cursor.executemany("INSERT INTO students (apaar_id, name, dob, category, gender, domicile, prior_qualification, family_income, consent, enrollment_status, institute_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", students)


    # 6. Enrollments
    enrollments = [
        ("ENR_01", "100000000001", "INST_DEL_01", "B.Tech", 2, "regular", "ACTIVE", "2025-08-01", None),
        ("ENR_02", "100000000002", "INST_DEL_01", "B.Tech", 2, "regular", "ACTIVE", "2025-08-01", None),
        ("ENR_03", "100000000003", "INST_MH_04", "B.Tech", 1, "regular", "ACTIVE", "2026-08-01", None),
        ("ENR_04", "100000000004", "INST_KA_03", "B.Tech", 2, "lateral", "ACTIVE", "2026-08-01", None),
        ("ENR_05", "100000000005", "INST_DEL_01", "B.Tech", 1, "regular", "ACTIVE", "2026-08-01", None),
    ]
    cursor.executemany("INSERT INTO enrollments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", enrollments)

    # 7. Attendance Summaries
    att_summaries = [
        ("100000000001", "2026-10", 22, 24, 91.6), # Clean 91.6%
        ("100000000002", "2026-10", 15, 24, 62.5), # Low 62.5% (<75%)
        ("100000000003", "2026-10", 21, 24, 87.5),
        ("100000000004", "2026-10", 23, 24, 95.8),
        ("100000000005", "2026-10", 0, 24, 0.0),   # 0% Ghost attendance
    ]
    cursor.executemany("INSERT INTO attendance_summaries VALUES (?, ?, ?, ?, ?)", att_summaries)

    # 8. Academic Credits (ABC)
    credits = [
        ("CR_01", "100000000004", "Applied Mathematics & Mechanics", 8, "State Board of Tech Ed", "2031-06-30"),
        ("CR_02", "100000000004", "Data Structures with C++", 6, "State Board of Tech Ed", "2031-06-30"),
        ("CR_03", "100000000001", "Object Oriented Programming", 4, "INST_DEL_01", "2032-06-30")
    ]
    cursor.executemany("INSERT INTO academic_credit_ledger VALUES (?, ?, ?, ?, ?, ?)", credits)

    # 9. Audit Chain Genesis
    prev_hash = "0000000000000000000000000000000000000000000000000000000000000000"
    payload = json.dumps({"event": "GENESIS_SEED", "source": "SIH_2026_SEEDER"}, sort_keys=True)
    genesis_hash = hashlib.sha256(f"{prev_hash}{payload}".encode()).hexdigest()
    cursor.execute(
        "INSERT INTO audit_log (id, actor, action, record_id, payload, prev_hash, hash, timestamp) VALUES (1, ?, ?, ?, ?, ?, ?, ?)",
        ("SYSTEM_SEEDER", "GENESIS_INITIALIZE", "GENESIS", payload, prev_hash, genesis_hash, datetime.utcnow().isoformat())
    )

    conn.commit()
    conn.close()
    print("Database schema successfully seeded with deterministic demonstration personas.")

if __name__ == "__main__":
    seed_master_data()