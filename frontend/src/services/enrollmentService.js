import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { apiFetch } from './apiClient';

const STORAGE_KEY = 'my_aapar_mock_requests';
const STUDENT_OVERRIDES_KEY = 'my_aapar_student_overrides';

export function getStudentOverrides() {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(STUDENT_OVERRIDES_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
  }
  return {};
}

export function saveStudentOverride(apaarId, data) {
  if (typeof window !== 'undefined' && apaarId) {
    try {
      const current = getStudentOverrides();
      current[String(apaarId)] = { ...(current[String(apaarId)] || {}), ...data };
      localStorage.setItem(STUDENT_OVERRIDES_KEY, JSON.stringify(current));
    } catch {}
  }
}

export function loadStoredRequests() {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
  }
  return [
    {
      request_id: "REQ_INIT_08",
      id: "REQ_INIT_08",
      type: "join",
      apaar_id: "100000000008",
      from_inst: null,
      to_inst: "INST_DEL_01",
      state: "SUBMITTED",
      program: "B.Tech",
      year: 1,
      created_at: new Date(Date.now() - 3600000).toISOString()
    }
  ];
}

// In-memory + localStorage fallback request storage for standalone/offline demo resilience
export const mockRequests = loadStoredRequests();

export function persistMockRequests(list = mockRequests) {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {}
  }
}

export async function getEnrollmentRequests(instituteId = null) {
  let remoteList = [];

  // 1. Try FastAPI backend first (local or live)
  try {
    const url = `/enrollment/requests${instituteId ? `?institute_id=${instituteId}` : ''}`;
    const data = await apiFetch(url);
    if (Array.isArray(data) && data.length > 0) {
      remoteList = data;
    }
  } catch {}

  // 2. Try Supabase if configured and remoteList is empty
  if (remoteList.length === 0 && isSupabaseConfigured) {
    try {
      let query = supabase.from('requests').select('*').order('created_at', { ascending: false });
      if (instituteId) {
        query = query.or(`to_inst.eq.${instituteId},from_inst.eq.${instituteId}`);
      }
      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        remoteList = data.map(r => ({
          request_id: r.id,
          id: r.id,
          type: r.type,
          apaar_id: r.apaar_id,
          from_inst: r.from_inst,
          to_inst: r.to_inst,
          state: r.state,
          created_at: r.created_at,
          ...(r.details_json || {})
        }));
      }
    } catch (e) {
      console.warn("Supabase getRequests notice:", e.message);
    }
  }

  // 3. Always merge remote records with local storage records
  const byId = new Map();
  remoteList.forEach(r => {
    const key = r.request_id || r.id;
    if (key) byId.set(String(key), r);
  });

  const stored = loadStoredRequests();
  stored.forEach(r => {
    const key = r.request_id || r.id;
    if (key) {
      const existing = byId.get(String(key)) || {};
      byId.set(String(key), { ...existing, ...r });
    }
  });

  const merged = Array.from(byId.values());
  if (instituteId) {
    return merged.filter(r => r.to_inst === instituteId || r.from_inst === instituteId);
  }
  return merged;
}

export async function submitEnrollmentRequest({ apaar_id, institute_id, program = "B.Tech", year = 1, type = "join", target_institute_id = null }) {
  const to_inst = type === "transfer" ? target_institute_id : institute_id;
  const from_inst = type === "transfer" ? institute_id : null;
  const requestId = `REQ_${Date.now()}`;
  const details_json = { program, year };

  const newReq = {
    request_id: requestId,
    id: requestId,
    type,
    apaar_id: String(apaar_id),
    from_inst,
    to_inst,
    state: "SUBMITTED",
    program,
    year,
    created_at: new Date().toISOString()
  };

  // Immediate local persistence guarantees the request is visible instantly across all roles
  const currentStored = loadStoredRequests().filter(r => (r.request_id || r.id) !== requestId);
  currentStored.unshift(newReq);
  mockRequests.length = 0;
  mockRequests.push(...currentStored);
  persistMockRequests(currentStored);

  // Fallback to FastAPI via intelligent dual-base fetch
  try {
    const apiRes = await apiFetch('/enrollment/request', {
      method: "POST",
      body: JSON.stringify({ apaar_id: String(apaar_id), institute_id, program, year, type, target_institute_id })
    });
    if (apiRes && apiRes.request_id) {
      newReq.id = apiRes.request_id;
      newReq.request_id = apiRes.request_id;
      const updated = currentStored.map(r => r.id === requestId ? { ...r, id: apiRes.request_id, request_id: apiRes.request_id } : r);
      mockRequests.length = 0;
      mockRequests.push(...updated);
      persistMockRequests(updated);
    }
    return apiRes;
  } catch (err) {
    if (err.message && (err.message.includes('seats are full') || err.message.includes('not eligible') || err.message.includes('SEATS_FULL') || err.message.includes('INELIGIBLE'))) {
      throw err;
    }
  }

  // Try Supabase directly
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('requests')
        .insert({
          id: requestId,
          type,
          apaar_id: String(apaar_id),
          from_inst,
          to_inst,
          state: 'SUBMITTED',
          details_json,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (!error && data) {
        try {
          await supabase.rpc('record_audit_event', {
            p_actor: `STUDENT_${apaar_id}`,
            p_action: `REQUEST_${type.toUpperCase()}_SUBMITTED`,
            p_record_id: requestId,
            p_payload: { apaar_id, type, to_inst, from_inst, program, year }
          });
        } catch {}

        return {
          status: "SUCCESS",
          request_id: requestId,
          message: `${type.toUpperCase()} request created and submitted for verification`,
          state: "SUBMITTED"
        };
      }
    } catch (e) {
      console.warn("Supabase submitRequest notice:", e.message);
    }
  }

  // Resilient offline / demo in-memory fallback
  return {
    status: "SUCCESS",
    request_id: requestId,
    message: `${type.toUpperCase()} request created and submitted to institute queue.`,
    state: "SUBMITTED"
  };
}

export async function processEnrollmentRequest(arg1, arg2 = "APPROVE") {
  const { request_id, action = "APPROVE" } = typeof arg1 === "object" && arg1 !== null
    ? arg1
    : { request_id: arg1, action: arg2 };
  // If Supabase is configured, try direct database operations with business rules
  if (isSupabaseConfigured) {
    try {
      const { data: req, error: reqErr } = await supabase
        .from('requests')
        .select('*')
        .eq('id', request_id)
        .single();

      if (!reqErr && req) {
        const studentApaar = req.apaar_id;
        const targetInst = req.to_inst || req.from_inst;
        const newStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";

        // Check if student has duplicate active enrollment
        if (action === "APPROVE") {
          const { data: activeEnr } = await supabase
            .from('enrollments')
            .select('*')
            .eq('apaar_id', studentApaar)
            .eq('status', 'ACTIVE')
            .maybeSingle();

          if (activeEnr && req.type !== "transfer") {
            throw new Error(`DUPLICATE ENROLLMENT REJECTED: Multi-college dual active admissions are strictly prohibited. Currently active at ${activeEnr.institute_id}`);
          }

          // Lateral entry qualification check
          if (req.type === "lateral") {
            const { data: st } = await supabase
              .from('students')
              .select('prior_qualification')
              .eq('apaar_id', studentApaar)
              .single();
            if (!st?.prior_qualification?.toLowerCase().includes('diploma')) {
              throw new Error("LATERAL ELIGIBILITY FAILED: Recognized State/AICTE Diploma certificate is required for direct 2nd-year admission.");
            }
          }

          // If transfer, close old enrollment
          if (req.type === "transfer" && req.from_inst) {
            await supabase
              .from('enrollments')
              .update({ status: 'TRANSFERRED_OUT', end_date: new Date().toISOString().split('T')[0] })
              .eq('apaar_id', studentApaar)
              .eq('institute_id', req.from_inst)
              .eq('status', 'ACTIVE');
          }

          // Create active enrollment
          const enrollmentId = `ENR_${Date.now()}`;
          await supabase.from('enrollments').insert({
            id: enrollmentId,
            apaar_id: studentApaar,
            institute_id: targetInst,
            program: req.details_json?.program || 'B.Tech',
            year: req.details_json?.year || (req.type === 'lateral' ? 2 : 1),
            entry_type: req.type,
            status: 'ACTIVE',
            start_date: new Date().toISOString().split('T')[0]
          });

          // Update capacity counter
          try {
            const { data: cap } = await supabase
              .from('capacity')
              .select('verified_students')
              .eq('institute_id', targetInst)
              .eq('academic_year', '2026-27')
              .maybeSingle();
            if (cap) {
              await supabase
                .from('capacity')
                .update({ verified_students: (cap.verified_students || 0) + 1 })
                .eq('institute_id', targetInst)
                .eq('academic_year', '2026-27');
            }
          } catch {}

          // Record audit log
          try {
            await supabase.rpc('record_audit_event', {
              p_actor: `ADMIN_${targetInst}`,
              p_action: `ENROLLMENT_${req.type.toUpperCase()}_APPROVED`,
              p_record_id: enrollmentId,
              p_payload: { apaar_id: studentApaar, institute_id: targetInst, request_id }
            });
          } catch {}

          await supabase.from('requests').update({ state: newStatus }).eq('id', request_id);

          return {
            status: "SUCCESS",
            message: `Request approved. Active enrollment created.`,
            enrollment_id: enrollmentId,
            new_state: newStatus
          };
        } else {
          await supabase.from('requests').update({ state: newStatus }).eq('id', request_id);
          return { status: "SUCCESS", message: `Request ${action}`, new_state: newStatus };
        }
      }
    } catch (e) {
      console.warn("Supabase processRequest notice:", e.message);
      if (e.message?.includes("REJECTED") || e.message?.includes("FAILED")) throw e;
    }
  }

  // Fallback to FastAPI via intelligent dual-base fetch
  try {
    const apiRes = await apiFetch('/enrollment/process-request', {
      method: "POST",
      body: JSON.stringify({ request_id, action })
    });
    // Update local storage and overrides
    const current = loadStoredRequests();
    const target = current.find(r => r.id === request_id || r.request_id === request_id);
    if (target) {
      target.state = action === "APPROVE" ? "APPROVED" : "REJECTED";
      if (action === "APPROVE") {
        saveStudentOverride(target.apaar_id, {
          status: "ACTIVE",
          institute_id: target.to_inst || target.from_inst
        });
      }
    }
    mockRequests.length = 0;
    mockRequests.push(...current);
    persistMockRequests(current);
    return apiRes;
  } catch (err) {
    if (err.message && (err.message.includes('ALREADY_PROCESSED') || err.message.includes('0 available seats') || err.message.includes('SEATS_FULL'))) {
      throw err;
    }
  }

  // Resilient offline / demo in-memory fallback
  const current = loadStoredRequests();
  const targetReq = current.find(r => r.id === request_id || r.request_id === request_id);
  if (targetReq) {
    targetReq.state = action === "APPROVE" ? "APPROVED" : "REJECTED";
    if (action === "APPROVE") {
      saveStudentOverride(targetReq.apaar_id, {
        status: "ACTIVE",
        institute_id: targetReq.to_inst || targetReq.from_inst
      });
    }
  }
  mockRequests.length = 0;
  mockRequests.push(...current);
  persistMockRequests(current);
  return {
    status: "SUCCESS",
    message: `Request ${action === "APPROVE" ? "approved" : "rejected"}. Enrollment status updated.`,
    new_state: action === "APPROVE" ? "APPROVED" : "REJECTED"
  };
}

