import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { DEMO_PERSONAS } from './authService';

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const SECRET_KEY = "sih-2026-apaar-verify-secret-key-mock";

export const DEFAULT_SCHEME_RULES = {
  SCH_PRAGATI: {
    gender: "Female",
    max_family_income: 800000.0,
    min_attendance_pct: 75.0,
    requires_active_enrollment: true,
    exclusive_with_schemes: ["SCH_MERIT_CUM"]
  },
  SCH_POST_MATRIC: {
    allowed_categories: ["SC", "ST"],
    max_family_income: 250000.0,
    min_attendance_pct: 70.0,
    requires_active_enrollment: true
  },
  SCH_MERIT_CUM: {
    min_attendance_pct: 75.0,
    max_family_income: 600000.0,
    requires_active_enrollment: true,
    exclusive_with_schemes: ["SCH_PRAGATI"]
  }
};

export const DEFAULT_PERSONA_ATTENDANCE = {
  "100000000001": 91.6,
  "100000000002": 62.5,
  "100000000003": 87.5,
  "100000000004": 95.8,
  "100000000005": 0.0,
  "100000000008": 80.0,
  "100000000888": 78.0,
  "100000000999": 45.0
};

export const FALLBACK_SCHEMES = [
  { id: 'SCH_PRAGATI', name: 'AICTE Pragati Scholarship for Girls', authority: 'AICTE', active: true },
  { id: 'SCH_POST_MATRIC', name: 'Central Post-Matric SC/ST Scheme', authority: 'Ministry of Social Justice', active: true },
  { id: 'SCH_MERIT_CUM', name: 'National Merit-Cum-Means Technical Grant', authority: 'AICTE / MoE', active: true }
];

export const SCHEME_METADATA = {
  SCH_PRAGATI: {
    amount: "₹50,000",
    frequency: "per annum",
    target_group: "Female Technical Scholars",
    description: "Financial assistance to girl students admitted to technical degree/diploma programs to encourage female leadership in STEM.",
    disbursal_channel: "Direct Benefit Transfer (DBT) via Aadhaar Payment Bridge (APBS)",
    ministry_badge: "AICTE / MoE Special Scheme"
  },
  SCH_POST_MATRIC: {
    amount: "₹25,000",
    frequency: "per annum",
    target_group: "SC & ST Technical Students",
    description: "Post-matriculation scholarship providing tuition and maintenance aid for economically disadvantaged Scheduled Caste/Tribe scholars.",
    disbursal_channel: "Direct Benefit Transfer (DBT) via Public Financial Management System (PFMS)",
    ministry_badge: "Ministry of Social Justice & Empowerment"
  },
  SCH_MERIT_CUM: {
    amount: "₹40,000",
    frequency: "per annum",
    target_group: "Merit-cum-Means Technical Students",
    description: "Merit-linked financial grant awarded to technical scholars maintaining verified institution attendance (≥75%) and academic standing.",
    disbursal_channel: "Direct Benefit Transfer (DBT) via AICTE Central Fund",
    ministry_badge: "AICTE Merit Welfare Cell"
  }
};

async function hmacSha256(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function evaluateSchemes(apaarId, overrideAttendance) {
  let student = null;
  let schemes = null;
  let enr = null;
  let att = null;
  let claims = [];

  // 1. Attempt Supabase live database queries
  if (isSupabaseConfigured) {
    try {
      const { data: sData } = await supabase.from('students').select('*').eq('apaar_id', apaarId).maybeSingle();
      student = sData;

      const { data: scData } = await supabase.from('schemes').select('*, scheme_rules(*)').eq('active', true);
      if (scData && scData.length > 0) schemes = scData;

      const { data: enrRows } = await supabase.from('enrollments').select('*').eq('apaar_id', apaarId).eq('status', 'ACTIVE').limit(1);
      if (enrRows && enrRows.length > 0) enr = enrRows[0];

      const { data: attRows } = await supabase.from('attendance_summary').select('attendance_pct').eq('apaar_id', apaarId).order('month', { ascending: false }).limit(1);
      if (attRows && attRows.length > 0) att = attRows[0];

      const { data: clmData } = await supabase.from('claims_ledger').select('*').eq('apaar_id', apaarId).eq('status', 'DISBURSED');
      if (clmData) claims = clmData;
    } catch (e) {
      console.warn("Supabase fetch notice in evaluateSchemes:", e.message);
    }
  }

  // 2. Resolve effective student identity (from DB or DEMO_PERSONAS)
  let effectiveStudent = student;
  const persona = DEMO_PERSONAS.find(p => p.apaar_id === apaarId);
  if (!effectiveStudent) {
    if (persona) {
      effectiveStudent = {
        apaar_id: persona.apaar_id,
        name: persona.name,
        gender: persona.gender,
        category: persona.cat || "General",
        family_income: parseFloat(String(persona.income).replace(/[^0-9.]/g, '')) || 450000,
        consent: true,
        is_identity_verified: true
      };
    } else {
      effectiveStudent = {
        apaar_id: apaarId,
        name: "Enrolled Student",
        gender: "Female",
        category: "General",
        family_income: 450000,
        consent: true,
        is_identity_verified: true
      };
    }
  }

  // 3. Resolve effective enrollment
  const effectiveEnr = enr || (persona?.inst && persona.inst !== "None" ? { institute_id: persona.inst, status: "ACTIVE" } : null);

  // 4. Resolve effective attendance percentage
  let attendancePct;
  if (overrideAttendance !== undefined && overrideAttendance !== null) {
    attendancePct = Number(overrideAttendance);
  } else if (att && att.attendance_pct !== undefined && att.attendance_pct !== null) {
    attendancePct = Number(att.attendance_pct);
  } else {
    const personaAtt = DEFAULT_PERSONA_ATTENDANCE[apaarId];
    attendancePct = personaAtt !== undefined ? personaAtt : 88.0;
  }

  // 5. Resolve schemes list
  const effectiveSchemes = (schemes && schemes.length > 0) ? schemes : FALLBACK_SCHEMES;
  const disbursedIds = new Set((claims || []).map(c => c.scheme_id));

  // 6. Evaluate each scheme
  const evaluations = [];
  for (const s of effectiveSchemes) {
    // Extract rules whether scheme_rules is an array or object
    let rules = Array.isArray(s.scheme_rules)
      ? (s.scheme_rules[0]?.rules_json || {})
      : (s.scheme_rules?.rules_json || {});

    // Fall back to default rules if database scheme_rules table was empty
    if (!rules || Object.keys(rules).length === 0) {
      rules = DEFAULT_SCHEME_RULES[s.id] || {};
    }

    const checks = [];

    // Check 1: Active enrollment
    const enrPassed = !rules.requires_active_enrollment || !!effectiveEnr;
    checks.push({
      rule: "Active Enrollment in AICTE Approved Program",
      passed: enrPassed,
      detail: effectiveEnr ? `Active at ${effectiveEnr.institute_id}` : "No active admission record found"
    });

    // Check 2: Gender criteria
    if (rules.gender) {
      const genPassed = (effectiveStudent.gender || '').toLowerCase() === rules.gender.toLowerCase();
      checks.push({
        rule: `Eligible Gender: ${rules.gender} Only`,
        passed: genPassed,
        detail: `Candidate demographic gender: ${effectiveStudent.gender || 'Not specified'}`
      });
    }

    // Check 3: Social category criteria
    if (rules.allowed_categories && rules.allowed_categories.length > 0) {
      const catPassed = rules.allowed_categories.map(c => c.toUpperCase()).includes((effectiveStudent.category || '').toUpperCase());
      checks.push({
        rule: `Target Category: ${rules.allowed_categories.join(', ')}`,
        passed: catPassed,
        detail: `Candidate registered category: ${effectiveStudent.category || 'General'}`
      });
    }

    // Check 4: Family income ceiling
    if (rules.max_family_income) {
      const incomeNum = Number(effectiveStudent.family_income) || 0;
      const incPassed = incomeNum <= rules.max_family_income;
      checks.push({
        rule: `Annual Family Income <= ₹${rules.max_family_income.toLocaleString('en-IN')}`,
        passed: incPassed,
        detail: `Verified family income: ₹${incomeNum.toLocaleString('en-IN')}`
      });
    }

    // Check 5: Verified monthly attendance cutoff
    if (rules.min_attendance_pct) {
      const attPassed = attendancePct >= rules.min_attendance_pct;
      checks.push({
        rule: `Minimum Verified Attendance: ${rules.min_attendance_pct}%`,
        passed: attPassed,
        detail: `Current monthly attendance: ${attendancePct.toFixed(1)}%`
      });
    }

    // Check 6: Exclusivity with other grants
    if (rules.exclusive_with_schemes && rules.exclusive_with_schemes.length > 0) {
      const conflictingClaim = (claims || []).find(c => rules.exclusive_with_schemes.includes(c.scheme_id));
      checks.push({
        rule: "Exclusive Benefit (No Conflicting Active Grant)",
        passed: !conflictingClaim,
        detail: conflictingClaim ? `Conflicting claim detected for ${conflictingClaim.scheme_id}` : "No conflicting scholarship claims in ledger"
      });
    }

    // Check 7: No duplicate claims in current cycle
    const alreadyClaimed = disbursedIds.has(s.id);
    checks.push({
      rule: "No Prior Benefit Claimed for Current Cycle",
      passed: !alreadyClaimed,
      detail: alreadyClaimed ? "Benefit already disbursed to student account" : "No conflicting prior claim recorded"
    });

    const isEligible = checks.every(c => c.passed);
    let token = null;
    if (isEligible) {
      const exp = Math.floor(Date.now() / 1000) + 300;
      const sig = await hmacSha256(SECRET_KEY, `${apaarId}|${s.id}|${exp}`);
      token = `${apaarId}|${s.id}|${exp}|${sig}`;
    }

    const meta = SCHEME_METADATA[s.id] || {
      amount: "₹35,000",
      frequency: "per annum",
      target_group: "Eligible Technical Scholars",
      description: "Government-approved higher technical education grant.",
      disbursal_channel: "Direct Benefit Transfer (DBT)",
      ministry_badge: s.authority
    };
    const claimRecord = (claims || []).find(c => c.scheme_id === s.id);

    evaluations.push({
      scheme_id: s.id,
      scheme_name: s.name,
      authority: s.authority,
      status: alreadyClaimed ? "DISBURSED" : (isEligible ? "ELIGIBLE" : "INELIGIBLE"),
      already_claimed: alreadyClaimed,
      claim_record: claimRecord || null,
      amount: meta.amount,
      frequency: meta.frequency,
      target_group: meta.target_group,
      description: meta.description,
      disbursal_channel: meta.disbursal_channel,
      ministry_badge: meta.ministry_badge,
      checks,
      eligibility_token: token
    });
  }

  return evaluations;
}

export async function disburseScholarship({ apaar_id, scheme_id, eligibility_token }) {
  if (isSupabaseConfigured) {
    try {
      const parts = eligibility_token.split("|");
      if (parts.length === 4) {
        const [tokApaar, tokScheme, expStr, sig] = parts;
        const expectedSig = await hmacSha256(SECRET_KEY, `${tokApaar}|${tokScheme}|${expStr}`);

        if (sig !== expectedSig) {
          throw new Error("DISBURSAL REJECTED: Cryptographic token tampered or invalid");
        }

        if (Math.floor(Date.now() / 1000) > parseInt(expStr, 10)) {
          throw new Error("DISBURSAL REJECTED: Eligibility token expired; re-evaluation required");
        }

        // Commit to claims_ledger
        const claimId = `CLM_${Date.now()}`;
        const { data: claim, error: clmErr } = await supabase.from('claims_ledger').insert({
          id: claimId,
          apaar_id,
          scheme_id,
          status: 'DISBURSED',
          timestamp: new Date().toISOString()
        }).select().single();

        // Audit log
        try {
          await supabase.rpc('record_audit_event', {
            p_actor: 'SCHOLARSHIP_DISBURSAL_GATE',
            p_action: 'BENEFIT_DISBURSED',
            p_record_id: claimId,
            p_payload: { apaar_id, scheme_id, status: 'DISBURSED' }
          });
        } catch (e) {}

        return {
          status: "SUCCESS",
          message: "Scholarship benefit disbursed successfully to student verified Aadhaar-linked account",
          claim_id: claimId
        };
      }
    } catch (e) {
      console.warn("Supabase disbursal notice:", e.message);
      if (e.message?.includes("REJECTED")) throw e;
    }
  }

  const res = await fetch(`${API_BASE}/schemes/disburse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apaar_id, scheme_id, eligibility_token })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Disbursal request failed");
  }
  return await res.json();
}

