import { supabase, isSupabaseConfigured } from '../lib/supabase';

export const DEMO_PERSONAS = [
  { apaar_id: "100000000001", name: "Priya Sharma", role: "Student", tag: "Eligible for Pragati (91.6% Att)", income: "₹4,50,000", cat: "General", gender: "Female", inst: "INST_DEL_01", status: "ACTIVE", email: "priya.sharma@sih2026.edu" },
  { apaar_id: "100000000002", name: "Rohan Verma", role: "Student", tag: "Low Attendance (62.5% < 75%)", income: "₹3,20,000", cat: "OBC", gender: "Male", inst: "INST_DEL_01", status: "ACTIVE", email: "rohan.verma@sih2026.edu" },
  { apaar_id: "100000000003", name: "Ananya Deshmukh", role: "Student", tag: "High Family Income (₹12 Lakhs)", income: "₹12,00,000", cat: "General", gender: "Female", inst: "INST_MH_04", status: "ACTIVE", email: "ananya.deshmukh@sih2026.edu" },
  { apaar_id: "100000000004", name: "Karthik Rajan", role: "Student", tag: "Diploma Holder (Lateral Entry)", income: "₹2,80,000", cat: "OBC", gender: "Male", inst: "INST_KA_03", status: "ACTIVE", email: "karthik.rajan@sih2026.edu" },
  { apaar_id: "100000000005", name: "Suresh Kumar", role: "Student", tag: "Ghost Student Candidate (0 Scans)", income: "₹1,80,000", cat: "SC", gender: "Male", inst: "INST_DEL_01", status: "ACTIVE", email: "suresh.kumar@sih2026.edu" },
  { apaar_id: "100000000008", name: "Student Test 08", role: "Student", tag: "New Applicant (No Active College)", income: "₹4,30,000", cat: "General", gender: "Female", inst: "None", status: "UNENROLLED", email: "student08@sih2026.edu" },
  { apaar_id: "100000000888", name: "Aarav Gupta", role: "Student", tag: "Name/DOB Mismatch Flagged", income: "₹5,00,000", cat: "General", gender: "Male", inst: "None", status: "FLAGGED", email: "aarav.gupta@sih2026.edu" },
  { apaar_id: "100000000999", name: "Vikram Singh", role: "Student", tag: "Suspended / Unverified APAAR", income: "₹4,00,000", cat: "General", gender: "Male", inst: "None", status: "UNVERIFIED", email: "vikram.singh@sih2026.edu" },
  { apaar_id: null, name: "Dr. Arvind Mehta", role: "Institute Admin", tag: "Delhi Engineering & Tech", institute_id: "INST_DEL_01", inst: "INST_DEL_01", status: "ACTIVE", email: "admin@delhieng.sih2026.edu" },
  { apaar_id: null, name: "Prof. S. R. Raman", role: "AICTE Officer", tag: "Central Compliance Officer", institute_id: null, inst: "AICTE HQ", status: "ACTIVE", email: "officer@aicte.sih2026.edu" },
];

/**
 * Get current authenticated session from Supabase
 */
export async function getSession() {
  if (!isSupabaseConfigured) return null;
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    console.error("Error fetching session:", error);
    return null;
  }
  return session;
}

/**
 * Fetch user profile from Supabase user_profiles table
 */
export async function getUserProfile(userId) {
  if (!isSupabaseConfigured || !userId) return null;
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.warn("Could not load user profile from Supabase:", error.message);
    return null;
  }
  return data;
}

/**
 * Sign in using Supabase Auth (Email + Password)
 */
export async function signIn(email, password) {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured. Check environment variables.");
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  
  // Load profile
  const profile = await getUserProfile(data.user?.id);
  return { user: data.user, session: data.session, profile };
}

/**
 * Sign up a new user and assign appropriate profile and student records
 */
export async function signUp({
  email,
  password,
  role = 'Student',
  apaar_id = null,
  institute_id = null,
  category = 'General',
  gender = 'Female',
  family_income = 450000,
  name = null
}) {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured.");
  }

  const cleanApaar = apaar_id ? String(apaar_id).trim() : null;
  const numIncome = parseFloat(family_income) || 0;
  const derivedName = name || (email ? email.split('@')[0].replace(/[._-]/g, ' ') : "Registered Student");

  // 1. Create Supabase Auth user
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: derivedName,
        role,
        apaar_id: cleanApaar,
        institute_id,
        category,
        gender,
        family_income: numIncome
      }
    }
  });

  if (error) throw error;

  // 2. If student identity with apaar_id, create or upsert record in students master table
  if (cleanApaar) {
    try {
      await supabase.from('students').upsert({
        apaar_id: cleanApaar,
        name: derivedName,
        dob: '2005-01-01',
        category: category || 'General',
        gender: gender || 'Female',
        domicile: 'Delhi',
        prior_qualification: 'Class XII Science',
        family_income: numIncome,
        consent: true,
        is_identity_verified: true
      });
    } catch (sErr) {
      console.warn("Student record upsert notice:", sErr);
    }
  }

  // 3. Insert into user_profiles
  if (data.user?.id) {
    try {
      await supabase.from('user_profiles').upsert({
        id: data.user.id,
        role: role.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        apaar_id: cleanApaar,
        institute_id: institute_id && institute_id !== 'None' ? institute_id : null,
        updated_at: new Date().toISOString()
      });
    } catch (profileErr) {
      console.warn("Profile upsert notice:", profileErr);
    }
  }

  // 4. If institute assigned and student has apaar_id, ensure enrollment & initial attendance record exist
  if (cleanApaar && institute_id && institute_id !== 'None') {
    try {
      const enrId = `ENR_${Date.now()}`;
      await supabase.from('enrollments').upsert({
        id: enrId,
        apaar_id: cleanApaar,
        institute_id: institute_id,
        program: 'B.Tech',
        year: 1,
        entry_type: 'regular',
        status: 'ACTIVE',
        start_date: new Date().toISOString().split('T')[0]
      });

      const currentMonth = new Date().toISOString().slice(0, 7);
      await supabase.from('attendance_summary').upsert({
        apaar_id: cleanApaar,
        month: currentMonth,
        days_present: 20,
        days_held: 22,
        attendance_pct: 90.9
      });
    } catch (enrErr) {
      console.warn("Enrollment / Attendance record init notice:", enrErr);
    }
  }

  return data;
}

/**
 * Sign out of current session
 */
export async function signOut() {
  if (isSupabaseConfigured) {
    await supabase.auth.signOut();
  }
}

/**
 * Subscribe to Auth State changes
 */
export function onAuthStateChange(callback) {
  if (!isSupabaseConfigured) return { data: { subscription: { unsubscribe: () => {} } } };
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}

