import { supabase, isSupabaseConfigured } from '../lib/supabase';

const rawApiBase = import.meta.env.VITE_API_BASE || "https://sih-9phl.onrender.com";
const API_BASE = rawApiBase.replace(/\/+$/, "");
const SECRET_KEY = "sih-2026-apaar-verify-secret-key-mock";

// Helper: crypto SHA256 & HMAC in browser
async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Prefix(key, message, length = 16) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.substring(0, length);
}

export async function getAttendanceQR(apaarId) {
  // 1. Check active enrollment in Supabase
  if (isSupabaseConfigured) {
    try {
      const { data: enr, error } = await supabase
        .from('enrollments')
        .select('id, institute_id, status')
        .eq('apaar_id', apaarId)
        .eq('status', 'ACTIVE')
        .maybeSingle();

      if (!error && enr) {
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + 30;
        const nonce = Math.random().toString(36).substring(2, 10);
        const apaarHash = (await sha256Hex(apaarId)).substring(0, 12);
        const payload = `${apaarHash}:${enr.id}:${enr.institute_id}:${now}:${expiresAt}:${nonce}`;
        const signature = await hmacSha256Prefix(SECRET_KEY, payload, 16);
        const signedToken = `${payload}:${signature}`;

        return {
          status: "SUCCESS",
          signed_token: signedToken,
          expires_in_seconds: 30,
          institute_id: enr.institute_id,
          enrollment_id: enr.id,
          source: "supabase_client"
        };
      }
    } catch (e) {
      console.warn("Supabase QR generation notice:", e.message);
    }
  }

  // 2. Fallback to FastAPI
  const res = await fetch(`${API_BASE}/attendance/qr/${apaarId}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Unable to generate signed QR token");
  }
  return await res.json();
}

export async function recordAttendanceScan({ signed_token, scanner_institute_id, device_id = "SCANNER_TERMINAL_01" }) {
  // 1. Try Supabase record_qr_attendance RPC
  if (isSupabaseConfigured) {
    try {
      const parts = signed_token.split(":");
      if (parts.length === 7) {
        const [apaar_hash, enrollment_id, token_inst_id, issued_at_str, expires_at_str, nonce, signature] = parts;
        const payload = `${apaar_hash}:${enrollment_id}:${token_inst_id}:${issued_at_str}:${expires_at_str}:${nonce}`;
        const expectedSig = await hmacSha256Prefix(SECRET_KEY, payload, 16);

        if (signature !== expectedSig) {
          throw new Error("Tampered or invalid token signature. Cryptographic verification failed.");
        }

        const now = Math.floor(Date.now() / 1000);
        if (now > parseInt(expires_at_str, 10)) {
          throw new Error("Token expired. Personal attendance QR expires every 30s.");
        }

        if (token_inst_id !== scanner_institute_id) {
          throw new Error(`CROSS-COLLEGE REJECTION: Token issued for ${token_inst_id}, scanner is at ${scanner_institute_id}`);
        }

        // Fetch enrollment to get apaar_id
        const { data: enr } = await supabase
          .from('enrollments')
          .select('apaar_id, status')
          .eq('id', enrollment_id)
          .single();

        if (enr && enr.status === 'ACTIVE') {
          const { data: rpcRes, error: rpcErr } = await supabase.rpc('record_qr_attendance', {
            p_actor_auth_id: '00000000-0000-0000-0000-000000000000',
            p_apaar_id: enr.apaar_id,
            p_device_id: device_id,
            p_nonce: nonce,
            p_scanner_institute_id: scanner_institute_id
          });

          if (!rpcErr && rpcRes) {
            return rpcRes;
          }
        }
      }
    } catch (e) {
      console.warn("Supabase record_qr_attendance notice:", e.message);
      if (e.message?.includes("Tampered") || e.message?.includes("expired") || e.message?.includes("CROSS-COLLEGE")) {
        throw e;
      }
    }
  }

  // 2. Fallback to FastAPI
  const res = await fetch(`${API_BASE}/attendance/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signed_token, scanner_institute_id, device_id })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Attendance recording rejected");
  }
  return await res.json();
}

