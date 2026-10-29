import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { apiFetch } from './apiClient';

export const FALLBACK_INSTITUTES = [
  { id: "INST_DEL_01", aicte_code: "1-1001", name: "Delhi Engineering & Technology Institute", sanctioned_intake: 120, verified_students: 118, available_seats: 2, state: "Delhi" },
  { id: "INST_UP_02", aicte_code: "1-1002", name: "National Institute of Applied Sciences", sanctioned_intake: 100, verified_students: 95, available_seats: 5, state: "Uttar Pradesh" },
  { id: "INST_KA_03", aicte_code: "1-1003", name: "Bangalore College of Advanced Computing", sanctioned_intake: 60, verified_students: 45, available_seats: 15, state: "Karnataka" },
  { id: "INST_MH_04", aicte_code: "1-1004", name: "Maharashtra Institute of Information Tech", sanctioned_intake: 120, verified_students: 100, available_seats: 20, state: "Maharashtra" },
  { id: "INST_TN_05", aicte_code: "1-1005", name: "Chennai Autonomous Engineering College", sanctioned_intake: 100, verified_students: 20, available_seats: 80, state: "Tamil Nadu" },
  { id: "INST_FULL_06", aicte_code: "1-1006", name: "Apex Institute of Advanced Engineering", sanctioned_intake: 50, verified_students: 50, available_seats: 0, state: "Maharashtra" },
];

export async function getInstitutes() {
  let rawList = null;

  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('institutions')
        .select('*')
        .order('id');
      if (!error && data && data.length > 0) {
        rawList = data;
      }
    } catch (e) {
      console.warn("Supabase getInstitutes notice:", e.message);
    }
  }

  if (!rawList) {
    try {
      const apiData = await apiFetch('/institutions');
      if (Array.isArray(apiData) && apiData.length > 0) {
        rawList = apiData;
      }
    } catch {}
  }

  if (!rawList || rawList.length === 0) {
    return FALLBACK_INSTITUTES;
  }

  // Merge with FALLBACK_INSTITUTES so capacity & available seats are guaranteed
  return rawList.map(inst => {
    const fallback = FALLBACK_INSTITUTES.find(f => f.id === inst.id) || {};
    const intake = inst.sanctioned_intake ?? fallback.sanctioned_intake ?? 100;
    const verified = inst.verified_students ?? fallback.verified_students ?? 0;
    const avail = inst.available_seats !== undefined
      ? inst.available_seats
      : (fallback.available_seats !== undefined ? fallback.available_seats : Math.max(0, intake - verified));

    return {
      ...fallback,
      ...inst,
      sanctioned_intake: intake,
      verified_students: verified,
      available_seats: avail,
      empty_seats: avail,
      state: inst.state || fallback.state || "National"
    };
  });
}

export async function getInstituteSeats(instId) {
  try {
    return await apiFetch(`/institutions/${instId}/seats`);
  } catch {}

  const inst = FALLBACK_INSTITUTES.find(i => i.id === instId);
  if (inst) {
    const empty_seats = Math.max(0, (inst.sanctioned_intake || 0) - (inst.verified_students || 0));
    return {
      institute_id: inst.id,
      aicte_code: inst.aicte_code,
      name: inst.name,
      sanctioned_intake: inst.sanctioned_intake,
      verified_students: inst.verified_students,
      available_seats: empty_seats,
      empty_seats: empty_seats,
      is_full: empty_seats === 0
    };
  }
  return null;
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
    return await apiFetch('/aicte/compliance-overview');
  } catch {}

  return [
    { institute_id: "INST_DEL_01", institute_name: "Delhi Engineering & Technology Institute", state: "Delhi", program: "B.Tech", sanctioned_intake: 120, verified_students: 118, faculty_fte: 8, occupancy_pct: 98.3, faculty_student_ratio: "14.75:1", ratio_breach: false, under_filled: false, compliance_status: "COMPLIANT" },
    { institute_id: "INST_UP_02", institute_name: "National Institute of Applied Sciences", state: "Uttar Pradesh", program: "B.Tech", sanctioned_intake: 100, verified_students: 95, faculty_fte: 3, occupancy_pct: 95.0, faculty_student_ratio: "31.67:1", ratio_breach: true, under_filled: false, compliance_status: "NON_COMPLIANT_RATIO" },
    { institute_id: "INST_KA_03", institute_name: "Bangalore College of Advanced Computing", state: "Karnataka", program: "B.Tech", sanctioned_intake: 60, verified_students: 45, faculty_fte: 5, occupancy_pct: 75.0, faculty_student_ratio: "9.00:1", ratio_breach: false, under_filled: false, compliance_status: "COMPLIANT" },
    { institute_id: "INST_MH_04", institute_name: "Maharashtra Institute of Information Tech", state: "Maharashtra", program: "B.Tech", sanctioned_intake: 120, verified_students: 100, faculty_fte: 10, occupancy_pct: 83.3, faculty_student_ratio: "10.00:1", ratio_breach: false, under_filled: false, compliance_status: "COMPLIANT" },
    { institute_id: "INST_TN_05", institute_name: "Chennai Autonomous Engineering College", state: "Tamil Nadu", program: "B.Tech", sanctioned_intake: 100, verified_students: 20, faculty_fte: 6, occupancy_pct: 20.0, faculty_student_ratio: "3.33:1", ratio_breach: false, under_filled: true, compliance_status: "UNDER_FILLED" }
  ];
}

