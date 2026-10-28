import { supabase, isSupabaseConfigured } from '../lib/supabase';

const rawApiBase = import.meta.env.VITE_API_BASE || "https://sih-9phl.onrender.com";
const API_BASE = rawApiBase.replace(/\/+$/, "");

export async function getGrievances(apaarId = null) {
  if (isSupabaseConfigured) {
    try {
      let query = supabase.from('grievances').select('*').order('created_at', { ascending: false });
      if (apaarId) query = query.eq('apaar_id', apaarId);
      const { data, error } = await query;
      if (!error && data) return data;
    } catch (e) {
      console.warn("Supabase getGrievances notice:", e.message);
    }
  }

  try {
    const res = await fetch(`${API_BASE}/grievances`);
    if (res.ok) return await res.json();
  } catch {}

  return [];
}

export async function fileGrievance({ apaar_id, issue }) {
  if (isSupabaseConfigured) {
    try {
      const gId = `GRV_${Date.now()}`;
      const { data, error } = await supabase.from('grievances').insert({
        id: gId,
        apaar_id,
        issue,
        status: 'SUBMITTED',
        created_at: new Date().toISOString()
      }).select().single();

      if (!error && data) {
        try {
          await supabase.rpc('record_audit_event', {
            p_actor: `STUDENT_${apaar_id}`,
            p_action: 'GRIEVANCE_FILED',
            p_record_id: gId,
            p_payload: { apaar_id, issue }
          });
        } catch {}
        return data;
      }
    } catch (e) {
      console.warn("Supabase fileGrievance notice:", e.message);
    }
  }

  const res = await fetch(`${API_BASE}/grievances`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apaar_id, issue })
  });
  if (!res.ok) throw new Error("Failed to submit grievance");
  return await res.json();
}

export async function resolveGrievance({ grievance_id, resolution, assigned_to = "AICTE_COMPLIANCE_CELL" }) {
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase.from('grievances').update({
        status: 'RESOLVED',
        resolution,
        assigned_to,
        resolved_at: new Date().toISOString()
      }).eq('id', grievance_id).select().single();

      if (!error && data) {
        try {
          await supabase.rpc('record_audit_event', {
            p_actor: assigned_to,
            p_action: 'GRIEVANCE_RESOLVED',
            p_record_id: grievance_id,
            p_payload: { resolution }
          });
        } catch {}
        return data;
      }
    } catch (e) {
      console.warn("Supabase resolveGrievance notice:", e.message);
    }
  }

  const res = await fetch(`${API_BASE}/grievances/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grievance_id, resolution })
  });
  if (!res.ok) throw new Error("Failed to resolve grievance");
  return await res.json();
}

