import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';

const API_BASE = typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
  ? `http://${window.location.hostname}:8000`
  : "http://localhost:8000";

const PERSONAS = [
  { apaar_id: "100000000001", name: "Priya Sharma", tag: "Eligible for Pragati (91.6% Att)", income: "₹4,50,000", cat: "General", gender: "Female", inst: "INST_DEL_01", status: "ACTIVE" },
  { apaar_id: "100000000002", name: "Rohan Verma", tag: "Low Attendance (62.5% < 75%)", income: "₹3,20,000", cat: "OBC", gender: "Male", inst: "INST_DEL_01", status: "ACTIVE" },
  { apaar_id: "100000000003", name: "Ananya Deshmukh", tag: "High Family Income (₹12 Lakhs)", income: "₹12,00,000", cat: "General", gender: "Female", inst: "INST_MH_04", status: "ACTIVE" },
  { apaar_id: "100000000004", name: "Karthik Rajan", tag: "Diploma Holder (Lateral Entry)", income: "₹2,80,000", cat: "OBC", gender: "Male", inst: "INST_KA_03", status: "ACTIVE" },
  { apaar_id: "100000000005", name: "Suresh Kumar", tag: "Ghost Student Candidate (0 Scans)", income: "₹1,80,000", cat: "SC", gender: "Male", inst: "INST_DEL_01", status: "ACTIVE" },
  { apaar_id: "100000000008", name: "Student Test 08", tag: "New Applicant (No Active College)", income: "₹4,30,000", cat: "General", gender: "Female", inst: "None", status: "UNENROLLED" },
  { apaar_id: "100000000888", name: "Aarav Gupta", tag: "Name/DOB Mismatch Flagged", income: "₹5,00,000", cat: "General", gender: "Male", inst: "None", status: "FLAGGED" },
  { apaar_id: "100000000999", name: "Vikram Singh", tag: "Suspended / Unverified APAAR", income: "₹4,00,000", cat: "General", gender: "Male", inst: "None", status: "UNVERIFIED" }
];

/* ---------- Presentation helpers (no business logic) ---------- */

// Guilloche rosette: the security-print pattern used as the product's seal.
function Guilloche({ size = 56, lines = 7, draw = false, check = false, className = "" }) {
  const paths = useMemo(() => {
    const out = [];
    for (let k = 0; k < lines; k++) {
      const d = 4 + k * (10 / Math.max(1, lines - 1));
      const phase = k * 0.45;
      let path = "";
      for (let i = 0; i <= 480; i++) {
        const t = (Math.PI * 2 * i) / 480;
        const x = 34 * Math.cos(t) + d * Math.cos(7 * t + phase);
        const y = 34 * Math.sin(t) - d * Math.sin(7 * t + phase);
        path += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      out.push(path + "Z");
    }
    return out;
  }, [lines]);
  return (
    <svg className={`seal ${draw ? "seal--draw" : ""} ${className}`} width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
      <circle r="49" className="seal-path" pathLength="1" style={{ "--i": 0 }} />
      {paths.map((d, k) => <path key={k} d={d} className="seal-path" pathLength="1" style={{ "--i": k + 1 }} />)}
      {check && (
        <>
          <circle r="13" className="seal-disc" />
          <path className="seal-check" pathLength="1" d="M-6.5 0.5 L-1.5 5.5 L7 -5" />
        </>
      )}
    </svg>
  );
}

const iconProps = { width: 16, height: 16, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, style: { display: "inline-block", verticalAlign: "-3px", flex: "none" } };
const IconCheck = () => <svg {...iconProps}><path d="m4 10.5 4 4 8-9" /></svg>;
const IconCross = () => <svg {...iconProps}><path d="m5 5 10 10M15 5 5 15" /></svg>;
const IconAlert = () => <svg {...iconProps}><path d="M10 3 18 17H2L10 3Z" /><path d="M10 8.5v4M10 14.8v.1" /></svg>;
const IconLock = () => <svg {...iconProps}><rect x="4" y="9" width="12" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>;
const IconScan = () => <svg {...iconProps}><path d="M3 7V4h3M14 4h3v3M17 13v3h-3M6 16H3v-3M3 10h14" /></svg>;
const IconCamera = () => <svg {...iconProps}><path d="M3 7h3l1.5-2h5L14 7h3v9H3V7Z" /><circle cx="10" cy="11" r="2.8" /></svg>;
const IconEdit = () => <svg {...iconProps}><path d="m4 16 .8-3.6L13.5 3.7l2.8 2.8-8.7 8.7L4 16Z" /></svg>;
const IconRefresh = () => <svg {...iconProps}><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5V6h-2.5" /></svg>;

function NavTab({ active, onClick, children }) {
  return (
    <button onClick={onClick} data-active={active ? "true" : "false"} aria-current={active ? "page" : undefined} className={`nav-tab${active ? " is-active" : ""}`}>
      {children}
    </button>
  );
}

export default function App() {
  const [role, setRole] = useState("Student");
  const [selectedApaar, setSelectedApaar] = useState("100000000001");
  const [currentUser, setCurrentUser] = useState(PERSONAS[0]);
  const [otp, setOtp] = useState("123456");
  const [consent, setConsent] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");

  // Rotating QR state
  const [qrToken, setQrToken] = useState("");
  const [countdown, setCountdown] = useState(30);
  const [qrError, setQrError] = useState(null);
  const [copiedToken, setCopiedToken] = useState(false);

  // Scheme state
  const [schemeResults, setSchemeResults] = useState([]);
  const [disbursalMsg, setDisbursalMsg] = useState(null);

  // AICTE & Compliance state
  const [complianceData, setComplianceData] = useState([]);
  const [ghostStudents, setGhostStudents] = useState([]);
  const [reconciliationResult, setReconciliationResult] = useState(null);

  // Requests state
  const [requestsList, setRequestsList] = useState([]);
  const [institutions, setInstitutions] = useState([]);
  const [joinForm, setJoinForm] = useState({ institute_id: "INST_DEL_01", program: "B.Tech", year: 1, type: "join", target_institute_id: "INST_MH_04" });
  const [requestMsg, setRequestMsg] = useState(null);

  // Grievance state
  const [grievanceIssue, setGrievanceIssue] = useState("");
  const [grievancesList, setGrievancesList] = useState([]);
  const [grievanceMsg, setGrievanceMsg] = useState(null);

  // Audit state
  const [auditLogs, setAuditLogs] = useState([]);
  const [chainStatus, setChainStatus] = useState(null);

  // Scanner Simulator state
  const [scannerMode, setScannerMode] = useState("quick"); // "quick" | "camera" | "manual"
  const [scannerTargetStudent, setScannerTargetStudent] = useState("100000000001");
  const [scannerTokenInput, setScannerTokenInput] = useState("");
  const [scannerInstitute, setScannerInstitute] = useState("INST_DEL_01");
  const [scanResult, setScanResult] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const cameraScannerRef = useRef(null);

  // Student Profile Data
  const [studentDetails, setStudentDetails] = useState(null);

  // Sync user object on persona switch
  useEffect(() => {
    const p = PERSONAS.find(p => p.apaar_id === selectedApaar) || PERSONAS[0];
    setCurrentUser(p);
    fetchStudentProfile(p.apaar_id);
    setDisbursalMsg(null);
    setRequestMsg(null);
  }, [selectedApaar]);

  const fetchStudentProfile = async (apaarId) => {
    try {
      const res = await fetch(`${API_BASE}/students/${apaarId}`);
      if (res.ok) {
        const data = await res.json();
        setStudentDetails(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchInstitutions = async () => {
    try {
      const res = await fetch(`${API_BASE}/institutions`);
      if (res.ok) {
        const data = await res.json();
        setInstitutions(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRequests = async () => {
    try {
      const res = await fetch(`${API_BASE}/enrollment/requests`);
      if (res.ok) {
        const data = await res.json();
        setRequestsList(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchGrievances = async () => {
    try {
      const res = await fetch(`${API_BASE}/grievances`);
      if (res.ok) {
        const data = await res.json();
        setGrievancesList(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Rotating QR Timer (Student)
  const fetchQRToken = async (apaarId) => {
    try {
      const res = await fetch(`${API_BASE}/attendance/qr/${apaarId || currentUser.apaar_id}`);
      if (res.ok) {
        const data = await res.json();
        setQrToken(data.signed_token);
        setScannerTokenInput(data.signed_token);
        setQrError(null);
        setCountdown(30);
        return data.signed_token;
      } else {
        const err = await res.json();
        setQrError(err.detail || "QR Locked (Requires active verified enrollment)");
        setQrToken("");
        return null;
      }
    } catch (e) {
      setQrError("Error contacting QR service at " + API_BASE);
      return null;
    }
  };

  useEffect(() => {
    let timer;
    if (isLoggedIn && role === "Student") {
      fetchQRToken(currentUser.apaar_id);
      timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            fetchQRToken(currentUser.apaar_id);
            return 30;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isLoggedIn, role, currentUser.apaar_id]);

  useEffect(() => {
    fetchInstitutions();
    fetchRequests();
    fetchGrievances();
  }, []);

  // HTML5 Camera Scanner initialization
  useEffect(() => {
    if (scannerMode === "camera" && cameraActive) {
      const scanner = new Html5QrcodeScanner(
        "reader",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        /* verbose= */ false
      );
      cameraScannerRef.current = scanner;
      scanner.render(
        (decodedText) => {
          handleExecuteScan(decodedText);
          scanner.clear();
          setCameraActive(false);
        },
        (error) => {
          // scanning frames
        }
      );
      return () => {
        scanner.clear().catch(console.error);
      };
    }
  }, [scannerMode, cameraActive]);

  // Check Schemes
  const checkEligibility = async () => {
    try {
      const res = await fetch(`${API_BASE}/eligibility/${currentUser.apaar_id}/schemes`);
      if (res.ok) {
        const data = await res.json();
        setSchemeResults(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Compliance Data
  const fetchCompliance = async () => {
    try {
      const res = await fetch(`${API_BASE}/aicte/compliance-overview`);
      if (res.ok) {
        const data = await res.json();
        setComplianceData(data);
      }
      const gRes = await fetch(`${API_BASE}/aicte/ghost-students`);
      if (gRes.ok) {
        const gData = await gRes.json();
        setGhostStudents(gData);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Audit Logs
  const fetchAudit = async () => {
    try {
      const res = await fetch(`${API_BASE}/audit/logs`);
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const verifyAuditChain = async () => {
    try {
      const res = await fetch(`${API_BASE}/audit/verify`);
      if (res.ok) {
        const data = await res.json();
        setChainStatus(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const tamperAuditLog = async () => {
    try {
      await fetch(`${API_BASE}/audit/tamper-demo`, { method: "POST" });
      await fetchAudit();
      await verifyAuditChain();
    } catch (e) {
      console.error(e);
    }
  };

  const handleExecuteScan = async (tokenToUse) => {
    try {
      const token = tokenToUse || scannerTokenInput;
      if (!token) {
        setScanResult({ status: "REJECTED", reason: "Please provide a signed QR token or use the Instant Scan button" });
        return;
      }
      const res = await fetch(`${API_BASE}/attendance/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signed_token: token,
          scanner_institute_id: scannerInstitute,
          device_id: "FACULTY_TAB_4A"
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setScanResult({
          status: "REJECTED",
          reason: typeof data.detail === "string" ? data.detail : (data.detail?.message || "Validation rejected by AICTE compliance engine")
        });
      } else {
        setScanResult(data);
      }
      fetchStudentProfile(currentUser.apaar_id);
      fetchCompliance();
    } catch (e) {
      setScanResult({ status: "ERROR", detail: "Network error contacting attendance scanner service" });
    }
  };

  const handleQuickScanStudent = async (studentApaarId) => {
    try {
      setScanResult(null);
      // Fetch a fresh token directly for this student
      const res = await fetch(`${API_BASE}/attendance/qr/${studentApaarId}`);
      const data = await res.json();
      if (!res.ok) {
        setScanResult({
          status: "REJECTED",
          reason: data.detail || "Student has no active verified enrollment at this institution"
        });
        return;
      }
      const freshToken = data.signed_token;
      setScannerTokenInput(freshToken);
      // Now scan the freshly obtained token
      await handleExecuteScan(freshToken);
    } catch (e) {
      setScanResult({ status: "ERROR", detail: "Error fetching student live QR token" });
    }
  };

  const handleResetAttendance = async () => {
    try {
      const res = await fetch(`${API_BASE}/attendance/reset-demo`, { method: "POST" });
      const data = await res.json();
      alert("Attendance logs cleared for today! You can now test marking attendance fresh.");
      setScanResult(null);
      fetchStudentProfile(currentUser.apaar_id);
    } catch (e) {
      alert("Error resetting attendance");
    }
  };

  const handleDisbursal = async (schemeId, token) => {
    try {
      const res = await fetch(`${API_BASE}/schemes/disburse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apaar_id: currentUser.apaar_id,
          scheme_id: schemeId,
          eligibility_token: token
        })
      });
      const data = await res.json();
      if (res.ok) {
        setDisbursalMsg({ type: "SUCCESS", text: `Payment Disbursed! Claim ID: ${data.claim_id}` });
        checkEligibility();
      } else {
        setDisbursalMsg({ type: "ERROR", text: data.detail || "Disbursal Blocked" });
      }
    } catch (e) {
      setDisbursalMsg({ type: "ERROR", text: "Network error during disbursal" });
    }
  };

  const handleSimulateAttendanceDrop = async () => {
    try {
      const res = await fetch(`${API_BASE}/schemes/simulate-attendance-drop/${currentUser.apaar_id}`, { method: "POST" });
      const data = await res.json();
      setDisbursalMsg({ type: "INFO", text: `[Scenario 9 Test] ${data.message} Now click 'Claim Benefit' above to verify real-time gate rejection!` });
      fetchStudentProfile(currentUser.apaar_id);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateRequest = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/enrollment/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apaar_id: currentUser.apaar_id,
          institute_id: joinForm.institute_id,
          program: joinForm.program,
          year: parseInt(joinForm.year),
          type: joinForm.type,
          target_institute_id: joinForm.type === "transfer" ? joinForm.target_institute_id : joinForm.institute_id
        })
      });
      const data = await res.json();
      if (res.ok) {
        setRequestMsg({ type: "SUCCESS", text: data.message });
        fetchRequests();
      } else {
        setRequestMsg({ type: "ERROR", text: data.detail || "Request failed" });
      }
    } catch (err) {
      setRequestMsg({ type: "ERROR", text: "Network error submitting request" });
    }
  };

  const handleProcessRequest = async (requestId, action) => {
    try {
      const res = await fetch(`${API_BASE}/enrollment/process-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId, action: action })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`${action} successful: ${data.message}`);
        fetchRequests();
        fetchInstitutions();
        fetchStudentProfile(currentUser.apaar_id);
      } else {
        const errDetail = typeof data.detail === "object" ? `${data.detail.message}` : data.detail;
        alert(`Action Blocked by Gate: ${errDetail}`);
      }
    } catch (e) {
      alert("Error processing request");
    }
  };

  const handleCreateGrievance = async (e) => {
    e.preventDefault();
    if (!grievanceIssue.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/grievances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apaar_id: currentUser.apaar_id, issue: grievanceIssue })
      });
      const data = await res.json();
      if (res.ok) {
        setGrievanceMsg({ type: "SUCCESS", text: data.message });
        setGrievanceIssue("");
        fetchGrievances();
      } else {
        setGrievanceMsg({ type: "ERROR", text: data.detail || "Failed to submit grievance" });
      }
    } catch (e) {
      setGrievanceMsg({ type: "ERROR", text: "Network error" });
    }
  };

  const handleResolveGrievance = async (gid) => {
    const resText = prompt("Enter resolution notes for student grievance:", "Demographic records verified against DigiLocker master cache.");
    if (!resText) return;
    try {
      await fetch(`${API_BASE}/grievances/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grievance_id: gid, resolution: resText })
      });
      fetchGrievances();
      fetchAudit();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRunReconciliation = async () => {
    try {
      const res = await fetch(`${API_BASE}/aicte/reconciliation`, { method: "POST" });
      const data = await res.json();
      setReconciliationResult(data);
      fetchCompliance();
    } catch (e) {
      console.error(e);
    }
  };

  // Slide the ink underline under the active tab.
  const tabsRef = useRef(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = tabsRef.current;
      const a = el && el.querySelector('[data-active="true"]');
      if (!a) return;
      el.style.setProperty("--ix", a.offsetLeft + "px");
      el.style.setProperty("--iw", a.offsetWidth + "px");
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [activeTab, role, grievancesList.length, requestsList]);

  const attPct = studentDetails?.attendance_summaries?.[0]?.attendance_pct ?? 0;

  const copyToClipboard = (text) => {
    navigator.clipboard?.writeText(text);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col font-sans text-slate-800">
      {/* Letterhead */}
      <header className="letterhead">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap justify-between items-center gap-x-8 gap-y-4">
          <div className="flex items-center gap-4">
            <Guilloche size={56} lines={7} draw check />
            <div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="brand">APAAR Verify</h1>
                <span className="mock-tag">Mock Integration</span>
              </div>
              <p className="text-sm font-semibold text-slate-700 mt-1">AICTE Student Verification & Compliance Gateway</p>
              <p className="text-xs text-slate-500">SIH 2026 Working Prototype: Paperless Consent-Based Verification</p>
            </div>
          </div>

          {/* Role & Persona Switcher */}
          <div className="session">
            <label>
              Active role
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setActiveTab("dashboard");
                }}
              >
                <option value="Student">Student Persona</option>
                <option value="Institute Admin / Teacher">Institute Admin / Teacher</option>
                <option value="AICTE Officer">AICTE Regulatory Officer</option>
              </select>
            </label>

            {role === "Student" && (
              <label>
                Test persona
                <select value={selectedApaar} onChange={(e) => setSelectedApaar(e.target.value)}>
                  {PERSONAS.map(p => (
                    <option key={p.apaar_id} value={p.apaar_id}>
                      {p.name} - {p.tag}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="tabbar" aria-label="Sections">
        <div className="max-w-7xl mx-auto px-2 sm:px-5">
          <div className="tabs" ref={tabsRef}>
          <NavTab active={activeTab === "dashboard"} onClick={() => setActiveTab("dashboard")}>Dashboard</NavTab>

          {role === "Student" && (
          <>
          <NavTab active={activeTab === "attendance"} onClick={() => setActiveTab("attendance")}>My Attendance QR</NavTab>
          <NavTab active={activeTab === "schemes"} onClick={() => { setActiveTab("schemes"); checkEligibility(); }}>Scholarship Schemes</NavTab>
          <NavTab active={activeTab === "requests"} onClick={() => setActiveTab("requests")}>Admission & Transfer Requests</NavTab>
          </>
          )}

          {role === "Institute Admin / Teacher" && (
          <>
          <NavTab active={activeTab === "scanner"} onClick={() => setActiveTab("scanner")}>Scan Attendance</NavTab>
          <NavTab active={activeTab === "institute-requests"} onClick={() => { setActiveTab("institute-requests"); fetchRequests(); }}>Admission Requests Queue ({requestsList.filter(r => r.state === 'SUBMITTED').length})</NavTab>
          </>
          )}

          {role === "AICTE Officer" && (
          <>
          <NavTab active={activeTab === "compliance"} onClick={() => { setActiveTab("compliance"); fetchCompliance(); }}>Institutional Compliance Radar</NavTab>
          <NavTab active={activeTab === "reconciliation"} onClick={() => { setActiveTab("reconciliation"); fetchCompliance(); }}>Nightly Reconciliation & Drift</NavTab>
          </>
          )}

          <NavTab active={activeTab === "grievances"} onClick={() => { setActiveTab("grievances"); fetchGrievances(); }}>Grievances ({grievancesList.length})</NavTab>

          <NavTab active={activeTab === "audit"} onClick={() => { setActiveTab("audit"); fetchAudit(); verifyAuditChain(); }}>Tamper-Evident Audit Trail</NavTab>
          </div>
        </div>
      </nav>

      {/* Main Body Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex-1 w-full">
      <div key={`${role}-${activeTab}`} className="view-enter space-y-6">

        {/* 1. STUDENT DASHBOARD */}
        {role === "Student" && activeTab === "dashboard" && (
          <div className="space-y-6">
            {/* ID slip */}
            <section className="slip">
              <Guilloche className="slip-mark" size={380} lines={10} />
              <div className="relative p-6 md:p-8 grid gap-6 md:grid-cols-[1fr_auto] items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-4">
                    <h2 className="slip-name text-slate-900">{currentUser.name}</h2>
                    <span className={`stamp-tag${currentUser.status === "ACTIVE" ? " is-ok" : ""}`}>{currentUser.status}</span>
                  </div>
                  <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-4">
                    <div><dt>APAAR ID</dt><dd className="font-mono">XXXXXXXX{currentUser.apaar_id.slice(-4)}</dd></div>
                    <div><dt>Category</dt><dd>{currentUser.cat}</dd></div>
                    <div><dt>Family income</dt><dd>{currentUser.income}</dd></div>
                    <div><dt>Consent</dt><dd className="text-emerald-700">DPDP Act Consent Active</dd></div>
                  </dl>
                </div>

                <div className="md:text-right md:max-w-[18rem] border-t md:border-t-0 md:border-l border-slate-200 pt-4 md:pt-0 md:pl-6">
                  <div className="text-xs text-slate-500 font-medium">Current active institute</div>
                  <div className="text-lg font-bold text-slate-900 mt-0.5 leading-snug">
                    {studentDetails?.enrollments?.find(e => e.status === "ACTIVE")?.institute_name || "No Active Institute"}
                  </div>
                  <div className="text-sm text-slate-500 mt-0.5">
                    {studentDetails?.enrollments?.find(e => e.status === "ACTIVE") ? `Program: ${studentDetails.enrollments[0].program} (Year ${studentDetails.enrollments[0].year})` : "Unenrolled - Submit Join Request"}
                  </div>
                </div>
              </div>
            </section>

            {/* Ledger strip */}
            <section className="ledger">
              <div className="ledger-cell">
                <div className="ledger-label">Monthly Verified Attendance</div>
                <div className={`ledger-num ${attPct >= 75 ? "text-slate-900" : "text-red-600"}`}>{attPct}<small>%</small></div>
                <div className="gauge" role="img" aria-label={`Attendance ${attPct} percent, cutoff 75 percent`}>
                  <div className={`gauge-fill ${attPct >= 75 ? "bg-emerald-600" : "bg-red-500"}`} style={{ width: `${Math.min(100, attPct)}%` }}></div>
                  <span className="gauge-cut"></span>
                </div>
                {attPct < 75 ? (
                  <p className="text-xs text-red-600 mt-7 font-medium flex items-center gap-1.5"><IconAlert /> Below 75% scheme cutoff ({attPct}%)</p>
                ) : (
                  <p className="text-xs text-emerald-700 mt-7 font-medium flex items-center gap-1.5"><IconCheck /> Satisfies AICTE & Pragati minimum cutoff</p>
                )}
              </div>

              <div className="ledger-cell">
                <div className="ledger-label">Academic Credits (ABC Ledger)</div>
                <div className="ledger-num text-slate-900">
                  {studentDetails?.credits?.reduce((acc, c) => acc + c.credits, 0) ?? 0}
                  <small>Credits</small>
                </div>
                <p className="text-xs text-slate-500 mt-4">NEP 2020 Multi-Entry & Exit Credit Bank verified</p>
              </div>

              <div className="ledger-cell">
                <div className="ledger-label">Scholarship Status</div>
                <div className="ledger-num text-emerald-700">
                  {currentUser.apaar_id === "100000000001" ? "1 Eligible" : "0 Eligible"}
                </div>
                <p className="text-xs text-slate-500 mt-4">AICTE Pragati, Post-Matric & Merit-Cum Grants</p>
              </div>
            </section>

            {/* Academic History & Credits Table */}
            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-slate-900">Academic Bank of Credits (ABC) Transcript</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="p-3">Course / Module</th>
                      <th className="p-3">Credits</th>
                      <th className="p-3">Source Institution</th>
                      <th className="p-3">Valid Until</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {studentDetails?.credits?.length ? (
                      studentDetails.credits.map((c, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="p-3 font-medium text-slate-800">{c.course}</td>
                          <td className="p-3 font-bold text-blue-600">{c.credits}</td>
                          <td className="p-3 text-slate-600">{c.source_institute}</td>
                          <td className="p-3 text-slate-400">{c.valid_till}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="p-3 text-center text-slate-400">No credits in ABC ledger for this student</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 2. STUDENT ATTENDANCE QR - REAL VISUAL QR CODE */}
        {role === "Student" && activeTab === "attendance" && (
          <div className="max-w-md mx-auto text-center space-y-5">
            <div>
              <div className="flex items-center justify-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <h3 className="text-lg font-bold text-slate-900">Personal Rotating Attendance QR</h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">Single-use token with cryptographic HMAC-SHA256 signature</p>
            </div>

            {qrError ? (
              <div className="p-6 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs text-left space-y-2">
                <div className="font-bold text-sm flex items-center space-x-1">
                  <span className="text-slate-700"><IconLock /></span>
                  <span>QR Attendance Access Locked</span>
                </div>
                <div>{qrError}</div>
                <div className="text-slate-600 mt-2">
                  Under AICTE compliance norms, a student's personal attendance QR code is generated <strong>only</strong> after an approved institution officially accepts and verifies the student's admission.
                </div>
                <div className="pt-2">
                  <button
                    onClick={() => setActiveTab("requests")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-semibold text-xs"
                  >
                    Go to Admission Requests
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* QR ticket: the countdown runs around the code */}
                <div className="ticket">
                  <Guilloche className="ticket-mark" size={360} lines={9} />
                  <div className="relative">
                    <div className="qr-wrap">
                      <svg className="qr-ring" viewBox="0 0 100 100" aria-hidden="true">
                        <rect className="track" x="2" y="2" width="96" height="96" rx="3" />
                        <rect className={`run${countdown <= 8 ? " is-low" : ""}`} x="2" y="2" width="96" height="96" rx="3" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - countdown / 30} />
                      </svg>
                      <div className="qr-face">
                        {qrToken ? (
                          <QRCodeSVG
                            value={qrToken}
                            size={220}
                            bgColor="#ffffff"
                            fgColor="#25215f"
                            level="Q"
                            includeMargin={false}
                          />
                        ) : (
                          <div className="w-[220px] h-[220px] flex items-center justify-center text-xs text-slate-400">
                            Generating Secure QR...
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 flex justify-between items-baseline text-sm px-1">
                      <span className="text-slate-500 font-medium">Rotating Token Lifetime</span>
                      <span className={`qr-count ${countdown <= 8 ? "text-red-600" : "text-slate-900"}`} aria-live="off">
                        {countdown}s remaining
                      </span>
                    </div>
                  </div>
                </div>

                {/* Token details and copy */}
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-left text-xs space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-700">Cryptographic Token:</span>
                    <button
                      onClick={() => copyToClipboard(qrToken)}
                      className="text-blue-600 hover:text-blue-700 font-semibold text-[11px] underline"
                    >
                      {copiedToken ? "Copied" : "Copy Token"}
                    </button>
                  </div>
                  <div className="font-mono text-[10px] bg-white p-2 rounded border border-slate-200 break-all text-slate-600 leading-relaxed max-h-16 overflow-y-auto">
                    {qrToken || "Loading token..."}
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 pt-1">
                    <span>Host Bound: {studentDetails?.enrollments?.[0]?.institute_id || "INST_DEL_01"}</span>
                    <span>Session: FORENOON</span>
                    <span>Device: Verified</span>
                  </div>
                </div>

                <div className="flex justify-center space-x-3 pt-1">
                  <button
                    onClick={() => fetchQRToken(currentUser.apaar_id)}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded text-xs font-semibold border border-slate-300"
                  >
                    <span className="inline-flex items-center gap-1.5"><IconRefresh /> Force Refresh Token</span>
                  </button>
                </div>

                <p className="text-[11px] text-slate-400">
                  Raw APAAR ID is hashed with SHA-256 and never transmitted plain in the QR code.
                </p>
              </div>
            )}
          </div>
        )}

        {/* 3. SCHEMES TAB */}
        {role === "Student" && activeTab === "schemes" && (
          <div className="space-y-6">
            <div className="bg-blue-50 border-l-4 border-blue-600 p-4 text-xs text-blue-900 flex justify-between items-center">
              <div>
                <span className="font-bold">Government Scheme Compliance Engine:</span> Multi-criterion automated gate checking APAAR KYC, attendance cutoff, family income, category & host college compliance.
              </div>
              <button
                onClick={handleSimulateAttendanceDrop}
                className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded font-semibold text-[11px] shadow whitespace-nowrap ml-4"
              >
                [Demo 9] Drop Attendance to 50%
              </button>
            </div>

            {disbursalMsg && (
              <div className={`p-4 rounded text-xs font-semibold ${disbursalMsg.type === "SUCCESS" ? "bg-emerald-100 text-emerald-800" : disbursalMsg.type === "INFO" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>
                {disbursalMsg.text}
              </div>
            )}

            <div className="space-y-4">
              {schemeResults.map((s) => (
                <div key={s.scheme_id} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-base font-bold text-slate-900">{s.scheme_name}</h4>
                      <span className={`inline-block mt-1 text-[11px] font-bold px-2.5 py-0.5 rounded ${s.status === "ELIGIBLE" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                        {s.status}
                      </span>
                    </div>

                    {s.status === "ELIGIBLE" && (
                      <button
                        onClick={() => handleDisbursal(s.scheme_id, s.eligibility_token)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded shadow transition-all"
                      >
                        Claim Benefit Disbursal
                      </button>
                    )}
                  </div>

                  {/* Criteria Breakdown Grid */}
                  <div className="border-t border-slate-100 pt-3">
                    <div className="text-xs font-semibold text-slate-500 mb-2">Gate Criteria Verification:</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      {s.breakdown.map((b, idx) => (
                        <div key={idx} className="p-2.5 rounded bg-slate-50 border border-slate-200 flex justify-between items-center">
                          <div>
                            <span className="font-semibold text-slate-800">{b.criterion}</span>
                            <div className="text-[10px] text-slate-400">Source: {b.source} | Required: {b.required}</div>
                          </div>
                          <div className="text-right">
                            <span className={`text-[11px] font-bold ${b.status === "PASS" ? "text-emerald-600" : "text-red-600"}`}>
                              {b.status}
                            </span>
                            <div className="text-[10px] text-slate-500 font-medium">{b.actual}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. STUDENT ADMISSION & TRANSFER REQUESTS */}
        {role === "Student" && activeTab === "requests" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Request Form */}
              <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-base font-bold text-slate-900">Submit New Admission / Transfer Request</h3>
                <p className="text-xs text-slate-500">Creates a two-sided verification intent: SUBMITTED → INSTITUTE_REVIEW → APPROVED.</p>

                {requestMsg && (
                  <div className={`p-3 rounded text-xs font-semibold ${requestMsg.type === "SUCCESS" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                    {requestMsg.text}
                  </div>
                )}

                <form onSubmit={handleCreateRequest} className="space-y-3 text-xs">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Request Type</label>
                    <select
                      value={joinForm.type}
                      onChange={(e) => setJoinForm({ ...joinForm, type: e.target.value })}
                      className="w-full border border-slate-300 rounded p-2 focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="join">Regular Join Request (Year 1)</option>
                      <option value="lateral">NEP 2020 Lateral Entry (Year 2 for Diploma Holders)</option>
                      <option value="transfer">Inter-College Transfer with Credit Carry</option>
                      <option value="exit">NEP Multiple Exit (Certificate / Diploma)</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Institution</label>
                    <select
                      value={joinForm.institute_id}
                      onChange={(e) => setJoinForm({ ...joinForm, institute_id: e.target.value })}
                      className="w-full border border-slate-300 rounded p-2 focus:ring-1 focus:ring-blue-500"
                    >
                      {institutions.map(inst => (
                        <option key={inst.id} value={inst.id}>
                          {inst.name} ({inst.state}) - Vacancies: {inst.sanctioned_intake - inst.verified_students}
                        </option>
                      ))}
                    </select>
                  </div>

                  {joinForm.type === "transfer" && (
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Destination Transfer College</label>
                      <select
                        value={joinForm.target_institute_id}
                        onChange={(e) => setJoinForm({ ...joinForm, target_institute_id: e.target.value })}
                        className="w-full border border-slate-300 rounded p-2 focus:ring-1 focus:ring-blue-500"
                      >
                        {institutions.map(inst => (
                          <option key={inst.id} value={inst.id}>
                            {inst.name} ({inst.state})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded shadow transition-all"
                  >
                    Submit Request to College Queue
                  </button>
                </form>
              </div>

              {/* Existing Requests Tracker */}
              <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-base font-bold text-slate-900">Your Request History & Audit Tracker</h3>
                <div className="space-y-3">
                  {requestsList.filter(r => r.apaar_id === currentUser.apaar_id).length ? (
                    requestsList.filter(r => r.apaar_id === currentUser.apaar_id).map((req) => (
                      <div key={req.id} className="p-3 border border-slate-200 rounded-lg bg-slate-50 space-y-1 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-slate-800">{req.type} Request</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${req.state === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : req.state === 'REJECTED' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                            {req.state}
                          </span>
                        </div>
                        <div className="text-slate-600">College: {req.to_inst_name || req.to_inst}</div>
                        <div className="text-[10px] text-slate-400">Timestamp: {req.created_at}</div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400">No requests submitted for this persona yet.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 5. INSTITUTE ADMIN / TEACHER QUEUE */}
        {role === "Institute Admin / Teacher" && activeTab === "institute-requests" && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
              <h3 className="text-base font-bold text-slate-900">Pending Admission, Lateral & Transfer Requests</h3>
              <p className="text-xs text-slate-500 mt-1">Approval runs AICTE 5-gate transactional verification: Hard Cap, Faculty Ratio, Duplicate Check, and Qualification Validation.</p>
            </div>

            <div className="space-y-4">
              {requestsList.filter(r => r.state === 'SUBMITTED').length ? (
                requestsList.filter(r => r.state === 'SUBMITTED').map((req) => (
                  <div key={req.id} className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-xs">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-sm text-slate-900">{req.student_name}</span>
                        <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-semibold text-[10px]">
                          {req.type}
                        </span>
                      </div>
                      <div className="text-slate-500 mt-1">APAAR: <span className="font-mono text-slate-700">{req.apaar_id}</span> | Prior Qual: <span className="font-semibold text-slate-700">{req.prior_qualification}</span></div>
                      <div className="text-slate-400 mt-0.5">Target: {req.to_inst_name || req.to_inst} (Year {req.year})</div>
                    </div>

                    <div className="flex space-x-3">
                      <button
                        onClick={() => handleProcessRequest(req.id, "APPROVE")}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2 rounded shadow"
                      >
                        Accept & Verify
                      </button>
                      <button
                        onClick={() => handleProcessRequest(req.id, "REJECT")}
                        className="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded shadow"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="bg-white p-8 text-center text-slate-400 border border-slate-200 rounded-lg text-xs">
                  No pending student requests in queue.
                </div>
              )}
            </div>
          </div>
        )}

        {/* 6. SCAN ATTENDANCE TAB - MULTI-MODE SCANNER */}
        {role === "Institute Admin / Teacher" && activeTab === "scanner" && (
          <div className="max-w-2xl mx-auto bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between items-start gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Attendance QR Verification Station</h3>
                <p className="text-xs text-slate-500 mt-0.5">Scans student HMAC-SHA256 tokens and enforces single-use nonces.</p>
              </div>

              {/* Scanner College Selector */}
              <div className="sm:text-right w-full sm:w-auto min-w-0">
                <span className="text-[10px] text-slate-400 block font-medium">Scanner Station Bound:</span>
                <select
                  value={scannerInstitute}
                  onChange={(e) => setScannerInstitute(e.target.value)}
                  className="bg-slate-50 border border-slate-300 text-xs font-semibold rounded px-2 py-1 text-slate-800 w-full sm:w-auto"
                >
                  {institutions.map(i => (
                    <option key={i.id} value={i.id}>{i.name} ({i.id})</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Mode Tabs */}
            <div className="flex border-b border-slate-200 space-x-4 text-xs font-semibold">
              <button
                onClick={() => { setScannerMode("quick"); setCameraActive(false); }}
                className={`pb-2 border-b-2 transition-all ${scannerMode === "quick" ? "border-blue-600 text-blue-600 font-bold" : "border-transparent text-slate-400 hover:text-slate-700"}`}
              >
                <span className="inline-flex items-center gap-1.5"><IconScan /> 1-Click Live Student Scan</span>
              </button>
              <button
                onClick={() => { setScannerMode("camera"); setCameraActive(true); }}
                className={`pb-2 border-b-2 transition-all ${scannerMode === "camera" ? "border-blue-600 text-blue-600 font-bold" : "border-transparent text-slate-400 hover:text-slate-700"}`}
              >
                <span className="inline-flex items-center gap-1.5"><IconCamera /> Camera Viewfinder</span>
              </button>
              <button
                onClick={() => { setScannerMode("manual"); setCameraActive(false); }}
                className={`pb-2 border-b-2 transition-all ${scannerMode === "manual" ? "border-blue-600 text-blue-600 font-bold" : "border-transparent text-slate-400 hover:text-slate-700"}`}
              >
                <span className="inline-flex items-center gap-1.5"><IconEdit /> Manual / Test Tamper</span>
              </button>
            </div>

            {/* MODE 1: QUICK LIVE SCANNER (Best for Demos) */}
            {scannerMode === "quick" && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-4">
                <div className="text-xs text-slate-600">
                  Select any student to immediately fetch their <strong>active rotating QR</strong> and simulate scanning it:
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <select
                    value={scannerTargetStudent}
                    onChange={(e) => setScannerTargetStudent(e.target.value)}
                    className="flex-1 bg-white border border-slate-300 text-xs rounded-lg px-3 py-2 font-medium"
                  >
                    {PERSONAS.map(p => (
                      <option key={p.apaar_id} value={p.apaar_id}>
                        {p.name} ({p.inst}) - {p.tag}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => handleQuickScanStudent(scannerTargetStudent)}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-5 py-2.5 rounded-lg shadow whitespace-nowrap transition-all"
                  >
                    <span className="inline-flex items-center gap-1.5"><IconScan /> Scan Live QR Now</span>
                  </button>
                </div>

                <div className="flex justify-between items-center pt-2 text-[11px] text-slate-500 border-t border-slate-200">
                  <span>Demo Tip: Click scan once to mark Present. Click again to verify "Already Marked" duplicate rejection.</span>
                  <button
                    onClick={handleResetAttendance}
                    className="text-amber-700 hover:text-amber-800 font-semibold underline ml-2 whitespace-nowrap"
                  >
                    Reset Today's Scans
                  </button>
                </div>
              </div>
            )}

            {/* MODE 2: CAMERA VIEWFINDER */}
            {scannerMode === "camera" && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-center space-y-3">
                <p className="text-xs text-slate-600">Point your camera at the student's rotating QR code on screen or mobile:</p>
                <div id="reader" className="w-full max-w-sm mx-auto overflow-hidden rounded-lg border border-slate-300 bg-black min-h-[250px]"></div>
                <button
                  onClick={() => setCameraActive(!cameraActive)}
                  className="bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2 rounded"
                >
                  {cameraActive ? "Stop Camera" : "Restart Camera"}
                </button>
              </div>
            )}

            {/* MODE 3: MANUAL & TAMPER TEST */}
            {scannerMode === "manual" && (
              <div className="space-y-3">
                <label className="text-xs font-semibold text-slate-700 block">Signed Token String</label>
                <textarea
                  value={scannerTokenInput}
                  onChange={(e) => setScannerTokenInput(e.target.value)}
                  placeholder="Paste student signed token here..."
                  rows={3}
                  className="w-full text-xs font-mono p-2.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 bg-slate-50"
                />

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleExecuteScan(scannerTokenInput)}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 px-3 rounded shadow"
                  >
                    Verify & Mark Scanned Token
                  </button>
                  <button
                    onClick={() => handleExecuteScan("tampered:token:signature:fail:000:000:bad_sig")}
                    className="bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold px-3 py-2 rounded border border-red-200"
                  >
                    Test Tampered Signature
                  </button>
                  <button
                    onClick={() => handleExecuteScan("hash:ENR_01:INST_DEL_01:1600000000:1600000030:nonce:sig")}
                    className="bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-semibold px-3 py-2 rounded border border-amber-200"
                  >
                    Test Expired Token (&gt;30s)
                  </button>
                </div>
              </div>
            )}

            {/* SCAN RESULT FEEDBACK CARD */}
            {scanResult && (
              <div className={`verdict ${scanResult.status === "SUCCESS" ? "is-ok" : "is-bad"}`} role="status">
                <span className="verdict-stamp">{scanResult.status === "SUCCESS" ? "Accepted" : "Rejected"}</span>
                <div className="flex items-center gap-2 pr-24">
                  <span className="text-base font-bold">
                    {scanResult.status === "SUCCESS" ? <IconCheck /> : <IconCross />}
                  </span>
                  <div className="font-bold text-base">
                    {scanResult.status === "SUCCESS" ? "Attendance Accepted & Logged" : "Attendance Validation Rejected"}
                  </div>
                </div>

                <div className="mt-2 text-sm font-medium pl-6">
                  {scanResult.message || scanResult.detail || scanResult.reason}
                </div>

                {scanResult.student_name && (
                  <div className="mt-3 pt-3 border-t border-emerald-700/20 pl-6 flex flex-wrap justify-between gap-2 text-xs">
                    <span>Student: <strong>{scanResult.student_name}</strong> ({scanResult.apaar_id_masked})</span>
                    <span>Date: {scanResult.date} (FORENOON)</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 7. AICTE COMPLIANCE RADAR */}
        {role === "AICTE Officer" && activeTab === "compliance" && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-slate-900">AICTE Institutional Intake & Ratio Radar</h3>
                <p className="text-xs text-slate-500 mt-1">Real-time surveillance of sanctioned intake caps and faculty ratios.</p>
              </div>
              <button
                onClick={fetchCompliance}
                className="bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold px-4 py-2 rounded shadow"
              >
                Refresh Regulatory View
              </button>
            </div>

            {/* Radar Table */}
            <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg shadow-sm">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="p-3">AICTE Code</th>
                    <th className="p-3">Institution Name</th>
                    <th className="p-3">State</th>
                    <th className="p-3">Intake (Ver / Sanc)</th>
                    <th className="p-3">Occupancy</th>
                    <th className="p-3">Faculty FTE</th>
                    <th className="p-3">Ratio (Act / Max)</th>
                    <th className="p-3">Compliance Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {complianceData.map((row) => (
                    <tr key={row.institute_id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-medium">{row.aicte_code}</td>
                      <td className="p-3 font-medium text-slate-800">{row.name}</td>
                      <td className="p-3 text-slate-500">{row.state}</td>
                      <td className="p-3">
                        <span className="font-bold">{row.verified_students}</span> / {row.sanctioned_intake}
                      </td>
                      <td className="p-3 font-semibold">
                        {row.occupancy_pct}%
                        <div className="mini-gauge" aria-hidden="true"><i className={row.violations.under_filled ? "is-low" : ""} style={{ width: `${Math.min(100, row.occupancy_pct)}%` }}></i></div>
                      </td>
                      <td className="p-3">{row.faculty_fte}</td>
                      <td className="p-3 font-mono">
                        <span className={row.violations.ratio_breach ? "text-red-600 font-bold" : "text-slate-700"}>
                          {row.actual_ratio}:1
                        </span> / {row.max_ratio}:1
                      </td>
                      <td className="p-3">
                        {row.violations.ratio_breach ? (
                          <span className="bg-red-100 text-red-800 px-2.5 py-0.5 rounded font-semibold text-[10px]">Ratio Breach (&gt;20:1)</span>
                        ) : row.violations.under_filled ? (
                          <span className="bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded font-semibold text-[10px]">Under-filled (&lt;40%)</span>
                        ) : (
                          <span className="bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded font-semibold text-[10px]">Compliant</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Ghost Students Alert Panel */}
            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse"></span>
                <h4 className="text-sm font-bold text-slate-900">Ghost Student Anomaly Flags (Zero QR Scans in Confirmation Window)</h4>
              </div>
              <p className="text-xs text-slate-500">Students with ACTIVE institute enrollment but 0 attendance records logged within the mandatory confirmation window.</p>
              <div className="space-y-2">
                {ghostStudents.map(g => (
                  <div key={g.apaar_id} className="p-3 rounded bg-red-50/60 border border-red-200 flex justify-between items-center text-xs">
                    <div>
                      <span className="font-bold text-slate-900">{g.name}</span>
                      <span className="font-mono text-slate-500 ml-2">(APAAR: XXXXXXXX{g.apaar_id.slice(-4)})</span>
                      <div className="text-[10px] text-slate-500">{g.institute_name} | Enrolled on: {g.start_date}</div>
                    </div>
                    <span className="bg-red-100 text-red-800 font-bold px-2 py-0.5 rounded text-[10px]">
                      0 Total Scans Logged
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 8. AICTE RECONCILIATION */}
        {role === "AICTE Officer" && activeTab === "reconciliation" && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-slate-900">Automated Intake Reconciliation Job</h3>
                <p className="text-xs text-slate-500 mt-1">Recomputes verified admissions from raw enrollment ledger rows and compares against capacity counters to detect counter drift.</p>
              </div>
              <button
                onClick={handleRunReconciliation}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded shadow"
              >
                Execute Nightly Job
              </button>
            </div>

            {reconciliationResult && (
              <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800">Job Timestamp: {reconciliationResult.timestamp}</span>
                  <span className={`px-2.5 py-0.5 rounded font-bold text-[11px] ${reconciliationResult.drift_detected ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                    {reconciliationResult.drift_detected ? "Drift Corrected" : "Zero Drift - Counters Synchronized"}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                      <tr>
                        <th className="p-2.5">Institute</th>
                        <th className="p-2.5">Program</th>
                        <th className="p-2.5">Counter Value</th>
                        <th className="p-2.5">Raw Active Rows</th>
                        <th className="p-2.5">Drift Offset</th>
                        <th className="p-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reconciliationResult.details.map((d, i) => (
                        <tr key={i}>
                          <td className="p-2.5 font-medium">{d.institute_id}</td>
                          <td className="p-2.5">{d.program}</td>
                          <td className="p-2.5 font-mono">{d.recorded_counter}</td>
                          <td className="p-2.5 font-mono">{d.raw_enrollment_rows}</td>
                          <td className="p-2.5 font-mono">{d.drift}</td>
                          <td className="p-2.5 font-semibold text-emerald-600">
                            {d.reconciled ? "Auto-Reconciled" : "Verified"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 9. GRIEVANCES TAB */}
        {activeTab === "grievances" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Form */}
              <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-base font-bold text-slate-900">Raise Student Grievance / Dispute</h3>
                <p className="text-xs text-slate-500">Allows students with demographic mismatch or blocked results to dispute with AICTE helpdesk. Blocking is never a dead end.</p>

                {grievanceMsg && (
                  <div className={`p-3 rounded text-xs font-semibold ${grievanceMsg.type === "SUCCESS" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                    {grievanceMsg.text}
                  </div>
                )}

                <form onSubmit={handleCreateGrievance} className="space-y-3 text-xs">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Issue Description</label>
                    <textarea
                      value={grievanceIssue}
                      onChange={(e) => setGrievanceIssue(e.target.value)}
                      placeholder="e.g. My DigiLocker income certificate was recently updated to ₹4,00,000, please re-sync."
                      rows={4}
                      className="w-full border border-slate-300 rounded p-2 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded shadow"
                  >
                    Submit Grievance to AICTE Desk
                  </button>
                </form>
              </div>

              {/* Queue */}
              <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-base font-bold text-slate-900">Active Grievance Queue</h3>
                <div className="space-y-3 text-xs">
                  {grievancesList.length ? (
                    grievancesList.map(g => (
                      <div key={g.id} className="p-3 border border-slate-200 rounded-lg bg-slate-50 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-slate-800">{g.student_name}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${g.status === "RESOLVED" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                            {g.status}
                          </span>
                        </div>
                        <div className="text-slate-600">{g.issue}</div>
                        {g.resolution && (
                          <div className="p-2 bg-emerald-50 text-emerald-900 rounded border border-emerald-200 text-[11px]">
                            <span className="font-bold">Officer Resolution:</span> {g.resolution}
                          </div>
                        )}
                        {role === "AICTE Officer" && g.status !== "RESOLVED" && (
                          <button
                            onClick={() => handleResolveGrievance(g.id)}
                            className="bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold px-3 py-1 rounded"
                          >
                            Resolve Grievance
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-400">No grievances logged.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 10. TAMPER-EVIDENT AUDIT TRAIL */}
        {activeTab === "audit" && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Tamper-Evident SHA-256 Audit Trail</h3>
                <p className="text-xs text-slate-500 mt-1">Each block hashes SHA256(prev_hash + payload) to ensure cryptographic immutability across student records.</p>
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={verifyAuditChain}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded shadow"
                >
                  Verify Audit Chain
                </button>
                <button
                  onClick={tamperAuditLog}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2 rounded shadow"
                >
                  Trigger Demo Tamper
                </button>
              </div>
            </div>

            {chainStatus && (
              <div className={`verdict ${chainStatus.status === "INTACT" ? "is-ok" : "is-bad"} text-sm font-semibold`} role="status">
                <span className="verdict-stamp">{chainStatus.status === "INTACT" ? "Intact" : "Tampered"}</span>
                {chainStatus.status === "INTACT" ? (
                  <div className="flex items-center gap-2 pr-24">
                    <IconCheck />
                    <div>Chain Intact: Cryptographic audit links verified across {chainStatus.total_records_verified} chained blocks.</div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 pr-24">
                    <IconAlert />
                    <div>TAMPER DETECTED: Verification broken at Record #{chainStatus.failed_at_id}. Reason: {chainStatus.reason}</div>
                  </div>
                )}
              </div>
            )}

            <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg shadow-sm">
              <table className={`w-full text-left text-xs font-mono ${chainStatus ? (chainStatus.status === "INTACT" ? "chain-ok" : "chain-bad") : ""}`}>
                <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="p-3 w-9"><span className="sr-only">Chain</span></th>
                    <th className="p-3">ID</th>
                    <th className="p-3">Actor</th>
                    <th className="p-3">Action</th>
                    <th className="p-3">Payload</th>
                    <th className="p-3">Hash (Current)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log, idx) => {
                    const failedAt = chainStatus && chainStatus.status !== "INTACT" ? chainStatus.failed_at_id : null;
                    const broken = failedAt !== null && log.id === failedAt;
                    const valid = failedAt !== null && log.id < failedAt;
                    return (
                      <tr key={log.id} className={`hover:bg-slate-50${valid ? " is-valid" : ""}`}>
                        <td className="chain-cell" style={{ "--i": idx }}>
                          <span className={`chain-link${broken ? " is-broken" : ""}`}></span>
                          <span className={`chain-node${broken ? " is-broken" : ""}`}></span>
                        </td>
                        <td className="p-3 text-slate-400">#{log.id}</td>
                        <td className="p-3 font-semibold text-slate-800">{log.actor}</td>
                        <td className="p-3 text-blue-700">{log.action}</td>
                        <td className="p-3 text-slate-500 max-w-xs truncate">{log.payload}</td>
                        <td className="p-3 text-slate-400 truncate max-w-[120px]">{log.hash}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      </main>

      {/* Mandatory Regulatory Common Footer */}
      <footer className="colophon py-5 text-center text-xs text-slate-500">
        Mock integrations: APAAR, ABC, DigiLocker, NSP
      </footer>
    </div>
  );
}
