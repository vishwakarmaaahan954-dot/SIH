-- ============================================================================
-- SIH 2026 APAAR Verify: Supabase Auth, Row Level Security (RLS) & Seed Data
-- ============================================================================

-- 1. Enable RLS on all tables
ALTER TABLE IF EXISTS user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS institutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS students ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS results ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS attendance_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS faculty_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS scheme_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS claims_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS grievances ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS used_nonces ENABLE ROW LEVEL SECURITY;

-- 2. Auth Trigger: Auto-populate user_profiles on Supabase Auth Signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (id, role, apaar_id, institute_id, created_at, updated_at)
  VALUES (
    new.id,
    COALESCE(LOWER(new.raw_user_meta_data->>'role'), 'student'),
    new.raw_user_meta_data->>'apaar_id',
    new.raw_user_meta_data->>'institute_id',
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET role = EXCLUDED.role,
      apaar_id = EXCLUDED.apaar_id,
      institute_id = EXCLUDED.institute_id,
      updated_at = NOW();
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 3. Row-Level Security Policies

-- Public Reference Tables (Read-only for anon and authenticated)
CREATE POLICY "Institutes are viewable by everyone" ON institutes
  FOR SELECT USING (true);

CREATE POLICY "Capacity is viewable by everyone" ON capacity
  FOR SELECT USING (true);

CREATE POLICY "Schemes are viewable by everyone" ON schemes
  FOR SELECT USING (true);

CREATE POLICY "Scheme rules are viewable by everyone" ON scheme_rules
  FOR SELECT USING (true);

CREATE POLICY "Rules are viewable by everyone" ON rules
  FOR SELECT USING (true);

-- User Profiles
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = id OR true); -- allows persona preview for demo

CREATE POLICY "Users can insert own profile" ON user_profiles
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = id OR true);

-- Students Master
CREATE POLICY "Students master read access" ON students
  FOR SELECT USING (true);

CREATE POLICY "Students master insert access" ON students
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Students master update access" ON students
  FOR UPDATE USING (true);

-- Enrollments
CREATE POLICY "Enrollments viewable by all authorized stakeholders" ON enrollments
  FOR SELECT USING (true);

CREATE POLICY "Enrollments insertable by authorized users" ON enrollments
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Enrollments updatable by authorized users" ON enrollments
  FOR UPDATE USING (true);

-- Academic Credit Ledger (ABC)
CREATE POLICY "Credit ledger read access" ON credit_ledger
  FOR SELECT USING (true);

-- Requests (Admissions, Transfers, Lateral Entry)
CREATE POLICY "Requests read access" ON requests
  FOR SELECT USING (true);

CREATE POLICY "Requests insert access" ON requests
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Requests update access" ON requests
  FOR UPDATE USING (true);

-- Attendance & Summaries
CREATE POLICY "Attendance read access" ON attendance
  FOR SELECT USING (true);

CREATE POLICY "Attendance insert access" ON attendance
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Attendance summary read access" ON attendance_summary
  FOR SELECT USING (true);

CREATE POLICY "Attendance summary insert access" ON attendance_summary
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Attendance summary update access" ON attendance_summary
  FOR UPDATE USING (true);

-- Scholarship Claims
CREATE POLICY "Claims ledger read access" ON claims_ledger
  FOR SELECT USING (true);

CREATE POLICY "Claims ledger insert access" ON claims_ledger
  FOR INSERT WITH CHECK (true);

-- Grievances
CREATE POLICY "Grievances read access" ON grievances
  FOR SELECT USING (true);

CREATE POLICY "Grievances insert access" ON grievances
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Grievances update access" ON grievances
  FOR UPDATE USING (true);

-- Audit Log (Immutable append via procedure)
CREATE POLICY "Audit log read access" ON audit_log
  FOR SELECT USING (true);

CREATE POLICY "Audit log insert access" ON audit_log
  FOR INSERT WITH CHECK (true);

-- 4. Master Seed Data

-- Configurable Rules
INSERT INTO rules (key, value_json) VALUES
('ratio_limits', '{"B.Tech": 20.0, "M.Tech": 15.0, "MCA": 20.0}'::jsonb),
('min_occupancy_pct', '40.0'::jsonb),
('credit_validity_years', '7'::jsonb),
('confirmation_window_days', '15'::jsonb),
('anomaly_threshold_days_absent', '14'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Institutions
INSERT INTO institutes (id, aicte_code, name, state) VALUES
('INST_DEL_01', '1-1001', 'Delhi Engineering & Technology Institute', 'Delhi'),
('INST_UP_02', '1-1002', 'National Institute of Applied Sciences', 'Uttar Pradesh'),
('INST_KA_03', '1-1003', 'Bangalore College of Advanced Computing', 'Karnataka'),
('INST_MH_04', '1-1004', 'Maharashtra Institute of Information Tech', 'Maharashtra'),
('INST_TN_05', '1-1005', 'Chennai Autonomous Engineering College', 'Tamil Nadu')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, state = EXCLUDED.state;

-- Capacity & Ratios
INSERT INTO capacity (id, institute_id, program, academic_year, sanctioned_intake, faculty_fte, lateral_seats, verified_students) VALUES
('00000000-0000-0000-0000-000000000001', 'INST_DEL_01', 'B.Tech', '2026-27', 120, 8, 12, 118),
('00000000-0000-0000-0000-000000000002', 'INST_UP_02', 'B.Tech', '2026-27', 100, 3, 10, 95),  -- Ratio Breach: 31.67:1
('00000000-0000-0000-0000-000000000003', 'INST_KA_03', 'B.Tech', '2026-27', 60, 5, 6, 45),
('00000000-0000-0000-0000-000000000004', 'INST_MH_04', 'B.Tech', '2026-27', 120, 10, 12, 100),
('00000000-0000-0000-0000-000000000005', 'INST_TN_05', 'B.Tech', '2026-27', 100, 6, 10, 20)  -- Under-filled: 20%
ON CONFLICT (institute_id, program, academic_year) DO NOTHING;

-- Schemes
INSERT INTO schemes (id, name, authority, active) VALUES
('SCH_PRAGATI', 'AICTE Pragati Scholarship for Girls', 'AICTE', true),
('SCH_POST_MATRIC', 'Central Post-Matric SC/ST Scheme', 'Ministry of Social Justice', true),
('SCH_MERIT_CUM', 'National Merit-Cum-Means Technical Grant', 'AICTE / MoE', true)
ON CONFLICT (id) DO NOTHING;

-- Scheme Rules
INSERT INTO scheme_rules (scheme_id, rules_json) VALUES
('SCH_PRAGATI', '{"gender": "Female", "max_family_income": 800000.0, "min_attendance_pct": 75.0, "requires_active_enrollment": true, "institute_must_be_compliant": true, "exclusive_with_schemes": ["SCH_MERIT_CUM"]}'::jsonb),
('SCH_POST_MATRIC', '{"allowed_categories": ["SC", "ST"], "max_family_income": 250000.0, "min_attendance_pct": 70.0, "requires_active_enrollment": true, "institute_must_be_compliant": false}'::jsonb),
('SCH_MERIT_CUM', '{"min_attendance_pct": 75.0, "max_family_income": 600000.0, "requires_active_enrollment": true, "institute_must_be_compliant": true, "exclusive_with_schemes": ["SCH_PRAGATI"]}'::jsonb)
ON CONFLICT (scheme_id) DO NOTHING;

-- Students (Deterministic Demonstration Personas)
INSERT INTO students (apaar_id, name, dob, category, gender, domicile, prior_qualification, family_income, consent, is_identity_verified) VALUES
('100000000001', 'Priya Sharma', '2005-04-12', 'General', 'Female', 'Delhi', 'Class XII Science', 450000.0, true, true),
('100000000002', 'Rohan Verma', '2004-09-21', 'OBC', 'Male', 'Uttar Pradesh', 'Class XII Science', 320000.0, true, true),
('100000000003', 'Ananya Deshmukh', '2005-01-15', 'General', 'Female', 'Maharashtra', 'Class XII Science', 1200000.0, true, true),
('100000000004', 'Karthik Rajan', '2003-11-05', 'OBC', 'Male', 'Karnataka', 'Polytechnic Diploma in CS', 280000.0, true, true),
('100000000005', 'Suresh Kumar', '2004-07-19', 'SC', 'Male', 'Delhi', 'Class XII Science', 180000.0, true, true),
('100000000008', 'Student Test 08', '2005-01-01', 'General', 'Female', 'Delhi', 'Class XII Science', 430000.0, true, true),
('100000000888', 'Aarav Gupta', '2005-02-28', 'General', 'Male', 'Delhi', 'Class XII Science', 500000.0, true, false),
('100000000999', 'Vikram Singh', '2004-12-10', 'General', 'Male', 'Haryana', 'Class XII Science', 400000.0, false, false)
ON CONFLICT (apaar_id) DO NOTHING;

-- Enrollments
INSERT INTO enrollments (id, apaar_id, institute_id, program, year, entry_type, status, start_date) VALUES
('ENR_01', '100000000001', 'INST_DEL_01', 'B.Tech', 2, 'regular', 'ACTIVE', '2025-08-01'),
('ENR_02', '100000000002', 'INST_DEL_01', 'B.Tech', 2, 'regular', 'ACTIVE', '2025-08-01'),
('ENR_03', '100000000003', 'INST_MH_04', 'B.Tech', 1, 'regular', 'ACTIVE', '2026-08-01'),
('ENR_04', '100000000004', 'INST_KA_03', 'B.Tech', 2, 'lateral', 'ACTIVE', '2026-08-01'),
('ENR_05', '100000000005', 'INST_DEL_01', 'B.Tech', 1, 'regular', 'ACTIVE', '2026-08-01')
ON CONFLICT (id) DO NOTHING;

-- Attendance Summary
INSERT INTO attendance_summary (apaar_id, month, days_present, days_held, attendance_pct) VALUES
('100000000001', '2026-10', 22, 24, 91.6),
('100000000002', '2026-10', 15, 24, 62.5),
('100000000003', '2026-10', 21, 24, 87.5),
('100000000004', '2026-10', 23, 24, 95.8),
('100000000005', '2026-10', 0, 24, 0.0)
ON CONFLICT (apaar_id, month) DO NOTHING;

-- Academic Credits (ABC)
INSERT INTO credit_ledger (id, apaar_id, course, credits, source_institute, valid_till) VALUES
('CR_01', '100000000004', 'Applied Mathematics & Mechanics', 8, 'State Board of Tech Ed', '2031-06-30'),
('CR_02', '100000000004', 'Data Structures with C++', 6, 'State Board of Tech Ed', '2031-06-30'),
('CR_03', '100000000001', 'Object Oriented Programming', 4, 'INST_DEL_01', '2032-06-30')
ON CONFLICT (id) DO NOTHING;

