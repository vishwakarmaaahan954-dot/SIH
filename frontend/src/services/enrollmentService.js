import { supabase, isSupabaseConfigured } from '../lib/supabase';

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export async function getEnrollmentRequests(instituteId = null) {
  if (isSupabaseConfigured) {
    try {
      let query = supabase.from('requests').select('*').order('created_at', { ascending: false });
      if (instituteId) {
        query = query.or(`to_inst.eq.${instituteId},from_inst.eq.${instituteId}`);
      }
      const { data, error } = await query;
      if (!error && data) {
        return data.map(r => ({
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

  try {
    const res = await fetch(`${API_BASE}/enrollment/requests`);
    if (res.ok) return await res.json();
  } catch (e) {}

  return [];
}

export async function submitEnrollmentRequest({ apaar_id, institute_id, program = "B.Tech", year = 1, type = "join", target_institute_id = null }) {
  const to_inst = type === "transfer" ? target_institute_id : institute_id;
  const from_inst = type === "transfer" ? institute_id : null;
  const requestId = `REQ_${Date.now()}`;
  const details_json = { program, year };

  // Try Supabase directly
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('requests')
        .insert({
          id: requestId,
          type,
          apaar_id,
          from_inst,
          to_inst,
          state: 'SUBMITTED',
          details_json,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (!error && data) {
        // Record audit log
        try {
          await supabase.rpc('record_audit_event', {
            p_actor: `STUDENT_${apaar_id}`,
            p_action: `REQUEST_${type.toUpperCase()}_SUBMITTED`,
            p_record_id: requestId,
            p_payload: { apaar_id, type, to_inst, from_inst, program, year }
          });
        } catch (auditErr) {}

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

  // Fallback to FastAPI
  const res = await fetch(`${API_BASE}/enrollment/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apaar_id, institute_id, program, year, type, target_institute_id })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Request submission failed");
  }
  return await res.json();
}

export async function processEnrollmentRequest({ request_id, action = "APPROVE" }) {
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
          } catch (capErr) {}

          // Record audit log
          try {
            await supabase.rpc('record_audit_event', {
              p_actor: `ADMIN_${targetInst}`,
              p_action: `ENROLLMENT_${req.type.toUpperCase()}_APPROVED`,
              p_record_id: enrollmentId,
              p_payload: { apaar_id: studentApaar, institute_id: targetInst, request_id }
            });
          } catch (e) {}

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

  // Fallback to FastAPI
  const res = await fetch(`${API_BASE}/enrollment/process-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id, action })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Request processing failed");
  }
  return await res.json();
}

