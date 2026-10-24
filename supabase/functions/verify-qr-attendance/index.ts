import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { createHmacSha256, timingSafeEqualHex } from "../_shared/crypto.ts";

interface ScanRequest {
  signed_token: string;
  scanner_institute_id: string;
  device_id?: string;
}

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { signed_token, scanner_institute_id, device_id = "SCANNER_TERMINAL_01" }: ScanRequest =
      await req.json();

    if (!signed_token || !scanner_institute_id) {
      return new Response(
        JSON.stringify({ status: "REJECTED", reason: "Missing token or institute identifier" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parts = signed_token.split(":");
    if (parts.length !== 7) {
      return new Response(
        JSON.stringify({ status: "REJECTED", reason: "Malformed attendance QR token format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [apaar_hash, enrollment_id, token_inst_id, issued_at_str, expires_at_str, nonce, signature] = parts;
    const payload = `${apaar_hash}:${enrollment_id}:${token_inst_id}:${issued_at_str}:${expires_at_str}:${nonce}`;

    const secretKey = Deno.env.get("QR_HMAC_SECRET_KEY") || "sih-2026-apaar-verify-secret-key-mock";
    const fullExpectedSig = await createHmacSha256(secretKey, payload);
    const expectedSigPrefix = fullExpectedSig.substring(0, 16);

    const isSigValid = await timingSafeEqualHex(signature, expectedSigPrefix);
    if (!isSigValid) {
      return new Response(
        JSON.stringify({ status: "REJECTED", reason: "Cryptographic signature mismatch or token tampered" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = parseInt(expires_at_str, 10);
    if (now > expiresAt) {
      return new Response(
        JSON.stringify({ status: "REJECTED", reason: "QR token has expired. Request fresh rotating code." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (token_inst_id !== scanner_institute_id) {
      return new Response(
        JSON.stringify({
          status: "REJECTED",
          reason: `Institution mismatch: Token issued for ${token_inst_id}, scanned at ${scanner_institute_id}`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: enrollment, error: enrError } = await supabase
      .from("enrollments")
      .select("apaar_id, status")
      .eq("id", enrollment_id)
      .single();

    if (enrError || !enrollment || enrollment.status !== "ACTIVE") {
      return new Response(
        JSON.stringify({ status: "REJECTED", reason: "Student enrollment is inactive or unverified" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    let actorId = "00000000-0000-0000-0000-000000000000";
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (user?.id) actorId = user.id;
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc("record_qr_attendance", {
      p_apaar_id: enrollment.apaar_id,
      p_scanner_institute_id: scanner_institute_id,
      p_nonce: nonce,
      p_device_id: device_id,
      p_actor_auth_id: actorId,
    });

    if (rpcError) {
      return new Response(
        JSON.stringify({ status: "REJECTED", reason: rpcError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(rpcResult), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal Server Error";
    return new Response(JSON.stringify({ status: "ERROR", error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
