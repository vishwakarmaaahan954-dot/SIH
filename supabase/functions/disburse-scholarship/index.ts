import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { createHmacSha256, timingSafeEqualHex } from "../_shared/crypto.ts";

interface DisbursePayload {
  apaar_id: string;
  scheme_id: string;
  eligibility_token: string;
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

    const { apaar_id, scheme_id, eligibility_token }: DisbursePayload = await req.json();

    if (!apaar_id || !scheme_id || !eligibility_token) {
      return new Response(
        JSON.stringify({ status: "REJECTED", reason: "Missing required disbursal parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parts = eligibility_token.split("|");
    if (parts.length !== 4) {
      return new Response(
        JSON.stringify({ status: "REJECTED", reason: "Malformed eligibility token structure" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [tokenApaar, tokenScheme, expiresAtStr, tokenSig] = parts;

    if (tokenApaar !== apaar_id || tokenScheme !== scheme_id) {
      return new Response(
        JSON.stringify({ status: "REJECTED", reason: "Token parameter mismatch against request target" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const secretKey = Deno.env.get("QR_HMAC_SECRET_KEY") || "sih-2026-apaar-verify-secret-key-mock";
    const expectedPayload = `${tokenApaar}|${tokenScheme}|${expiresAtStr}`;
    const expectedSig = await createHmacSha256(secretKey, expectedPayload);

    const isSigValid = await timingSafeEqualHex(tokenSig, expectedSig);
    if (!isSigValid) {
      return new Response(
        JSON.stringify({ status: "REJECTED", reason: "Eligibility token signature invalid or altered" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > parseInt(expiresAtStr, 10)) {
      return new Response(
        JSON.stringify({ status: "REJECTED", reason: "Eligibility token expired; re-evaluation required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const evalUrl = `${supabaseUrl}/functions/v1/evaluate-scholarship?apaar_id=${apaar_id}&scheme=${scheme_id}`;
    const reEvalResponse = await fetch(evalUrl, {
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    });

    if (!reEvalResponse.ok) {
      return new Response(
        JSON.stringify({ status: "REJECTED", reason: "Live criteria evaluation service failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const currentEval = await reEvalResponse.json();
    if (currentEval.status !== "ELIGIBLE") {
      return new Response(
        JSON.stringify({
          status: "REJECTED",
          reason: "Disbursal blocked: Real-time criteria drift detected. Student is no longer eligible.",
          breakdown: currentEval.breakdown,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: claimRecord, error: claimErr } = await supabase
      .from("claims_ledger")
      .insert({
        apaar_id,
        scheme_id,
        status: "DISBURSED",
      })
      .select("id, timestamp")
      .single();

    if (claimErr) {
      return new Response(
        JSON.stringify({ status: "REJECTED", reason: `Duplicate claim error: ${claimErr.message}` }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.rpc("record_audit_event", {
      p_actor: "NSP_MOCK_DISBURSER",
      p_action: "SCHOLARSHIP_BENEFIT_DISBURSED",
      p_record_id: claimRecord.id,
      p_payload: {
        apaar_id,
        scheme_id,
        disbursal_timestamp: claimRecord.timestamp,
      },
    });

    return new Response(
      JSON.stringify({
        status: "SUCCESS",
        message: "Scholarship benefit disbursed and recorded to NSP ledger",
        claim_id: claimRecord.id,
        disbursed_at: claimRecord.timestamp,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal Server Error";
    return new Response(JSON.stringify({ status: "ERROR", error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
