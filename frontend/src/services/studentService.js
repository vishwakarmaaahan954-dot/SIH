import { supabase, isSupabaseConfigured } from '../lib/supabase.js';
import { DEMO_PERSONAS } from './authService.js';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || "http://localhost:8000";

export const COMPREHENSIVE_STUDENT_DATA = {
  "100000000001": {
    apaar_id: "100000000001",
    name: "Priya Sharma",
    dob: "2005-04-12",
    category: "General",
    gender: "Female",
    domicile: "Delhi",
    prior_qualification: "Class XII Science (CBSE 94.2%)",
    family_income: 450000,
    consent: true,
    is_identity_verified: true,
    institute_id: "INST_DEL_01",
    institute_name: "Delhi Engineering & Technology Institute",
    program: "B.Tech Computer Science & Engineering",
    year: 2,
    status: "ACTIVE",
    enrollment: {
      id: "ENR_01",
      program: "B.Tech Computer Science & Engineering",
      year: 2,
      entry_type: "regular",
      status: "ACTIVE",
      start_date: "2025-08-01"
    },
    attendance: { days_present: 22, days_held: 24, attendance_pct: 91.6, month: "2026-10" },
    credits: [
      { course: "Object Oriented Programming (Java/C++)", credits: 4, source_institute: "Delhi Engineering & Technology Institute", valid_till: "2032-06-30" },
      { course: "Discrete Mathematical Structures", credits: 4, source_institute: "Delhi Engineering & Technology Institute", valid_till: "2032-06-30" },
      { course: "Digital Logic Design & Microprocessors", credits: 4, source_institute: "Delhi Engineering & Technology Institute", valid_till: "2032-06-30" }
    ],
    results: [
      { semester: "Semester 1", sgpa: "8.85", cgpa: "8.85", credits_earned: 22, status: "PASSED" },
      { semester: "Semester 2", sgpa: "9.20", cgpa: "9.02", credits_earned: 24, status: "PASSED" }
    ]
  },
  "100000000002": {
    apaar_id: "100000000002",
    name: "Rohan Verma",
    dob: "2004-09-21",
    category: "OBC",
    gender: "Male",
    domicile: "Uttar Pradesh",
    prior_qualification: "Class XII Science (UP Board 81.0%)",
    family_income: 320000,
    consent: true,
    is_identity_verified: true,
    institute_id: "INST_DEL_01",
    institute_name: "Delhi Engineering & Technology Institute",
    program: "B.Tech Mechanical Engineering",
    year: 2,
    status: "ACTIVE",
    enrollment: {
      id: "ENR_02",
      program: "B.Tech Mechanical Engineering",
      year: 2,
      entry_type: "regular",
      status: "ACTIVE",
      start_date: "2025-08-01"
    },
    attendance: { days_present: 15, days_held: 24, attendance_pct: 62.5, month: "2026-10" },
    credits: [
      { course: "Engineering Thermodynamics", credits: 4, source_institute: "Delhi Engineering & Technology Institute", valid_till: "2032-06-30" },
      { course: "Strength of Materials", credits: 4, source_institute: "Delhi Engineering & Technology Institute", valid_till: "2032-06-30" }
    ],
    results: [
      { semester: "Semester 1", sgpa: "7.40", cgpa: "7.40", credits_earned: 20, status: "PASSED" },
      { semester: "Semester 2", sgpa: "7.10", cgpa: "7.25", credits_earned: 20, status: "PASSED" }
    ]
  },
  "100000000003": {
    apaar_id: "100000000003",
    name: "Ananya Deshmukh",
    dob: "2005-01-15",
    category: "General",
    gender: "Female",
    domicile: "Maharashtra",
    prior_qualification: "Class XII Science (HSC 89.5%)",
    family_income: 1200000,
    consent: true,
    is_identity_verified: true,
    institute_id: "INST_MH_04",
    institute_name: "Maharashtra Institute of Information Tech",
    program: "B.Tech Information Technology",
    year: 1,
    status: "ACTIVE",
    enrollment: {
      id: "ENR_03",
      program: "B.Tech Information Technology",
      year: 1,
      entry_type: "regular",
      status: "ACTIVE",
      start_date: "2026-08-01"
    },
    attendance: { days_present: 21, days_held: 24, attendance_pct: 87.5, month: "2026-10" },
    credits: [
      { course: "Programming with Python & Computational Thinking", credits: 4, source_institute: "Maharashtra Institute of Information Tech", valid_till: "2033-06-30" },
      { course: "Calculus & Linear Algebra", credits: 4, source_institute: "Maharashtra Institute of Information Tech", valid_till: "2033-06-30" }
    ],
    results: [
      { semester: "Semester 1 (Mid-Term)", sgpa: "8.60", cgpa: "8.60", credits_earned: 12, status: "IN_PROGRESS" }
    ]
  },
  "100000000004": {
    apaar_id: "100000000004",
    name: "Karthik Rajan",
    dob: "2003-11-05",
    category: "OBC",
    gender: "Male",
    domicile: "Karnataka",
    prior_qualification: "Polytechnic Diploma in CS (DTE Karnataka 88.0%)",
    family_income: 280000,
    consent: true,
    is_identity_verified: true,
    institute_id: "INST_KA_03",
    institute_name: "Bangalore College of Advanced Computing",
    program: "B.Tech Computer Science (Lateral Entry)",
    year: 2,
    status: "ACTIVE",
    enrollment: {
      id: "ENR_04",
      program: "B.Tech Computer Science (Lateral Entry)",
      year: 2,
      entry_type: "lateral",
      status: "ACTIVE",
      start_date: "2026-08-01"
    },
    attendance: { days_present: 23, days_held: 24, attendance_pct: 95.8, month: "2026-10" },
    credits: [
      { course: "Applied Mathematics & Mechanics", credits: 8, source_institute: "State Board of Technical Education", valid_till: "2031-06-30" },
      { course: "Data Structures with C++", credits: 6, source_institute: "State Board of Technical Education", valid_till: "2031-06-30" },
      { course: "Computer Architecture & Organization", credits: 4, source_institute: "Bangalore College of Advanced Computing", valid_till: "2032-06-30" }
    ],
    results: [
      { semester: "Diploma Cumulative (Transferred)", sgpa: "8.80", cgpa: "8.80", credits_earned: 48, status: "TRANSFER_APPROVED" },
      { semester: "B.Tech Sem 3", sgpa: "9.10", cgpa: "9.10", credits_earned: 22, status: "PASSED" }
    ]
  },
  "100000000005": {
    apaar_id: "100000000005",
    name: "Suresh Kumar",
    dob: "2004-07-19",
    category: "SC",
    gender: "Male",
    domicile: "Delhi",
    prior_qualification: "Class XII Science",
    family_income: 180000,
    consent: true,
    is_identity_verified: true,
    institute_id: "INST_DEL_01",
    institute_name: "Delhi Engineering & Technology Institute",
    program: "B.Tech Civil Engineering",
    year: 1,
    status: "ACTIVE",
    enrollment: {
      id: "ENR_05",
      program: "B.Tech Civil Engineering",
      year: 1,
      entry_type: "regular",
      status: "ACTIVE",
      start_date: "2026-08-01"
    },
    attendance: { days_present: 0, days_held: 24, attendance_pct: 0.0, month: "2026-10" },
    credits: [],
    results: []
  },
  "100000000008": {
    apaar_id: "100000000008",
    name: "Student Test 08",
    dob: "2005-01-01",
    category: "General",
    gender: "Female",
    domicile: "Delhi",
    prior_qualification: "Class XII Science",
    family_income: 430000,
    consent: true,
    is_identity_verified: true,
    institute_id: "None",
    institute_name: "Unenrolled (Fresh Applicant)",
    program: "Pending Admission",
    year: 0,
    status: "UNENROLLED",
    enrollment: null,
    attendance: { days_present: 0, days_held: 0, attendance_pct: 0.0 },
    credits: [],
    results: []
  },
  "100000000888": {
    apaar_id: "100000000888",
    name: "Aarav Gupta",
    dob: "2005-02-28",
    category: "General",
    gender: "Male",
    domicile: "Delhi",
    prior_qualification: "Class XII Science",
    family_income: 500000,
    consent: true,
    is_identity_verified: false,
    institute_id: "None",
    institute_name: "Identity Mismatch (Flagged)",
    program: "None",
    year: 0,
    status: "FLAGGED",
    enrollment: null,
    attendance: { days_present: 0, days_held: 0, attendance_pct: 0.0 },
    credits: [],
    results: []
  },
  "100000000999": {
    apaar_id: "100000000999",
    name: "Vikram Singh",
    dob: "2004-12-10",
    category: "General",
    gender: "Male",
    domicile: "Haryana",
    prior_qualification: "Class XII Science",
    family_income: 400000,
    consent: false,
    is_identity_verified: false,
    institute_id: "None",
    institute_name: "Unverified / Suspended",
    program: "None",
    year: 0,
    status: "UNVERIFIED",
    enrollment: null,
    attendance: { days_present: 0, days_held: 0, attendance_pct: 0.0 },
    credits: [],
    results: []
  }
};

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

        // Fetch latest attendance summary safely
        const { data: attRows } = await supabase
          .from('attendance_summary')
          .select('*')
          .eq('apaar_id', apaarId)
          .order('month', { ascending: false })
          .limit(1);
        const attSummary = attRows && attRows.length > 0 ? attRows[0] : null;

        // Fetch credits
        const { data: credits } = await supabase
          .from('credit_ledger')
          .select('*')
          .eq('apaar_id', apaarId);

        // Fetch results if table exists
        let results = [];
        try {
          const { data: resData } = await supabase
            .from('results')
            .select('*')
            .eq('apaar_id', apaarId);
          if (resData) results = resData;
        } catch (e) {}

        const fallback = COMPREHENSIVE_STUDENT_DATA[apaarId] || {};

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
          institute_id: enrollment?.institute_id || fallback.institute_id || 'None',
          institute_name: enrollment?.institutes?.name || fallback.institute_name || 'Unenrolled',
          program: enrollment?.program || fallback.program || 'B.Tech Technical Program',
          year: enrollment?.year || fallback.year || 1,
          enrollment: enrollment || fallback.enrollment || null,
          status: enrollment?.status || fallback.status || (apaarId.endsWith('888') ? 'FLAGGED' : (apaarId.endsWith('999') ? 'UNVERIFIED' : 'UNENROLLED')),
          attendance: attSummary || fallback.attendance || { days_present: 0, days_held: 0, attendance_pct: 0 },
          credits: (credits && credits.length > 0) ? credits : (fallback.credits || []),
          results: (results && results.length > 0) ? results : (fallback.results || []),
          _source: 'supabase'
        };
      }
    } catch (err) {
      console.warn("Supabase student fetch notice:", err.message);
    }
  }

  // 2. High-fidelity Comprehensive Persona Fallback
  if (COMPREHENSIVE_STUDENT_DATA[apaarId]) {
    return {
      ...COMPREHENSIVE_STUDENT_DATA[apaarId],
      _source: 'comprehensive_fallback'
    };
  }

  // 4. Generic synthetic demo persona fallback
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
      institute_name: demo.inst === 'INST_DEL_01' ? 'Delhi Engineering & Technology Institute' : (demo.inst === 'INST_MH_04' ? 'Maharashtra Institute of Information Tech' : (demo.inst === 'INST_KA_03' ? 'Bangalore College of Advanced Computing' : 'Unenrolled')),
      program: "B.Tech Technical Program",
      year: 1,
      status: demo.status,
      attendance: { days_present: 22, days_held: 24, attendance_pct: demo.apaar_id === "100000000002" ? 62.5 : (demo.apaar_id === "100000000005" ? 0 : 91.6) },
      credits: [],
      results: [],
      _source: 'local_persona'
    };
  }

  return null;
}

