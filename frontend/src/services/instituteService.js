import { supabase, isSupabaseConfigured } from '../lib/supabase';

const rawApiBase = import.meta.env.VITE_API_BASE || "https://sih-9phl.onrender.com";
const API_BASE = rawApiBase.replace(/\/+$/, "");

const FALLBACK_INSTITUTES = [
  { id: "INST_DEL_01", aicte_code: "1-1001", name: "Delhi Engineering & Technology Institute", state: "Delhi" },
  { id: "INST_UP_02", aicte_code: "1-1002", name: "National Institute of Applied Sciences", state: "Uttar Pradesh" },
  { id: "INST_KA_03", aicte_code: "1-1003", name: "Bangalore College of Advanced Computing", state: "Karnataka" },
  { id: "INST_MH_04", aicte_code: "1-1004", name: "Maharashtra Institute of Information Tech", state: "Maharashtra" },
  { id: "INST_TN_05", aicte_code: "1-1005", name: "Chennai Autonomous Engineering College", state: "Tamil Nadu" },
];

export async function getInstitutes() {
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('institutes')
        .select('*')
        .order('id');
      if (!error && data && data.length > 0) {
        return data;
      }
    } catch (e) {
      console.warn("Supabase getInstitutes notice:", e.message);
    }
  }

  try {
    const res = await fetch(`${API_BASE}/institutions`);
    if (res.ok) {
      return await res.json();
    }
  } catch {}

  return FALLBACK_INSTITUTES;
}

export async function getComplianceOverview() {
  if (isSupabaseConfigured) {
    try {
      const { data: capacities, error } = await supabase
        .from('capacity')
        .select('*, institutes(*)');
      
      if (!error && capacities && capacities.length > 0) {
        return capacities.map(c => {
          const occupancy_pct = c.sanctioned_intake > 0 
            ? ((c.verified_students / c.sanctioned_intake) * 100).toFixed(1) 
            : 0;
          const faculty_student_ratio = c.faculty_fte > 0 
            ? (c.verified_students / c.faculty_fte).toFixed(2) 
            : "0.00";
          const ratio_breach = parseFloat(faculty_student_ratio) > 20.0;
          const under_filled = parseFloat(occupancy_pct) < 40.0;

          return {
            institute_id: c.institute_id,
            institute_name: c.institutes?.name || c.institute_id,
            state: c.institutes?.state || "Unknown",
            program: c.program,
            academic_year: c.academic_year,
            sanctioned_intake: c.sanctioned_intake,
            verified_students: c.verified_students,
            faculty_fte: c.faculty_fte,
            occupancy_pct: parseFloat(occupancy_pct),
            faculty_student_ratio: `${faculty_student_ratio}:1`,
            ratio_breach,
            under_filled,
            compliance_status: ratio_breach ? "NON_COMPLIANT_RATIO" : (under_filled ? "UNDER_FILLED" : "COMPLIANT")
          };
        });
      }
    } catch (e) {
      console.warn("Supabase compliance fetch notice:", e.message);
    }
  }

  try {
    const res = await fetch(`${API_BASE}/aicte/compliance-overview`);
    if (res.ok) return await res.json();
  } catch {}

  return [
    { institute_id: "INST_DEL_01", institute_name: "Delhi Engineering & Technology Institute", state: "Delhi", program: "B.Tech", sanctioned_intake: 120, verified_students: 118, faculty_fte: 8, occupancy_pct: 98.3, faculty_student_ratio: "14.75:1", ratio_breach: false, under_filled: false, compliance_status: "COMPLIANT" },
    { institute_id: "INST_UP_02", institute_name: "National Institute of Applied Sciences", state: "Uttar Pradesh", program: "B.Tech", sanctioned_intake: 100, verified_students: 95, faculty_fte: 3, occupancy_pct: 95.0, faculty_student_ratio: "31.67:1", ratio_breach: true, under_filled: false, compliance_status: "NON_COMPLIANT_RATIO" },
    { institute_id: "INST_KA_03", institute_name: "Bangalore College of Advanced Computing", state: "Karnataka", program: "B.Tech", sanctioned_intake: 60, verified_students: 45, faculty_fte: 5, occupancy_pct: 75.0, faculty_student_ratio: "9.00:1", ratio_breach: false, under_filled: false, compliance_status: "COMPLIANT" },
    { institute_id: "INST_MH_04", institute_name: "Maharashtra Institute of Information Tech", state: "Maharashtra", program: "B.Tech", sanctioned_intake: 120, verified_students: 100, faculty_fte: 10, occupancy_pct: 83.3, faculty_student_ratio: "10.00:1", ratio_breach: false, under_filled: false, compliance_status: "COMPLIANT" },
    { institute_id: "INST_TN_05", institute_name: "Chennai Autonomous Engineering College", state: "Tamil Nadu", program: "B.Tech", sanctioned_intake: 100, verified_students: 20, faculty_fte: 6, occupancy_pct: 20.0, faculty_student_ratio: "3.33:1", ratio_breach: false, under_filled: true, compliance_status: "UNDER_FILLED" }
  ];
}

