import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { createHmacSha256 } from "../_shared/crypto.ts";

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(req.url);
    const apaar_id = url.searchParams.get("apaar_id");
    const requested_scheme = url.searchParams.get("scheme");

    if (!apaar_id || apaar_id.length !== 12) {
      return new Response(
        JSON.stringify({ error: "A valid 12-digit APAAR ID is mandatory" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const secretKey = Deno.env.get("QR_HMAC_SECRET_KEY") || "sih-2026-apaar-verify-secret-key-mock";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: student, error: studentErr } = await supabase
      .from("students")
      .select("*")
      .eq("apaar_id", apaar_id)
      .single();

    if (studentErr || !student) {
      return new Response(
        JSON.stringify({ error: `Student profile not found for APAAR: ${apaar_id}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: activeEnrollment } = await supabase
      .from("enrollments")
      .select("id, institute_id, program, year, status")
      .eq("apaar_id", apaar_id)
      .eq("status", "ACTIVE")
      .maybeSingle();

    let hostCapacity: { sanctioned_intake: number; verified_students: number; faculty_fte: number } | null = null;
    let ratioLimits: Record<string, number> = { "B.Tech": 20.0, "M.Tech": 15.0 };

    if (activeEnrollment) {
      const { data: capData } = await supabase
        .from("capacity")
        .select("sanctioned_intake, verified_students, faculty_fte")
        .eq("institute_id", activeEnrollment.institute_id)
        .eq("program", activeEnrollment.program)
        .eq("academic_year", "2026-27")
        .maybeSingle();
      hostCapacity = capData;

      const { data: ruleData } = await supabase
        .from("rules")
        .select("value_json")
        .eq("key", "ratio_limits")
        .maybeSingle();
      if (ruleData?.value_json) ratioLimits = ruleData.value_json;
    }

    const { data: attSummaries } = await supabase
      .from("attendance_summary")
      .select("attendance_pct")
      .eq("apaar_id", apaar_id);

    const avgAttendance =
      attSummaries && attSummaries.length > 0
        ? attSummaries.reduce((acc, curr) => acc + Number(curr.attendance_pct), 0) / attSummaries.length
        : 0.0;

    const { data: claims } = await supabase
      .from("claims_ledger")
      .select("scheme_id, status")
      .eq("apaar_id", apaar_id)
      .eq("status", "DISBURSED");

    const disbursedSchemeIds = new Set((claims || []).map((c) => c.scheme_id));

    let query = supabase.from("schemes").select("id, name, active, scheme_rules(rules_json)");
    if (requested_scheme) query = query.eq("id", requested_scheme);
    else query = query.eq("active", true);
    const { data: schemesData, error: schemeErr } = await query;

    if (schemeErr || !schemesData || schemesData.length === 0) {
      return new Response(
        JSON.stringify({ error: "No matching active schemes found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const evaluations = [];

    for (const scheme of schemesData) {
      const breakdown = [];
      let overallPass = true;
      const sr = scheme.scheme_rules;
      const rules = (Array.isArray(sr) ? sr[0]?.rules_json : sr?.rules_json) || {};

      if (student.is_identity_verified && student.consent) {
        breakdown.push({
          criterion: "APAAR Identity & Consent",
          required: "Verified & Consented",
          actual: "Verified (KYC OK)",
          status: "PASS",
          source: "APAAR Mock Gateway",
        });
      } else {
        overallPass = false;
        breakdown.push({
          criterion: "APAAR Identity & Consent",
          required: "Verified & Consented",
          actual: !student.consent ? "Consent Missing" : "Identity Unverified",
          status: "FAIL",
          source: "APAAR Mock Gateway",
        });
      }

      if (rules.requires_active_enrollment !== false) {
        if (activeEnrollment) {
          breakdown.push({
            criterion: "Active Verified Enrollment",
            required: "ACTIVE",
            actual: `ACTIVE (${activeEnrollment.institute_id})`,
            status: "PASS",
            source: "Enrollment Ledger",
          });
        } else {
          overallPass = false;
          breakdown.push({
            criterion: "Active Verified Enrollment",
            required: "ACTIVE",
            actual: "None / Unconfirmed",
            status: "FAIL",
            source: "Enrollment Ledger",
          });
        }
      }

      if (rules.institute_must_be_compliant && activeEnrollment && hostCapacity) {
        const maxPermittedRatio = ratioLimits[activeEnrollment.program] || 20.0;
        const actualRatio = hostCapacity.verified_students / Math.max(1, hostCapacity.faculty_fte);
        const intakeBreached = hostCapacity.verified_students > hostCapacity.sanctioned_intake;
        const ratioBreached = actualRatio > maxPermittedRatio;

        if (!intakeBreached && !ratioBreached) {
          breakdown.push({
            criterion: "Host Institution Compliance",
            required: `Ratio <= ${maxPermittedRatio}:1 & Intake under cap`,
            actual: `Compliant (Ratio ${actualRatio.toFixed(1)}:1)`,
            status: "PASS",
            source: "AICTE Portal",
          });
        } else {
          overallPass = false;
          breakdown.push({
            criterion: "Host Institution Compliance",
            required: `Ratio <= ${maxPermittedRatio}:1 & Intake under cap`,
            actual: `Breached (Ratio ${actualRatio.toFixed(1)}:1)`,
            status: "FAIL",
            source: "AICTE Portal",
          });
        }
      }

      if (typeof rules.min_attendance_pct === "number") {
        if (avgAttendance >= rules.min_attendance_pct) {
          breakdown.push({
            criterion: "Minimum Attendance",
            required: `>= ${rules.min_attendance_pct}%`,
            actual: `${avgAttendance.toFixed(1)}%`,
            status: "PASS",
            source: "Attendance Engine",
          });
        } else {
          overallPass = false;
          breakdown.push({
            criterion: "Minimum Attendance",
            required: `>= ${rules.min_attendance_pct}%`,
            actual: `${avgAttendance.toFixed(1)}%`,
            status: "FAIL",
            source: "Attendance Engine",
          });
        }
      }

      if (typeof rules.max_family_income === "number") {
        const studentIncome = Number(student.family_income);
        if (studentIncome <= rules.max_family_income) {
          breakdown.push({
            criterion: "Annual Family Income",
            required: `<= INR ${rules.max_family_income.toLocaleString("en-IN")}`,
            actual: `INR ${studentIncome.toLocaleString("en-IN")}`,
            status: "PASS",
            source: "DigiLocker Income Service",
          });
        } else {
          overallPass = false;
          breakdown.push({
            criterion: "Annual Family Income",
            required: `<= INR ${rules.max_family_income.toLocaleString("en-IN")}`,
            actual: `INR ${studentIncome.toLocaleString("en-IN")}`,
            status: "FAIL",
            source: "DigiLocker Income Service",
          });
        }
      }

      if (rules.gender && typeof rules.gender === "string") {
        if (student.gender.toLowerCase() === rules.gender.toLowerCase()) {
          breakdown.push({
            criterion: "Target Gender",
            required: rules.gender,
            actual: student.gender,
            status: "PASS",
            source: "Student Identity",
          });
        } else {
          overallPass = false;
          breakdown.push({
            criterion: "Target Gender",
            required: rules.gender,
            actual: student.gender,
            status: "FAIL",
            source: "Student Identity",
          });
        }
      }

      if (disbursedSchemeIds.has(scheme.id)) {
        overallPass = false;
        breakdown.push({
          criterion: "Duplicate Disbursal Prevention",
          required: "No prior claim",
          actual: "Already Disbursed",
          status: "FAIL",
          source: "NSP Ledger",
        });
      }

      let eligibilityToken: string | null = null;
      let expiresAt: number | null = null;

      if (overallPass) {
        expiresAt = Math.floor(Date.now() / 1000) + 900;
        const tokenPayload = `${apaar_id}|${scheme.id}|${expiresAt}`;
        const signature = await createHmacSha256(secretKey, tokenPayload);
        eligibilityToken = `${tokenPayload}|${signature}`;
      }

      evaluations.push({
        scheme_id: scheme.id,
        scheme_name: scheme.name,
        status: overallPass ? "ELIGIBLE" : "BLOCKED",
        eligibility_token: eligibilityToken,
        expires_at: expiresAt,
        breakdown,
        notice: "Criteria are illustrative; use official scheme guidelines.",
      });
    }

    return new Response(
      JSON.stringify(requested_scheme ? evaluations[0] : evaluations),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal Server Error";
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
