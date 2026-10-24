import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { DEMO_PERSONAS } from './authService';

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export async function getStudentProfile(apaarId) {
  if (!apaarId) return null;

  // 1. Try Supabase first
  if (isSupabaseConfigured) {
    try {
      const { data: student, error: studentErr } = await supabase
        .from('students')
        .select('*')
        .eq('apaar_id', apaarId)
        .maybeSingle();

      if (!studentErr && student) {
        // Fetch active enrollment
        const { data: enrollment } = await supabase
          .from('enrollments')
          .select('*, institutes(*)')
          .eq('apaar_id', apaarId)
          .eq('status', 'ACTIVE')
          .maybeSingle();

        // Fetch latest attendance summary
        const { data: attSummary } = await supabase
          .from('attendance_summary')
          .select('*')
          .eq('apaar_id', apaarId)
          .order('month', { ascending: false })
          .limit(1)
          .maybeSingle();

        // Fetch credits
        const { data: credits } = await supabase
          .from('credit_ledger')
          .select('*')
          .eq('apaar_id', apaarId);

        return {
          apaar_id: student.apaar_id,
          name: student.name,
          dob: student.dob,
          category: student.category,
          gender: student.gender,
          domicile: student.domicile,
          prior_qualification: student.prior_qualification,
          family_income: student.family_income,
          consent: student.consent,
          is_identity_verified: student.is_identity_verified,
          institute_id: enrollment?.institute_id || 'None',
          institute_name: enrollment?.institutes?.name || 'Unenrolled',
          enrollment: enrollment || null,
          status: enrollment?.status || (apaarId.endsWith('888') ? 'FLAGGED' : (apaarId.endsWith('999') ? 'UNVERIFIED' : 'UNENROLLED')),
          attendance: attSummary || { days_present: 0, days_held: 0, attendance_pct: 0 },
          credits: credits || [],
          _source: 'supabase'
        };
      }
    } catch (err) {
      console.warn("Supabase student fetch notice:", err.message);
    }
  }

  // 2. Fallback to API_BASE if backend is running
  try {
    const res = await fetch(`${API_BASE}/students/${apaarId}`);
    if (res.ok) {
      const data = await res.json();
      return { ...data, _source: 'fastapi' };
    }
  } catch (apiErr) {
    // API not reachable
  }

  // 3. Fallback to synthetic demo persona
  const demo = DEMO_PERSONAS.find(p => p.apaar_id === apaarId);
  if (demo) {
    return {
      apaar_id: demo.apaar_id,
      name: demo.name,
      dob: "2005-01-01",
      category: demo.cat,
      gender: demo.gender,
      domicile: "Delhi",
      prior_qualification: demo.apaar_id === "100000000004" ? "Polytechnic Diploma in CS" : "Class XII Science",
      family_income: parseFloat(demo.income.replace(/[^0-9]/g, '')) || 450000,
      consent: true,
      is_identity_verified: !demo.apaar_id.endsWith('888') && !demo.apaar_id.endsWith('999'),
      institute_id: demo.inst !== 'None' ? demo.inst : null,
      status: demo.status,
      attendance: { days_present: 22, days_held: 24, attendance_pct: demo.apaar_id === "100000000002" ? 62.5 : (demo.apaar_id === "100000000005" ? 0 : 91.6) },
      credits: demo.apaar_id === "100000000004" ? [
        { course: "Applied Mathematics", credits: 8, source_institute: "State Board of Tech Ed", valid_till: "2031-06-30" },
        { course: "Data Structures with C++", credits: 6, source_institute: "State Board of Tech Ed", valid_till: "2031-06-30" }
      ] : [],
      _source: 'local_persona'
    };
  }

  return null;
}

