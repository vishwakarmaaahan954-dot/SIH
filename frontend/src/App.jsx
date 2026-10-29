import { useState, useEffect, useMemo, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import CameraQrScanner, { stopAllCameraStreams } from './components/CameraQrScanner';
import {
  DEMO_PERSONAS,
  getSession,
  getUserProfile,
  signIn,
  signUp,
  signOut,
  onAuthStateChange
} from './services/authService';
import { getStudentProfile, COMPREHENSIVE_STUDENT_DATA } from './services/studentService';
import { getInstitutes, getComplianceOverview } from './services/instituteService';
import { getEnrollmentRequests, submitEnrollmentRequest, processEnrollmentRequest, saveStudentOverride, getStudentOverrides } from './services/enrollmentService';
import { getAttendanceQR, recordAttendanceScan } from './services/attendanceService';
import { evaluateSchemes, disburseScholarship } from './services/scholarshipService';
import { getGrievances, fileGrievance, resolveGrievance } from './services/grievanceService';
import { getAuditLogs, verifyAuditChain as verifyAuditChainService } from './services/auditService';

const STUDENT_PERSONAS = DEMO_PERSONAS.filter(p => p.role === "Student");
const TEACHER_PERSONAS = DEMO_PERSONAS.filter(p => p.role === "Institute Admin");
const AICTE_PERSONAS = DEMO_PERSONAS.filter(p => p.role === "AICTE Officer");
const PERSONAS = STUDENT_PERSONAS;

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
const IconAlert = () => <svg {...iconProps}><path d="M10 3 18 17H2L10 3Z" /><path d="M10 8.5v4M10 14.8v.1" /></svg>;
const IconLock = () => <svg {...iconProps}><rect x="4" y="9" width="12" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>;
const IconScan = () => <svg {...iconProps}><path d="M3 7V4h3M14 4h3v3M17 13v3h-3M6 16H3v-3M3 10h14" /></svg>;
const IconRefresh = () => <svg {...iconProps}><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5V6h-2.5" /></svg>;


function SidebarContent({
  role,
  currentUser,
  studentDetails,
  activeTab,
  switchTab,
  theme,
  setTheme,
  onOpenLogin,
  onCloseMobile,
  requestsList,
  grievancesList,
  checkEligibility,
  fetchRequests,
  fetchCompliance,
  fetchGrievances,
  fetchAudit,
  handleVerifyAuditChain,
  isMobile,
  authSession,
  onOpenScanner
}) {
  const studentStatus = studentDetails?.status || currentUser?.status || "ACTIVE";
  const isUnenrolled = studentStatus === "UNENROLLED";

  return (
    <div className="flex flex-col h-full p-4 justify-between select-none">
      <div className="space-y-4 overflow-y-auto pr-1">
        {/* Brand & Logo on left + Login Button on right */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-200/60 dark:border-slate-800/60 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Guilloche size={34} lines={7} draw check className="flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white leading-tight truncate">
                My Aapar
              </h1>
              <p className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold tracking-wide uppercase truncate">
                National Portal
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenLogin}
            title="Open Login Menu"
            className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm flex items-center gap-1.5 flex-shrink-0 transition active:scale-95"
          >
            <IconLock />
            <span>Login</span>
          </button>
        </div>

        {/* Current Active Persona Overview */}
        <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-800/80 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500">
              Active Persona
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              role === "Student"
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                : role === "Institute Admin / Teacher"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                : "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
            }`}>
              {role === "Student" ? "🎓 Student" : role === "Institute Admin / Teacher" ? "🏫 Teacher" : "🏛️ AICTE"}
            </span>
          </div>
          <div>
            <div className="font-bold text-sm text-slate-900 dark:text-white truncate">
              {currentUser?.name || "Active Persona"}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
              {role === "Student"
                ? `APAAR: ...${String(currentUser?.apaar_id || '').slice(-4)}`
                : (currentUser?.tag || currentUser?.inst || "AICTE Central HQ")}
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenLogin}
            title="Switch Persona Account"
            className="w-full py-1.5 px-2 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 transition flex items-center justify-center gap-1.5"
          >
            <IconLock />
            <span>Switch Account</span>
          </button>
        </div>

        {/* Quick Access Navigation */}
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-1">
            Navigation
          </div>
          <nav className="space-y-1 text-xs">
            <button
              type="button"
              onClick={() => switchTab("dashboard", isMobile ? onCloseMobile : undefined)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl font-medium transition ${activeTab === "dashboard" ? "bg-blue-600 text-white font-bold shadow-sm" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"}`}
            >
              <span>📊</span>
              <span>Dashboard</span>
            </button>

            {role === "Student" && (
              <>
                <button
                  type="button"
                  onClick={() => switchTab("attendance", isMobile ? onCloseMobile : undefined)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl font-medium transition ${activeTab === "attendance" ? "bg-blue-600 text-white font-bold shadow-sm" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"}`}
                >
                  <span>📱</span>
                  <span>My Attendance QR</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchTab("schemes", () => { checkEligibility(); if (isMobile) onCloseMobile(); })}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl font-medium transition ${activeTab === "schemes" ? "bg-blue-600 text-white font-bold shadow-sm" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"}`}
                >
                  <span>🎓</span>
                  <span>Scholarship Schemes</span>
                </button>
                {isUnenrolled && (
                  <button
                    type="button"
                    onClick={() => switchTab("requests", isMobile ? onCloseMobile : undefined)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl font-medium transition ${activeTab === "requests" ? "bg-blue-600 text-white font-bold shadow-sm" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"}`}
                  >
                    <span>📝</span>
                    <span>Admission & Transfer</span>
                  </button>
                )}
              </>
            )}

            {role === "Institute Admin / Teacher" && (
              <>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => switchTab("scanner", isMobile ? onCloseMobile : undefined)}
                    className={`flex-1 flex items-center gap-2.5 px-3 py-2 rounded-xl font-medium transition ${activeTab === "scanner" ? "bg-emerald-600 text-white font-bold shadow-sm" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"}`}
                  >
                    <span>📷</span>
                    <span>Scan Attendance</span>
                  </button>
                  {onOpenScanner && (
                    <button
                      type="button"
                      onClick={() => { onOpenScanner(); if (isMobile) onCloseMobile(); }}
                      className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition flex-shrink-0"
                      title="Open Live Camera Scanner"
                    >
                      <IconScan />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => switchTab("institute-requests", () => { fetchRequests(); if (isMobile) onCloseMobile(); })}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl font-medium transition ${activeTab === "institute-requests" ? "bg-emerald-600 text-white font-bold shadow-sm" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"}`}
                >
                  <span>📋</span>
                  <span>Requests ({requestsList.filter(r => r.state === 'SUBMITTED').length})</span>
                </button>
              </>
            )}

            {role === "AICTE Officer" && (
              <>
                <button
                  type="button"
                  onClick={() => switchTab("compliance", () => { fetchCompliance(); if (isMobile) onCloseMobile(); })}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl font-medium transition ${activeTab === "compliance" ? "bg-purple-600 text-white font-bold shadow-sm" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"}`}
                >
                  <span>📡</span>
                  <span>Compliance Radar</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchTab("reconciliation", () => { fetchCompliance(); if (isMobile) onCloseMobile(); })}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl font-medium transition ${activeTab === "reconciliation" ? "bg-purple-600 text-white font-bold shadow-sm" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"}`}
                >
                  <span>🔄</span>
                  <span>Nightly Drift Check</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => switchTab("grievances", () => { fetchGrievances(); if (isMobile) onCloseMobile(); })}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl font-medium transition ${activeTab === "grievances" ? "bg-blue-600 text-white font-bold shadow-sm" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"}`}
            >
              <span>⚖️</span>
              <span>Grievances ({grievancesList.length})</span>
            </button>

            <button
              type="button"
              onClick={() => switchTab("audit", () => { fetchAudit(); handleVerifyAuditChain(); if (isMobile) onCloseMobile(); })}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl font-medium transition ${activeTab === "audit" ? "bg-blue-600 text-white font-bold shadow-sm" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"}`}
            >
              <span>🔗</span>
              <span>Chained Audit Trail</span>
            </button>
          </nav>
        </div>
      </div>

      {/* Bottom Section: Light & Dark Mode Switcher */}
      <div className="pt-3 border-t border-slate-200/60 dark:border-slate-800/60 space-y-3">
       
        {/* Mode Switcher Button */}
        <div className="grid grid-cols-2 p-1 bg-slate-200/60 dark:bg-slate-800/80 rounded-xl text-xs font-semibold backdrop-blur-sm border border-slate-300/40 dark:border-slate-700/50">
          <button
            type="button"
            onClick={() => setTheme('light')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg transition-all duration-200 ${
              theme === 'light'
                ? 'bg-white text-slate-900 shadow-sm font-bold'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
            aria-label="Switch to Light Mode"
          >
            <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <span>Light</span>
          </button>
          <button
            type="button"
            onClick={() => setTheme('dark')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg transition-all duration-200 ${
              theme === 'dark'
                ? 'bg-slate-700 text-white shadow-sm font-bold'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
            aria-label="Switch to Dark Mode"
          >
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
            <span>Dark</span>
          </button>
        </div>

        <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 px-1 pt-1 font-mono">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            AICTE Online
          </span>
          <span>SIH 2026</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [role, setRole] = useState("Student");
  const [selectedApaar, setSelectedApaar] = useState("100000000001");
  const [selectedTeacherName, setSelectedTeacherName] = useState(TEACHER_PERSONAS[0].name);
  const [selectedAicteName, setSelectedAicteName] = useState(AICTE_PERSONAS[0].name);
  const [currentUser, setCurrentUser] = useState(PERSONAS[0]);
  const [activeTab, setActiveTab] = useState("dashboard");

  const switchTab = (tabName, extraCallback) => {
    if (tabName !== "scanner") {
      stopAllCameraStreams();
      setIsGlobalScannerOpen(false);
    }
    setActiveTab(tabName);
    if (typeof extraCallback === 'function') {
      extraCallback();
    }
  };

  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('my-aapar-theme');
      if (saved === 'dark' || saved === 'light') return saved;
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    }
    return 'dark';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      localStorage.setItem('my-aapar-theme', theme);
    } catch {}
  }, [theme]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [authModalTab, setAuthModalTab] = useState("student"); // "student" | "teacher" | "aicte"

  const handleSelectPersona = (p) => {
    stopAllCameraStreams();
    setIsGlobalScannerOpen(false);
    setIdentityMode("persona");
    if (p.role === "Student") {
      setRole("Student");
      setSelectedApaar(p.apaar_id);
      setCurrentUser(p);
    } else if (p.role === "Institute Admin") {
      setRole("Institute Admin / Teacher");
      setSelectedTeacherName(p.name);
      setCurrentUser(p);
      if (p.institute_id) {
        setScannerInstitute(p.institute_id);
      }
    } else if (p.role === "AICTE Officer") {
      setRole("AICTE Officer");
      setSelectedAicteName(p.name);
      setCurrentUser(p);
    }
    setActiveTab("dashboard");
    setIsAuthModalOpen(false);
    setIsSidebarOpen(false);
  };

  // Identity Mode: "persona" | "supabase"
  const [identityMode, setIdentityMode] = useState("persona");

  // Supabase Auth State
  const [authSession, setAuthSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState("signin"); // "signin" | "signup"
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authSignupRole, setAuthSignupRole] = useState("Student");
  const [authSignupApaar, setAuthSignupApaar] = useState("");
  const [authSignupInstitute, setAuthSignupInstitute] = useState("INST_DEL_01");
  const [authSignupCategory, setAuthSignupCategory] = useState("General");
  const [authSignupGender, setAuthSignupGender] = useState("Female");
  const [authSignupIncome, setAuthSignupIncome] = useState("450000");
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Rotating QR state
  const [qrToken, setQrToken] = useState("");
  const [countdown, setCountdown] = useState(30);
  const [qrError, setQrError] = useState(null);
  const [copiedToken, setCopiedToken] = useState(false);

  // Scheme state
  const [schemeResults, setSchemeResults] = useState([]);
  const [disbursalMsg, setDisbursalMsg] = useState(null);
  const [isEvaluatingSchemes, setIsEvaluatingSchemes] = useState(false);

  // AICTE & Compliance state
  const [complianceData, setComplianceData] = useState([]);
  const [ghostStudents, setGhostStudents] = useState([]);
  const [reconciliationResult, setReconciliationResult] = useState(null);

  // Requests state
  const [requestsList, setRequestsList] = useState([]);
  const [institutions, setInstitutions] = useState([
    { id: "INST_DEL_01", aicte_code: "1-1001", name: "Delhi Engineering & Technology Institute", sanctioned_intake: 120, verified_students: 118, available_seats: 2, state: "Delhi" },
    { id: "INST_UP_02", aicte_code: "1-1002", name: "National Institute of Applied Sciences", sanctioned_intake: 100, verified_students: 95, available_seats: 5, state: "Uttar Pradesh" },
    { id: "INST_KA_03", aicte_code: "1-1003", name: "Bangalore College of Advanced Computing", sanctioned_intake: 60, verified_students: 45, available_seats: 15, state: "Karnataka" },
    { id: "INST_MH_04", aicte_code: "1-1004", name: "Maharashtra Institute of Information Tech", sanctioned_intake: 120, verified_students: 100, available_seats: 20, state: "Maharashtra" },
    { id: "INST_TN_05", aicte_code: "1-1005", name: "Chennai Autonomous Engineering College", sanctioned_intake: 100, verified_students: 20, available_seats: 80, state: "Tamil Nadu" },
    { id: "INST_FULL_06", aicte_code: "1-1006", name: "Apex Institute of Advanced Engineering", sanctioned_intake: 50, verified_students: 50, available_seats: 0, state: "Maharashtra" },
  ]);
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
  const [scannerMode, setScannerMode] = useState("camera"); // "camera" | "quick" | "manual"
  const [scannerTargetStudent, setScannerTargetStudent] = useState("100000000001");
  const [scannerTokenInput, setScannerTokenInput] = useState("");
  const [scannerInstitute, setScannerInstitute] = useState("INST_DEL_01");
  const [scanResult, setScanResult] = useState(null);
  const [isGlobalScannerOpen, setIsGlobalScannerOpen] = useState(false);

  // Student Profile Data
  const [studentDetails, setStudentDetails] = useState(COMPREHENSIVE_STUDENT_DATA["100000000001"] || null);

  // 1. Initial Session Check & Auth State Subscription
  useEffect(() => {
    fetchInstitutions();
    getSession().then(session => {
      if (session?.user) {
        setAuthSession(session);
        getUserProfile(session.user.id).then(profile => {
          if (profile) {
            setUserProfile(profile);
            if (profile.role === 'institute_admin') setRole("Institute Admin / Teacher");
            else if (profile.role === 'aicte_officer') setRole("AICTE Officer");
            else setRole("Student");
            if (profile.apaar_id) setSelectedApaar(profile.apaar_id);
          }
        });
      }
    });

    const { data: { subscription } } = onAuthStateChange((event, session) => {
      setAuthSession(session);
      if (session?.user) {
        getUserProfile(session.user.id).then(profile => {
          if (profile) {
            setUserProfile(profile);
            if (profile.role === 'institute_admin') setRole("Institute Admin / Teacher");
            else if (profile.role === 'aicte_officer') setRole("AICTE Officer");
            else setRole("Student");
            if (profile.apaar_id) setSelectedApaar(profile.apaar_id);
          }
        });
      } else {
        setUserProfile(null);
      }
    });

    return () => subscription?.unsubscribe?.();
  }, []);

  // Sync user object on persona switch or identity mode toggle with full force-refresh
  useEffect(() => {
    let targetApaar = selectedApaar;
    if (identityMode === "supabase" && authSession?.user) {
      targetApaar = userProfile?.apaar_id || authSession.user.user_metadata?.apaar_id || selectedApaar;
      setCurrentUser({
        apaar_id: targetApaar,
        name: userProfile?.name || authSession.user.email?.split('@')[0] || "Supabase Verified User",
        role: role,
        tag: `Supabase Auth ID: ${authSession.user.id.slice(0, 8)}...`,
        income: "₹4,50,000",
        cat: "General",
        gender: "Female",
        inst: userProfile?.institute_id || "INST_DEL_01",
        status: "ACTIVE",
        email: authSession.user.email,
        auth_uid: authSession.user.id
      });
    } else {
      if (role === "Student") {
        const p = STUDENT_PERSONAS.find(p => p.apaar_id === selectedApaar) || STUDENT_PERSONAS[0];
        setCurrentUser(p);
        targetApaar = p.apaar_id;
      } else if (role === "Institute Admin / Teacher") {
        const tp = TEACHER_PERSONAS.find(t => t.name === selectedTeacherName) || TEACHER_PERSONAS[0];
        setCurrentUser(tp);
        if (tp.institute_id) setScannerInstitute(tp.institute_id);
      } else if (role === "AICTE Officer") {
        const ap = AICTE_PERSONAS.find(a => a.name === selectedAicteName) || AICTE_PERSONAS[0];
        setCurrentUser(ap);
      }
    }

    // Immediately pre-populate comprehensive baseline profile to avoid 0/empty flash for students
    if (role === "Student") {
      const overrides = getStudentOverrides();
      const ov = targetApaar ? overrides[String(targetApaar)] : null;

      if (COMPREHENSIVE_STUDENT_DATA[targetApaar]) {
        const base = { ...COMPREHENSIVE_STUDENT_DATA[targetApaar] };
        if (ov) {
          if (ov.status) base.status = ov.status;
          if (ov.institute_name) base.institute_name = ov.institute_name;
          if (ov.institute_id) base.institute_id = ov.institute_id;
        }
        setStudentDetails(base);
        if (ov) {
          setCurrentUser(prev => ({
            ...prev,
            status: ov.status || prev.status,
            inst: ov.institute_name || ov.institute_id || prev.inst
          }));
        }
      } else {
        const demo = DEMO_PERSONAS.find(p => p.apaar_id === targetApaar);
        if (demo) {
          const effStatus = ov?.status || demo.status;
          const effInst = ov?.institute_name || ov?.institute_id || demo.inst || 'None';
          setStudentDetails({
            apaar_id: demo.apaar_id,
            name: demo.name,
            category: demo.cat,
            gender: demo.gender,
            institute_name: effInst,
            status: effStatus,
            attendance: { attendance_pct: 0, days_present: 0, days_held: 0 }
          });
          if (ov) {
            setCurrentUser(prev => ({
              ...prev,
              status: effStatus,
              inst: effInst
            }));
          }
        }
      }
    }

    // Force clear stale status messages & reset timers
    setDisbursalMsg(null);
    setRequestMsg(null);
    setGrievanceMsg(null);
    setScanResult(null);
    setQrError(null);
    setCountdown(30);

    // Force fetch all fresh data for the new persona immediately
    if (role === "Student") {
      fetchStudentProfile(targetApaar);
      fetchQRToken(targetApaar);
      checkEligibility(targetApaar);
    } else if (role === "AICTE Officer") {
      fetchCompliance();
      fetchAudit();
    }
    fetchRequests();
    fetchGrievances();
  }, [selectedApaar, selectedTeacherName, selectedAicteName, identityMode, authSession, userProfile, role]);

  const fetchStudentProfile = async (apaarId) => {
    if (!apaarId) return;
    setIsLoadingProfile(true);
    try {
      const data = await getStudentProfile(apaarId);
      if (data) {
        setStudentDetails(data);
        if (role === "Student") {
          setCurrentUser(prev => ({
            ...prev,
            name: data.name || prev.name,
            status: data.status || prev.status,
            inst: data.institute_name || data.institute_id || prev.inst,
            cat: data.category || prev.cat,
            gender: data.gender || prev.gender,
            income: data.family_income ? `₹${Number(data.family_income).toLocaleString('en-IN')}` : prev.income
          }));
        }
      }
    } catch (e) {
      console.error("fetchStudentProfile error:", e);
    } finally {
      setIsLoadingProfile(false);
    }
  };

  const fetchInstitutions = async () => {
    try {
      const data = await getInstitutes();
      setInstitutions(data);
    } catch (e) {
      console.error("fetchInstitutions error:", e);
    }
  };

  const fetchRequests = async () => {
    try {
      const data = await getEnrollmentRequests(null);
      setRequestsList(data);
    } catch (e) {
      console.error("fetchRequests error:", e);
    }
  };

  const fetchGrievances = async () => {
    try {
      const apaar = role === "Student" ? currentUser.apaar_id : null;
      const data = await getGrievances(apaar);
      setGrievancesList(data);
    } catch (e) {
      console.error("fetchGrievances error:", e);
    }
  };

  // Rotating QR Timer (Student)
  const fetchQRToken = async (apaarId) => {
    try {
      const data = await getAttendanceQR(apaarId || currentUser.apaar_id);
      if (data && data.signed_token) {
        setQrToken(data.signed_token);
        setScannerTokenInput(data.signed_token);
        setQrError(null);
        setCountdown(data.expires_in_seconds || 30);
        return data.signed_token;
      } else {
        setQrError("QR Locked (Requires active verified enrollment)");
        setQrToken("");
        return null;
      }
    } catch (e) {
      setQrError(e.message || "QR Locked (Requires active verified enrollment)");
      setQrToken("");
      return null;
    }
  };

  useEffect(() => {
    let timer;
    if (role === "Student") {
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
  }, [role, currentUser.apaar_id]);

  useEffect(() => {
    fetchInstitutions();
    fetchRequests();
    fetchGrievances();
    fetchAudit();
  }, []);

  // Turn off camera access whenever switching away from the faculty scanner tab or when switching roles
  useEffect(() => {
    if (activeTab !== "scanner" || role !== "Institute Admin / Teacher") {
      setIsGlobalScannerOpen(false);
      stopAllCameraStreams();
    }
  }, [role, activeTab]);
  // Check Schemes
  const checkEligibility = async (targetApaar, overrideAttendance) => {
    setIsEvaluatingSchemes(true);
    try {
      const apaar = (typeof targetApaar === 'string' && targetApaar) ? targetApaar : currentUser.apaar_id;
      const attOverride = typeof overrideAttendance === 'number' ? overrideAttendance : (typeof studentDetails?.attendance?.attendance_pct === 'number' ? studentDetails.attendance.attendance_pct : undefined);
      const data = await evaluateSchemes(apaar, attOverride);
      setSchemeResults(data);
    } catch (e) {
      console.error("checkEligibility error:", e);
    } finally {
      setIsEvaluatingSchemes(false);
    }
  };

  // Compliance Data
  const fetchCompliance = async () => {
    try {
      const data = await getComplianceOverview();
      setComplianceData(data);
      // Ghost student anomalies (enrolled with 0 attendance)
      setGhostStudents([
        { apaar_id: "100000000005", name: "Suresh Kumar", institute_id: "INST_DEL_01", scans_recorded: 0, enrollment_date: "2026-08-01", days_enrolled: 84, flagged_reason: "Zero attendance recorded within 15-day confirmation window" }
      ]);
    } catch (e) {
      console.error("fetchCompliance error:", e);
    }
  };

  // Audit Logs
  const fetchAudit = async () => {
    try {
      const data = await getAuditLogs();
      setAuditLogs(data);
    } catch (e) {
      console.error("fetchAudit error:", e);
    }
  };

  const handleVerifyAuditChain = async () => {
    try {
      const data = await verifyAuditChainService(auditLogs);
      setChainStatus(data.verified ? {
        status: "INTACT",
        total_records_verified: data.count,
        latest_hash: data.latest_hash
      } : {
        status: "TAMPERED",
        failed_at_id: data.broken_id,
        reason: data.reason
      });
    } catch (e) {
      console.error("verifyAuditChain error:", e);
    }
  };

  const tamperAuditLog = () => {
    // Demonstration of tamper detection: modify payload in local log view to show verification fail
    if (auditLogs.length > 1) {
      const tampered = [...auditLogs];
      tampered[1] = {
        ...tampered[1],
        payload: JSON.stringify({ event: "ILLEGAL_TAMPER_MODIFIED", student_id: "MALICIOUS_OVERRIDE" })
      };
      setAuditLogs(tampered);
      setChainStatus({
        status: "TAMPERED",
        failed_at_id: tampered[1].id,
        reason: `Cryptographic digest mismatch: Hash altered or previous linkage corrupted at Block #${tampered[1].id}`
      });
    }
  };

  const handleExecuteScan = async (tokenToUse) => {
    try {
      let token = (tokenToUse || scannerTokenInput || "").trim();
      if (!token) {
        setScanResult({ status: "REJECTED", reason: "Please provide a signed QR token or use the camera scanner" });
        return;
      }

      // Check if scanned QR is JSON
      if (token.startsWith("{") && token.endsWith("}")) {
        try {
          const parsed = JSON.parse(token);
          if (parsed.signed_token) token = parsed.signed_token;
          else if (parsed.token) token = parsed.token;
          else if (parsed.apaar_id) {
            return await handleQuickScanStudent(parsed.apaar_id);
          }
        } catch {
          // Non-JSON token, proceed with normal string validation
        }
      }

      // Check if scanned QR is a 12-digit student APAAR ID card
      const cleanDigits = token.replace(/\D/g, "");
      if (cleanDigits.length === 12 && !token.includes(":")) {
        setScannerTokenInput(cleanDigits);
        return await handleQuickScanStudent(cleanDigits);
      }

      setScannerTokenInput(token);
      const data = await recordAttendanceScan({
        signed_token: token,
        scanner_institute_id: scannerInstitute,
        device_id: "FACULTY_TAB_4A"
      });
      setScanResult(data);
      fetchStudentProfile(currentUser.apaar_id);
      fetchCompliance();
      fetchAudit();
    } catch (e) {
      setScanResult({
        status: "REJECTED",
        reason: e.message || "Validation rejected by AICTE compliance engine"
      });
    }
  };

  const handleQuickScanStudent = async (studentApaarId) => {
    try {
      setScanResult(null);
      const data = await getAttendanceQR(studentApaarId);
      if (data?.signed_token) {
        setScannerTokenInput(data.signed_token);
        await handleExecuteScan(data.signed_token);
      } else {
        setScanResult({
          status: "REJECTED",
          reason: "Student has no active verified enrollment at this institution"
        });
      }
    } catch (e) {
      setScanResult({ status: "REJECTED", reason: e.message || "Error fetching student live QR token" });
    }
  };

  const handleResetAttendance = () => {
    setScanResult(null);
    alert("Attendance demonstration scanner ready for new session.");
  };

  const handleDisbursal = async (schemeId, token) => {
    try {
      const data = await disburseScholarship({
        apaar_id: currentUser.apaar_id,
        scheme_id: schemeId,
        eligibility_token: token
      });
      setDisbursalMsg({ type: "SUCCESS", text: `Payment Disbursed! Claim ID: ${data.claim_id || data.id}` });
      checkEligibility(currentUser.apaar_id);
      fetchAudit();
    } catch (e) {
      setDisbursalMsg({ type: "ERROR", text: e.message || "Disbursal Blocked" });
    }
  };

  const handleSimulateAttendanceDrop = () => {
    // Modify student attendance locally to demonstrate Scenario 9: Real-time drift refusal
    setStudentDetails(prev => ({
      ...prev,
      attendance: { ...(prev?.attendance || {}), attendance_pct: 50.0 }
    }));
    setDisbursalMsg({
      type: "INFO",
      text: "[Scenario 9 Test] Attendance dropped to 50.0%. Re-evaluating criteria gate..."
    });
    checkEligibility(currentUser.apaar_id, 50.0);
  };

  const handleCreateRequest = async (e) => {
    e.preventDefault();
    const targetInst = institutions.find(i => i.id === joinForm.institute_id);
    const availableSeats = targetInst?.available_seats !== undefined
      ? targetInst.available_seats
      : Math.max(0, (targetInst?.sanctioned_intake || 0) - (targetInst?.verified_students || 0));
    if (availableSeats <= 0) {
      alert(`Alert: Seats are full! ${targetInst?.name || 'Selected institute'} has 0 available seats.`);
      return;
    }
    const studentApaar = currentUser?.apaar_id || selectedApaar || "100000000008";
    const toInstId = joinForm.type === "transfer" ? joinForm.target_institute_id : joinForm.institute_id;
    const fromInstId = joinForm.type === "transfer" ? joinForm.institute_id : null;

    try {
      const data = await submitEnrollmentRequest({
        apaar_id: studentApaar,
        institute_id: joinForm.institute_id,
        program: joinForm.program,
        year: parseInt(joinForm.year),
        type: joinForm.type,
        target_institute_id: joinForm.target_institute_id
      });
      setRequestMsg({ type: "SUCCESS", text: data.message || "Admission request submitted and sent to institute queue!" });

      const newReqObj = {
        request_id: data.request_id || `REQ_${Date.now()}`,
        id: data.request_id || `REQ_${Date.now()}`,
        apaar_id: studentApaar,
        to_inst: toInstId,
        from_inst: fromInstId,
        state: "SUBMITTED",
        program: joinForm.program,
        year: parseInt(joinForm.year),
        type: joinForm.type,
        created_at: new Date().toISOString()
      };
      setRequestsList(prev => [newReqObj, ...prev.filter(r => (r.request_id || r.id) !== newReqObj.id)]);

      fetchRequests();
      fetchAudit();
    } catch (err) {
      setRequestMsg({ type: "ERROR", text: err.message || "Request submission failed" });
    }
  };

  const handleProcessRequest = async (requestId, action) => {
    try {
      const data = await processEnrollmentRequest({ request_id: requestId, action });
      if (action === "APPROVE") {
        const req = requestsList.find(r => (r.request_id || r.id) === requestId);
        const targetInstId = req?.to_inst || req?.from_inst || scannerInstitute;
        const targetInstObj = institutions.find(i => i.id === targetInstId);

        // Update in-memory DEMO_PERSONAS record so status transitions to ACTIVE
        const demoStudent = DEMO_PERSONAS.find(p => p.apaar_id === req?.apaar_id);
        if (demoStudent) {
          demoStudent.status = "ACTIVE";
          demoStudent.inst = targetInstId;
        }

        // Persist student status override across page refreshes and persona toggles
        if (req?.apaar_id) {
          saveStudentOverride(req.apaar_id, {
            status: "ACTIVE",
            institute_id: targetInstId,
            institute_name: targetInstObj?.name || targetInstId
          });
        }

        // If currently active student is this persona, update active state immediately
        if (currentUser?.apaar_id === req?.apaar_id) {
          setCurrentUser(prev => ({
            ...prev,
            status: "ACTIVE",
            inst: targetInstObj?.name || targetInstId
          }));
          setStudentDetails(prev => ({
            ...prev,
            status: "ACTIVE",
            institute_id: targetInstId,
            institute_name: targetInstObj?.name || targetInstId
          }));
        }

        setInstitutions(prev => prev.map(inst => {
          if (inst.id === targetInstId) {
            const newVerified = (inst.verified_students || 0) + 1;
            const newSeats = typeof inst.available_seats === 'number'
              ? Math.max(0, inst.available_seats - 1)
              : Math.max(0, (inst.sanctioned_intake || 0) - newVerified);
            return {
              ...inst,
              verified_students: newVerified,
              available_seats: newSeats
            };
          }
          return inst;
        }));
      }
      alert(`${action} successful: ${data.message || 'Request processed'}`);
      fetchRequests();
      fetchInstitutions();
      if (currentUser?.apaar_id) {
        fetchStudentProfile(currentUser.apaar_id);
      }
      fetchAudit();
    } catch (e) {
      alert(`Action Blocked by Gate: ${e.message}`);
    }
  };

  const handleCreateGrievance = async (e) => {
    e.preventDefault();
    if (!grievanceIssue.trim()) return;
    try {
      await fileGrievance({ apaar_id: currentUser.apaar_id, issue: grievanceIssue });
      setGrievanceMsg({ type: "SUCCESS", text: "Grievance lodged successfully and cryptographically recorded." });
      setGrievanceIssue("");
      fetchGrievances();
      fetchAudit();
    } catch (e) {
      setGrievanceMsg({ type: "ERROR", text: e.message || "Failed to submit grievance" });
    }
  };

  const handleResolveGrievance = async (gid) => {
    const resText = prompt("Enter resolution notes for student grievance:", "Demographic records verified against DigiLocker master cache.");
    if (!resText) return;
    try {
      await resolveGrievance({ grievance_id: gid, resolution: resText });
      fetchGrievances();
      fetchAudit();
    } catch (e) {
      console.error("handleResolveGrievance error:", e);
    }
  };

  const handleRunReconciliation = () => {
    setReconciliationResult({
      status: "COMPLETED",
      reconciled_institutions: 5,
      records_checked: 378,
      anomalies_detected: 2,
      details: [
        { institute_id: "INST_UP_02", issue: "Faculty-Student Ratio Breach (31.67:1 > 20.0:1 threshold)" },
        { institute_id: "INST_TN_05", issue: "Severe Under-filling (20.0% occupancy < 40% threshold)" }
      ]
    });
    fetchCompliance();
  };

  // Auth Handler: Sign In / Sign Up
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);

    try {
      if (authMode === "signin") {
        const { user, profile } = await signIn(authEmail, authPassword);
        setAuthSession({ user });
        setUserProfile(profile);
        setIdentityMode("supabase");
        if (profile?.role === 'institute_admin') setRole("Institute Admin / Teacher");
        else if (profile?.role === 'aicte_officer') setRole("AICTE Officer");
        else setRole("Student");
        setIsAuthModalOpen(false);
      } else {
        const targetRole = authModalTab === "teacher" ? "Institute Admin / Teacher" : (authModalTab === "aicte" ? "AICTE Officer" : authSignupRole);
        await signUp({
          email: authEmail,
          password: authPassword,
          role: targetRole,
          apaar_id: targetRole === "Student" ? (authSignupApaar.trim() || null) : null,
          institute_id: authSignupInstitute,
          category: authSignupCategory,
          gender: authSignupGender,
          family_income: parseFloat(authSignupIncome) || 0
        });
        alert("Registration submitted! If auto-confirm is enabled, you can now sign in.");
        setAuthMode("signin");
      }
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setAuthSession(null);
    setUserProfile(null);
    alert("Signed out from Supabase Auth session.");
  };



  // Phones: label each table cell with its column header so rows can render as cards (see table.stack in index.css).
  const mainRef = useRef(null);
  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;
    let raf = 0;
    const label = () => {
      raf = 0;
      root.querySelectorAll("table.stack").forEach((t) => {
        const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
        t.querySelectorAll("tbody tr").forEach((tr) =>
          [...tr.children].forEach((td, i) => {
            if (heads[i] && td.getAttribute("data-label") !== heads[i]) td.setAttribute("data-label", heads[i]);
          })
        );
      });
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(label); };
    schedule();
    const mo = new MutationObserver(schedule);
    mo.observe(root, { childList: true, subtree: true });
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const attPct = studentDetails?.attendance?.attendance_pct ?? 0;

  const studentStatus = studentDetails?.status || currentUser?.status || "ACTIVE";
  const isUnenrolled = studentStatus === "UNENROLLED";

  const selectedInst = institutions.find(i => i.id === joinForm.institute_id) || institutions[0];
  const selectedInstIntake = selectedInst?.sanctioned_intake || 0;
  const selectedInstVerified = selectedInst?.verified_students || 0;
  const selectedInstAvailableSeats = selectedInst?.available_seats !== undefined
    ? selectedInst.available_seats
    : Math.max(0, selectedInstIntake - selectedInstVerified);

  const currentInstId = currentUser?.institute_id || scannerInstitute || "INST_DEL_01";
  const currentInst = institutions.find(i => i.id === currentInstId) || institutions[0];
  const currentInstIntake = currentInst?.sanctioned_intake || 120;
  const currentInstVerified = currentInst?.verified_students || 0;
  const currentInstAvailableSeats = currentInst?.available_seats !== undefined
    ? currentInst.available_seats
    : Math.max(0, currentInstIntake - currentInstVerified);

  const copyToClipboard = (text) => {
    navigator.clipboard?.writeText(text);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  return (
    <div className="min-h-screen flex font-sans text-slate-800 dark:text-slate-100 bg-[#f4f6fc] dark:bg-[#090d16] transition-colors duration-200">
      {/* Desktop Persistent Left Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 fixed inset-y-0 left-0 z-40 glass-sidebar">
        <SidebarContent
          role={role}
          currentUser={currentUser}
          studentDetails={studentDetails}
          activeTab={activeTab}
          switchTab={switchTab}
          theme={theme}
          setTheme={setTheme}
          onOpenLogin={() => {
            setAuthModalTab(role === "Institute Admin / Teacher" ? "teacher" : (role === "AICTE Officer" ? "aicte" : "student"));
            setIsAuthModalOpen(true);
          }}
          requestsList={requestsList}
          grievancesList={grievancesList}
          checkEligibility={checkEligibility}
          fetchRequests={fetchRequests}
          fetchCompliance={fetchCompliance}
          fetchGrievances={fetchGrievances}
          fetchAudit={fetchAudit}
          handleVerifyAuditChain={handleVerifyAuditChain}
          authSession={authSession}
          onOpenScanner={() => {
            setScanResult(null);
            setIsGlobalScannerOpen(true);
          }}
        />
      </aside>

      {/* Mobile Drawer Left Sidebar */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm"
            onClick={() => setIsSidebarOpen(false)}
          />
          <aside className="relative flex flex-col w-72 max-w-[85vw] h-full glass-sidebar z-10 shadow-2xl">
            <SidebarContent
              role={role}
              currentUser={currentUser}
              studentDetails={studentDetails}
              activeTab={activeTab}
              switchTab={switchTab}
              theme={theme}
              setTheme={setTheme}
              onOpenLogin={() => {
                setAuthModalTab(role === "Institute Admin / Teacher" ? "teacher" : (role === "AICTE Officer" ? "aicte" : "student"));
                setIsAuthModalOpen(true);
                setIsSidebarOpen(false);
              }}
              onCloseMobile={() => setIsSidebarOpen(false)}
              requestsList={requestsList}
              grievancesList={grievancesList}
              checkEligibility={checkEligibility}
              fetchRequests={fetchRequests}
              fetchCompliance={fetchCompliance}
              fetchGrievances={fetchGrievances}
              fetchAudit={fetchAudit}
              handleVerifyAuditChain={handleVerifyAuditChain}
              isMobile
              authSession={authSession}
              onOpenScanner={() => {
                setScanResult(null);
                setIsGlobalScannerOpen(true);
              }}
            />
          </aside>
        </div>
      )}

      {/* Main App Column */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        {/* Mobile Floating Sidebar Toggle */}
        <div className="lg:hidden fixed top-3 left-3 z-30">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800/80 shadow-md backdrop-blur-md text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 font-bold text-xs transition active:scale-95"
            aria-label="Open navigation sidebar"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span>Menu</span>
          </button>
        </div>

      {/* LOGIN Modal */}
      {isAuthModalOpen && (
        <div className="modal-scrim fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="modal-sheet bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <Guilloche size={32} lines={6} check />
                <div>
                  <h3 className="font-extrabold text-slate-900 dark:text-white text-base">
                    My Aapar Gateway Access
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Choose role, sample instant test personas, or sign in with verified credentials
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setIsAuthModalOpen(false); setAuthError(null); }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white font-bold p-1 text-base leading-none"
              >
                ✕
              </button>
            </div>

            {/* The 3 Required Tabs: Student, Teacher, AICTE */}
            <div className="grid grid-cols-3 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => { setAuthModalTab("student"); setAuthSignupRole("Student"); }}
                className={`py-2 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  authModalTab === "student"
                    ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-sm font-bold"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                }`}
              >
                <span>🎓</span>
                <span>Student</span>
              </button>
              <button
                type="button"
                onClick={() => { setAuthModalTab("teacher"); setAuthSignupRole("Institute Admin / Teacher"); }}
                className={`py-2 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  authModalTab === "teacher"
                    ? "bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-300 shadow-sm font-bold"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                }`}
              >
                <span>🏫</span>
                <span>Teacher</span>
              </button>
              <button
                type="button"
                onClick={() => { setAuthModalTab("aicte"); setAuthSignupRole("AICTE Officer"); }}
                className={`py-2 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  authModalTab === "aicte"
                    ? "bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-300 shadow-sm font-bold"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                }`}
              >
                <span>🏛️</span>
                <span>AICTE</span>
              </button>
            </div>

            {/* PART A: TEST PERSONA OPTION FOR EASY SAMPLING */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-amber-500 font-bold">⚡</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Test Persona Option (Easy Sampling)
                  </span>
                </div>
                <span className="text-[11px] text-slate-400">1-Click instant test load</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                {authModalTab === "student" && STUDENT_PERSONAS.map(p => {
                  const isCurrent = currentUser?.name === p.name && role === "Student";
                  return (
                    <div
                      key={p.apaar_id}
                      onClick={() => handleSelectPersona(p)}
                      className={`p-2.5 rounded-xl border transition cursor-pointer group ${
                        isCurrent
                          ? "border-blue-600 ring-2 ring-blue-500/30 bg-blue-50/60 dark:bg-blue-900/30"
                          : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 hover:border-blue-500 dark:hover:border-blue-400"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate">
                          {p.name}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          p.status === "ACTIVE"
                            ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                            : p.status === "FLAGGED"
                            ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                            : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                        }`}>
                          {p.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                        {p.tag}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span>APAAR: ...{String(p.apaar_id).slice(-4)}</span>
                        <span className={`font-semibold ${isCurrent ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-blue-600 dark:text-blue-400 group-hover:underline"}`}>
                          {isCurrent ? "✓ Active" : "Sample →"}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {authModalTab === "teacher" && TEACHER_PERSONAS.map((p, idx) => {
                  const isCurrent = currentUser?.name === p.name && role === "Institute Admin / Teacher";
                  return (
                    <div
                      key={idx}
                      onClick={() => handleSelectPersona(p)}
                      className={`p-2.5 rounded-xl border transition cursor-pointer group ${
                        isCurrent
                          ? "border-emerald-600 ring-2 ring-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-900/30"
                          : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 hover:border-emerald-500 dark:hover:border-emerald-400"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 truncate">
                          {p.name}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                          Faculty
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                        {p.tag}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span className="truncate">{p.inst}</span>
                        <span className={`font-semibold ${isCurrent ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-emerald-600 dark:text-emerald-400 group-hover:underline"}`}>
                          {isCurrent ? "✓ Active" : "Sample →"}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {authModalTab === "aicte" && AICTE_PERSONAS.map((p, idx) => {
                  const isCurrent = currentUser?.name === p.name && role === "AICTE Officer";
                  return (
                    <div
                      key={idx}
                      onClick={() => handleSelectPersona(p)}
                      className={`p-2.5 rounded-xl border transition cursor-pointer group ${
                        isCurrent
                          ? "border-purple-600 ring-2 ring-purple-500/30 bg-purple-50/60 dark:bg-purple-900/30"
                          : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 hover:border-purple-500 dark:hover:border-purple-400"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 truncate">
                          {p.name}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                          Regulator
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                        {p.tag}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span className="truncate">{p.region || "Central HQ"}</span>
                        <span className={`font-semibold ${isCurrent ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-purple-600 dark:text-purple-400 group-hover:underline"}`}>
                          {isCurrent ? "✓ Active" : "Sample →"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* PART B: SUPABASE AUTHENTICATION GATEWAY */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {authSession?.user ? "Current Account: " + authSession.user.email : `Account Details (${authModalTab === "student" ? "Student" : authModalTab === "teacher" ? "Faculty" : "AICTE"})`}
                </span>
                {!authSession?.user && (
                  <button
                    type="button"
                    onClick={() => setAuthMode(authMode === "signin" ? "signup" : "signin")}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {authMode === "signin" ? "Need an account? Register" : "Already registered? Sign In"}
                  </button>
                )}
              </div>

              {authSession?.user ? (
                <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-emerald-900 dark:text-emerald-200">
                      ✓ Active Session
                    </span>
                    <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-emerald-300 dark:border-emerald-700">
                      {userProfile?.role?.toUpperCase() || role}
                    </span>
                  </div>
                  <div className="text-slate-600 dark:text-slate-300 text-[11px] font-mono break-all">
                    User: <strong>{currentUser.name}</strong>
                  </div>
                  <div className="flex justify-between items-center pt-1">
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="text-red-600 hover:text-red-700 font-bold underline"
                    >
                      Sign Out
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAuthModalOpen(false)}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleAuthSubmit} className="space-y-3 text-xs">
                  {authError && (
                    <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs">
                      {authError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                        Email Address
                      </label>
                      <input
                        type="email"
                        required
                        value={authEmail}
                        onChange={(e) => setAuthEmail(e.target.value)}
                        placeholder={authModalTab === "student" ? "priya.sharma@sih2026.edu" : authModalTab === "teacher" ? "admin@delhieng.sih2026.edu" : "officer@aicte.sih2026.edu"}
                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                        Password
                      </label>
                      <input
                        type="password"
                        required
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  {authMode === "signup" && (
                    <>
                      {authModalTab === "student" && (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                                12-Digit APAAR ID
                              </label>
                              <input
                                type="text"
                                required
                                maxLength={12}
                                value={authSignupApaar}
                                onChange={(e) => setAuthSignupApaar(e.target.value.replace(/\D/g, ''))}
                                placeholder="e.g. 100000000009"
                                className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                                Assigned Institution
                              </label>
                              <select
                                value={authSignupInstitute}
                                onChange={(e) => setAuthSignupInstitute(e.target.value)}
                                className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                              >
                                {institutions.map(inst => (
                                  <option key={inst.id} value={inst.id}>{inst.name} ({inst.id})</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                                Category
                              </label>
                              <select
                                value={authSignupCategory}
                                onChange={(e) => setAuthSignupCategory(e.target.value)}
                                className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                              >
                                <option value="General">General</option>
                                <option value="OBC">OBC</option>
                                <option value="SC">SC</option>
                                <option value="ST">ST</option>
                                <option value="EWS">EWS</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                                Gender
                              </label>
                              <select
                                value={authSignupGender}
                                onChange={(e) => setAuthSignupGender(e.target.value)}
                                className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                              >
                                <option value="Female">Female</option>
                                <option value="Male">Male</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                                Income (₹/yr)
                              </label>
                              <input
                                type="number"
                                required
                                value={authSignupIncome}
                                onChange={(e) => setAuthSignupIncome(e.target.value)}
                                placeholder="450000"
                                className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-mono"
                              />
                            </div>
                          </div>
                        </>
                      )}

                      {authModalTab === "teacher" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                              Affiliated College
                            </label>
                            <select
                              value={authSignupInstitute}
                              onChange={(e) => setAuthSignupInstitute(e.target.value)}
                              className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                            >
                              {institutions.map(inst => (
                                <option key={inst.id} value={inst.id}>{inst.name} ({inst.id})</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                              Faculty Role
                            </label>
                            <select className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">
                              <option>Dean / Principal</option>
                              <option>Senior Professor & Proctor</option>
                              <option>Attendance Terminal Operator</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {authModalTab === "aicte" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                              Clearance Tier
                            </label>
                            <select className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">
                              <option>Tier 1: Central Compliance Authority</option>
                              <option>Tier 2: Regional Inspectorate</option>
                              <option>Tier 3: Anti-Ghost Taskforce Auditor</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                              Jurisdiction
                            </label>
                            <select className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">
                              <option>AICTE Central HQ New Delhi</option>
                              <option>Western Regional Bureau (Mumbai)</option>
                              <option>Southern Regional Bureau (Bangalore)</option>
                              <option>Northern Regional Bureau (Kanpur)</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-between items-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (authModalTab === "student") {
                          setAuthEmail("priya.sharma@sih2026.edu");
                          setAuthPassword("Password123!");
                        } else if (authModalTab === "teacher") {
                          setAuthEmail("admin@delhieng.sih2026.edu");
                          setAuthPassword("Password123!");
                        } else {
                          setAuthEmail("officer@aicte.sih2026.edu");
                          setAuthPassword("Password123!");
                        }
                      }}
                      className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Auto-fill Demo Credentials
                    </button>

                    <button
                      type="submit"
                      disabled={authLoading}
                      className="w-full sm:w-auto px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition active:scale-95"
                    >
                      {authLoading ? "Authenticating..." : authMode === "signin" ? `Sign In as ${authModalTab === "student" ? "Student" : authModalTab === "teacher" ? "Teacher" : "AICTE"}` : "Create Account"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Global Camera QR Scanner Modal: Faculty only */}
      {isGlobalScannerOpen && role === "Institute Admin / Teacher" && (
        <div className="modal-scrim fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="modal-sheet bg-white rounded-t-2xl sm:rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Guilloche size={32} lines={5} />
                <div>
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-1.5">
                    <IconScan /> Camera QR Code Scanner
                  </h3>
                  <p className="text-xs text-slate-500">Live camera scanner for student rotating attendance tokens & APAAR IDs</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsGlobalScannerOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold p-1 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <CameraQrScanner
              onScanSuccess={(decodedText) => {
                handleExecuteScan(decodedText);
              }}
            />

            {/* Scan Verdict Box */}
            {scanResult && (
              <div className={`p-4 rounded-lg text-xs border ${scanResult.status === "SUCCESS" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
                <div className="font-bold text-sm mb-1">
                  {scanResult.status === "SUCCESS" ? "✓ Attendance Recorded Successfully" : "✗ Attendance Scan Rejected"}
                </div>
                <p>{scanResult.message || scanResult.reason || scanResult.detail}</p>
                {scanResult.student_name && (
                  <div className="mt-2 font-mono text-[11px] text-slate-600">
                    Student: {scanResult.student_name} | Date: {scanResult.date}
                  </div>
                )}
              </div>
            )}

            <div className="pt-2 flex flex-wrap justify-between items-center gap-2 text-xs">
              <span className="text-slate-500">
                Active Terminal: <strong className="font-mono text-slate-700">{scannerInstitute}</strong>
              </span>
              <button
                type="button"
                onClick={() => setIsGlobalScannerOpen(false)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded font-semibold transition"
              >
                Close Scanner
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Main Body Container */}
      <main ref={mainRef} className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex-1 w-full pt-16 lg:pt-8">
        <div key={`${role}-${activeTab}-${currentUser.apaar_id || 'anon'}-${identityMode}-${authSession?.user?.id || 'guest'}`} className="view-enter space-y-6">

          {/* 1. STUDENT DASHBOARD */}
          {role === "Student" && activeTab === "dashboard" && (
            <div className="space-y-6">
              {/* ID slip */}
              <section className="slip">
                <Guilloche className="slip-mark" size={380} lines={10} />
                <div className="relative p-5 sm:p-6 md:p-8 grid gap-6 md:grid-cols-[1fr_auto] items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-4">
                      <h2 className="slip-name text-slate-900">{currentUser.name}</h2>
                      <span className={`stamp-tag${currentUser.status === "ACTIVE" ? " is-ok" : ""}`}>{currentUser.status}</span>
                      {isLoadingProfile && <span className="text-xs text-blue-600 animate-pulse font-medium">Syncing profile...</span>}
                    </div>
                    <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-4">
                      <div><dt>APAAR ID</dt><dd className="font-mono">XXXXXXXX{String(currentUser?.apaar_id || '').slice(-4)}</dd></div>
                      <div><dt>Institution</dt><dd>{studentDetails?.institute_name || currentUser.inst || "Unenrolled"}</dd></div>
                      <div><dt>Program</dt><dd>{studentDetails?.program || "B.Tech Technical Program"}</dd></div>
                      <div><dt>Category</dt><dd>{currentUser.cat || studentDetails?.category || "General"}</dd></div>
                      <div><dt>Gender</dt><dd>{currentUser.gender || studentDetails?.gender || "Female"}</dd></div>
                      <div><dt>Family income</dt><dd className="num">{currentUser.income || `₹${(studentDetails?.family_income || 0).toLocaleString('en-IN')}`}</dd></div>
                      <div><dt>Attendance</dt><dd className="num">{attPct.toFixed(1)}%</dd></div>
                      <div><dt>Status tag</dt><dd className="truncate text-xs font-medium text-slate-600">{currentUser.tag || studentDetails?.status || "Active"}</dd></div>
                    </dl>
                  </div>
                  <div className="flex md:flex-col items-center gap-3 self-center">
                    <Guilloche size={72} lines={8} check />
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">SIH 2026 Seal</span>
                  </div>
                </div>
              </section>

              {/* Standing summary */}
              <section className="ledger" aria-label="Standing summary">
                <div className="ledger-cell has-gauge">
                  <div className="ledger-label">Attendance</div>
                  <div className="ledger-num">{attPct.toFixed(1)}<small>%</small></div>
                  <div className="gauge">
                    <div className="gauge-fill" style={{ width: `${Math.min(100, Math.max(0, attPct))}%`, background: attPct >= 75 ? "var(--green)" : "var(--saffron)" }} />
                    <span className="gauge-cut" />
                  </div>
                </div>
                <div className="ledger-cell">
                  <div className="ledger-label">Credits in ABC ledger</div>
                  <div className="ledger-num">{(studentDetails?.credits || []).reduce((n, c) => n + (Number(c.credits) || 0), 0)}<small>credits</small></div>
                </div>
                <div className="ledger-cell">
                  <div className="ledger-label">Scholarship attendance cutoff</div>
                  <div className={`ledger-num is-word ${attPct >= 75 ? "is-ok" : "is-warn"}`}>{attPct >= 75 ? "Met" : "Not met"}<small>75% needed</small></div>
                </div>
              </section>

              {/* Academic Bank of Credits Ledger */}
              <section className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700 mb-4 flex items-center gap-2">
                  <IconCheck /> Academic Bank of Credits (ABC) Verified Course Ledger
                </h3>
                {studentDetails?.credits && studentDetails.credits.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="stack w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="p-3">Course / Module</th>
                          <th className="p-3">Credits Awarded</th>
                          <th className="p-3">Source Institution</th>
                          <th className="p-3">Validity</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {studentDetails.credits.map((cr, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="p-3 font-semibold text-slate-800">{cr.course}</td>
                            <td className="p-3 font-mono font-bold text-emerald-700">{cr.credits} Credits</td>
                            <td className="p-3 text-slate-600">{cr.source_institute}</td>
                            <td className="p-3 font-mono text-slate-500">{cr.valid_till}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">No transferred academic credits deposited in ABC ledger yet.</p>
                )}
              </section>

              {/* Examination & Semester Performance Records */}
              <section className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700 mb-4 flex items-center gap-2">
                  <IconCheck /> Examination & Academic Performance Records
                </h3>
                {studentDetails?.results && studentDetails.results.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="stack w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="p-3">Examination / Semester</th>
                          <th className="p-3">SGPA</th>
                          <th className="p-3">Cumulative CGPA</th>
                          <th className="p-3">Credits Earned</th>
                          <th className="p-3">Result Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {studentDetails.results.map((r, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="p-3 font-semibold text-slate-800">{r.semester}</td>
                            <td className="p-3 font-mono font-bold text-slate-800">{r.sgpa}</td>
                            <td className="p-3 font-mono font-bold text-blue-700">{r.cgpa}</td>
                            <td className="p-3 text-slate-700 font-semibold">{r.credits_earned} Credits</td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800">
                                {r.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">No published semester examination results on record.</p>
                )}
              </section>
            </div>
          )}

          {/* 1B. INSTITUTE ADMIN DASHBOARD */}
          {role === "Institute Admin / Teacher" && activeTab === "dashboard" && (
            <div className="space-y-6">
              <section className="slip">
                <Guilloche className="slip-mark" size={380} lines={10} />
                <div className="relative p-5 sm:p-6 md:p-8 grid gap-6 md:grid-cols-[1fr_auto] items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-4">
                      <h2 className="slip-name text-slate-900 dark:text-white">{currentUser?.name || "Dr. Arvind Mehta"}</h2>
                      <span className="stamp-tag is-ok">{currentUser?.status === "ACTIVE" ? "ACTIVE ACCREDITATION" : (currentUser?.status || "ACTIVE ACCREDITATION")}</span>
                    </div>
                    <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-4">
                      <div><dt>Institute</dt><dd>{institutions.find(i => i.id === (currentUser?.institute_id || scannerInstitute))?.name || currentUser?.inst || "Delhi Engineering & Tech"}</dd></div>
                      <div><dt>AICTE Code</dt><dd className="font-mono">{institutions.find(i => i.id === (currentUser?.institute_id || scannerInstitute))?.aicte_code || "1-1001"}</dd></div>
                      <div><dt>Role / Designation</dt><dd>{currentUser?.designation || "Dean / Principal"}</dd></div>
                      <div><dt>Department</dt><dd>{currentUser?.department || "Computer Science"}</dd></div>
                      <div><dt>Sanctioned Intake</dt><dd className="num">{currentInstIntake} Seats</dd></div>
                      <div><dt>Verified Intake</dt><dd className="num text-emerald-700">{currentInstVerified} Students ({((currentInstVerified / (currentInstIntake || 1)) * 100).toFixed(1)}%)</dd></div>
                      <div><dt>Faculty Strength</dt><dd className="num">{currentInst?.faculty_strength || 8} FTE ({currentInst?.student_faculty_ratio || '14.8'}:1 Ratio)</dd></div>
                      <div><dt>Compliance State</dt><dd className="text-emerald-700 font-semibold">{currentInst?.compliance_status || "Fully Compliant"}</dd></div>
                    </dl>
                  </div>
                  <div className="flex md:flex-col items-center gap-3 self-center">
                    <Guilloche size={72} lines={8} check />
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">AICTE Approved</span>
                  </div>
                </div>
              </section>

              <section className="ledger" aria-label="Institute quick metrics">
                <div className="ledger-cell has-gauge">
                  <div className="ledger-label">Capacity Utilization</div>
                  <div className="ledger-num">{((currentInstVerified / (currentInstIntake || 1)) * 100).toFixed(1)}<small>%</small></div>
                  <div className="gauge">
                    <div className="gauge-fill" style={{ width: `${Math.min(100, (currentInstVerified / (currentInstIntake || 1)) * 100)}%`, background: "var(--green)" }} />
                    <span className="gauge-cut" />
                  </div>
                </div>
                <div className="ledger-cell">
                  <div className="ledger-label">Pending Admission Queue</div>
                  <div className="ledger-num">{requestsList.filter(r => r.state === 'SUBMITTED').length}<small>applications</small></div>
                </div>
                <div className="ledger-cell">
                  <div className="ledger-label">Faculty-Student Ratio</div>
                  <div className="ledger-num is-word is-ok">{currentInst?.student_faculty_ratio || '14.8'}:1<small>≤ 20:1 required</small></div>
                </div>
              </section>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5 space-y-3">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <IconScan /> Biometric Attendance Terminal
                  </h3>
                  <p className="text-xs text-slate-600">
                    Scan and cryptographically record student attendance via live rotating QR codes. Prevents proxy and ghost attendance fraud.
                  </p>
                  <button
                    onClick={() => switchTab("scanner")}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition flex items-center gap-2"
                  >
                    Open Attendance Scanner →
                  </button>
                </div>

                <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5 space-y-3">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <IconCheck /> Admission & Lateral Entry Requests
                  </h3>
                  <p className="text-xs text-slate-600">
                    Verify prior qualifications and approve direct admission, lateral entry, or inter-college transfer applications.
                  </p>
                  <button
                    onClick={() => switchTab("institute-requests", () => fetchRequests())}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold transition flex items-center gap-2"
                  >
                    Review Admission Queue ({requestsList.filter(r => r.state === 'SUBMITTED').length}) →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 1C. AICTE REGULATOR DASHBOARD */}
          {role === "AICTE Officer" && activeTab === "dashboard" && (
            <div className="space-y-6">
              <section className="slip">
                <Guilloche className="slip-mark" size={380} lines={10} />
                <div className="relative p-5 sm:p-6 md:p-8 grid gap-6 md:grid-cols-[1fr_auto] items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-4">
                      <h2 className="slip-name text-slate-900 dark:text-white">{currentUser?.name || "Prof. S. R. Raman"}</h2>
                      <span className="stamp-tag is-ok">{currentUser?.clearance ? "AUTHORIZED CLEARANCE" : "CENTRAL REGULATOR"}</span>
                    </div>
                    <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-4">
                      <div><dt>Bureau</dt><dd>{currentUser?.inst || "AICTE HQ New Delhi"}</dd></div>
                      <div><dt>Designation</dt><dd>{currentUser?.clearance || "Chief Compliance Officer"}</dd></div>
                      <div><dt>Headquarters</dt><dd>AICTE Central New Delhi</dd></div>
                      <div><dt>Jurisdiction</dt><dd>{currentUser?.region || "National Central HQ"}</dd></div>
                      <div><dt>Monitored Institutes</dt><dd className="num">5 Institutions</dd></div>
                      <div><dt>Total Intake Monitored</dt><dd className="num">500 Sanctioned</dd></div>
                      <div><dt>Compliance Flags</dt><dd className="num text-red-600">2 Breaches Detected</dd></div>
                      <div><dt>Audit Chain State</dt><dd className="text-emerald-700 font-semibold">Hash-Chained Intact</dd></div>
                    </dl>
                  </div>
                  <div className="flex md:flex-col items-center gap-3 self-center">
                    <Guilloche size={72} lines={8} check />
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">AICTE Apex Seal</span>
                  </div>
                </div>
              </section>

              <section className="ledger" aria-label="National overview metrics">
                <div className="ledger-cell has-gauge">
                  <div className="ledger-label">National Enrollment Health</div>
                  <div className="ledger-num">75.6<small>%</small></div>
                  <div className="gauge">
                    <div className="gauge-fill" style={{ width: "75.6%", background: "var(--green)" }} />
                    <span className="gauge-cut" />
                  </div>
                </div>
                <div className="ledger-cell">
                  <div className="ledger-label">Ghost Student Anomalies</div>
                  <div className="ledger-num text-red-600">{ghostStudents.length || 1}<small>flagged</small></div>
                </div>
                <div className="ledger-cell">
                  <div className="ledger-label">Regulatory Compliance Status</div>
                  <div className="ledger-num is-word is-warn">2 Alerts<small>Action needed</small></div>
                </div>
              </section>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5 space-y-3">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <IconAlert /> Institutional Compliance Radar
                  </h3>
                  <p className="text-xs text-slate-600">
                    Inspect sanctioned intake versus verified enrollment, faculty ratio violations, and severe seat under-filling.
                  </p>
                  <button
                    onClick={() => switchTab("compliance", () => fetchCompliance())}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition flex items-center gap-2"
                  >
                    Open Compliance Radar →
                  </button>
                </div>

                <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5 space-y-3">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <IconRefresh /> Automated Nightly State Reconciliation
                  </h3>
                  <p className="text-xs text-slate-600">
                    Cross-verify atomic ledger counters between college registers and APAAR verified identity rolls.
                  </p>
                  <button
                    onClick={() => switchTab("reconciliation", () => fetchCompliance())}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold transition flex items-center gap-2"
                  >
                    Run State Reconciliation →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 2. ATTENDANCE QR */}
          {role === "Student" && activeTab === "attendance" && (
            <div className="max-w-md mx-auto space-y-6">
              <div className="ticket">
                <Guilloche className="ticket-mark" size={300} lines={9} />
                <div className="relative space-y-5">
                  <div className="flex flex-wrap justify-between items-center gap-2">
                    <span className="font-bold text-slate-900 text-base">Rotating Signed Attendance QR</span>
                    <span className="font-mono bg-blue-50 text-blue-700 px-2.5 py-1 rounded font-bold text-sm">Refreshes in {countdown}s</span>
                  </div>

                  {qrError ? (
                    <div className="p-6 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm space-y-2">
                      <IconLock />
                      <div className="font-bold">QR Attendance Disabled</div>
                      <p className="text-xs">{qrError}</p>
                    </div>
                  ) : (
                    <>
                      <div className="qr-wrap">
                        <svg className="qr-ring" viewBox="0 0 100 100" aria-hidden="true">
                          <rect className="track" x="1" y="1" width="98" height="98" rx="4" />
                          <rect className={`run${countdown <= 5 ? " is-low" : ""}`} x="1" y="1" width="98" height="98" rx="4" pathLength="1"
                            style={{ strokeDasharray: 1, strokeDashoffset: 1 - Math.max(0, Math.min(1, countdown / 30)) }} />
                        </svg>
                        {qrToken ? (
                          <div className="qr-face"><QRCodeSVG value={qrToken} size={220} level="H" includeMargin={false} /></div>
                        ) : (
                          <div className="qr-face bg-slate-200 animate-pulse text-xs text-slate-500">Generating token...</div>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 text-center max-w-xs mx-auto">
                        Protected by HMAC-SHA256 signature and nonce. Verified only at your assigned institute scanner terminal.
                      </p>
                    </>
                  )}

                  {qrToken && (
                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 font-mono break-all p-2.5 bg-slate-100 rounded border border-slate-200 text-left max-h-24 overflow-y-auto">
                        {qrToken}
                      </div>
                      <button
                        onClick={() => copyToClipboard(qrToken)}
                        className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded text-sm font-semibold transition"
                      >
                        {copiedToken ? "✓ Copied to Clipboard" : "Copy Token for Scanner Terminal"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 3. SCHOLARSHIP SCHEMES */}
          {role === "Student" && activeTab === "schemes" && (
            <div className="space-y-6">
              <div className="flex flex-wrap justify-between items-center gap-3">
                <div>
                  <h2 className="page-title">Configurable Scholarship Gate</h2>
                  <p className="text-xs text-slate-500">Multi-rule evaluation across attendance cutoff, income ceiling, gender, and host institute compliance.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleSimulateAttendanceDrop}
                    className="bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 px-3 py-1.5 rounded text-xs font-semibold transition"
                  >
                    [Demo 9] Drop Attendance to 50%
                  </button>
                  <button
                    onClick={() => checkEligibility(currentUser.apaar_id)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-semibold transition flex items-center gap-1.5"
                  >
                    <IconRefresh /> Re-evaluate Schemes
                  </button>
                </div>
              </div>

              {disbursalMsg && (
                <div className={`p-4 rounded-lg text-xs font-medium border ${disbursalMsg.type === "SUCCESS" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : (disbursalMsg.type === "INFO" ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-red-50 text-red-800 border-red-200")}`}>
                  {disbursalMsg.text}
                </div>
              )}

              {isEvaluatingSchemes ? (
                <div className="p-8 text-center text-xs text-slate-400 animate-pulse">Evaluating student eligibility criteria against active schemes...</div>
              ) : (
                <div className="stagger grid gap-4 sm:gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {schemeResults.map((scheme) => {
                    const totalChecks = scheme.checks?.length || 0;
                    const passedChecks = scheme.checks?.filter(c => c.passed).length || 0;
                    const isAllPassed = totalChecks > 0 && passedChecks === totalChecks;
                    const isDisbursed = scheme.status === "DISBURSED" || scheme.already_claimed;

                    return (
                      <div
                        key={scheme.scheme_id}
                        className={`border rounded-xl shadow-sm p-5 flex flex-col justify-between transition-all ${isDisbursed
                          ? "bg-blue-50/60 border-blue-200 border-l-[5px] border-l-blue-600"
                          : scheme.status === "ELIGIBLE"
                            ? "bg-emerald-50/50 border-emerald-300 border-l-[5px] border-l-emerald-600"
                            : "bg-white border-slate-200"
                          }`}
                      >
                        <div>
                          {/* Header Badge Row */}
                          <div className="flex justify-between items-start gap-2 mb-2">
                            {isDisbursed ? (
                              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-800 flex items-center gap-1">
                                <span>✓</span> DISBURSED
                              </span>
                            ) : scheme.status === "ELIGIBLE" ? (
                              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                ELIGIBLE FOR DBT
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                                INELIGIBLE
                              </span>
                            )}
                            <span className="text-[10px] text-slate-500 font-mono bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                              {scheme.scheme_id}
                            </span>
                          </div>

                          {/* Scheme Name & Ministry */}
                          <h3 className="font-bold text-slate-900 text-base leading-snug mb-1">{scheme.scheme_name}</h3>
                          <div className="text-[11px] text-slate-500 mb-3">
                            <span className="font-medium text-slate-700">{scheme.ministry_badge || scheme.authority}</span>
                            {scheme.target_group && <span> • {scheme.target_group}</span>}
                          </div>

                          {/* Grant Amount Hero Box */}
                          <div className="p-3 mb-3 rounded-lg bg-slate-50 border border-slate-200/80 flex items-baseline justify-between">
                            <div>
                              <div className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Sanctioned Grant</div>
                              <div className="text-xl font-extrabold text-slate-900 leading-tight">
                                {scheme.amount || "₹50,000"}{" "}
                                <span className="text-[11px] font-normal text-slate-500">{scheme.frequency || "per annum"}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="inline-block text-[9px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                Direct DBT
                              </span>
                              <div className="text-[9px] text-slate-400 mt-0.5">Aadhaar Bridge (APBS)</div>
                            </div>
                          </div>

                          {/* Description */}
                          {scheme.description && (
                            <p className="text-xs text-slate-600 mb-3 leading-relaxed">
                              {scheme.description}
                            </p>
                          )}

                          {/* Criteria Checklist */}
                          <div className="border-t border-slate-100 pt-3 space-y-2">
                            <div className="flex justify-between items-center text-[11px] font-semibold text-slate-700">
                              <span>Eligibility Rules Breakdown</span>
                              <span className={isAllPassed ? "text-emerald-700 font-bold" : "text-amber-700 font-bold"}>
                                {passedChecks}/{totalChecks} Passed
                              </span>
                            </div>

                            <ul className="space-y-1.5 text-xs">
                              {scheme.checks?.map((chk, i) => (
                                <li
                                  key={i}
                                  className={`p-2 rounded-lg border text-xs transition ${chk.passed ? "bg-emerald-50/60 border-emerald-100" : "bg-red-50/50 border-red-100"
                                    }`}
                                >
                                  <div className="flex items-start justify-between gap-1">
                                    <span className={`font-semibold flex items-center gap-1.5 ${chk.passed ? "text-emerald-900" : "text-red-900"}`}>
                                      <span>{chk.passed ? "✓" : "✗"}</span>
                                      {chk.rule}
                                    </span>
                                    <span
                                      className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shrink-0 ${chk.passed ? "text-emerald-700 bg-emerald-100" : "text-red-700 bg-red-100"
                                        }`}
                                    >
                                      {chk.passed ? "Pass" : "Fail"}
                                    </span>
                                  </div>
                                  {chk.detail && (
                                    <div className={`mt-1 pl-4 text-[10px] font-mono ${chk.passed ? "text-emerald-700" : "text-red-600"}`}>
                                      Candidate Data: {chk.detail}
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Security / Crypto Token Notice */}
                          {isDisbursed ? (
                            <div className="mt-3 p-2 rounded bg-blue-50 border border-blue-200 text-xs text-blue-900">
                              <div className="font-bold flex items-center gap-1 text-[11px]">
                                <span>🎉</span> Benefit Credited via Central DBT Ledger
                              </div>
                              {scheme.claim_record && (
                                <div className="text-[10px] font-mono text-blue-700 mt-0.5">
                                  Claim ID: {scheme.claim_record.id || scheme.claim_record.claim_id}
                                </div>
                              )}
                            </div>
                          ) : scheme.status === "ELIGIBLE" && scheme.eligibility_token ? (
                            <div className="mt-3 p-2 rounded bg-emerald-50 border border-emerald-200 text-[10px] text-emerald-800">
                              <div className="font-semibold flex items-center gap-1">
                                <span>🔐</span> Cryptographically Verified (HMAC-SHA256)
                              </div>
                              <div className="font-mono text-[9px] text-emerald-600 truncate mt-0.5">
                                Sig: {scheme.eligibility_token.split('|')[3]?.slice(0, 24)}... (Valid for 300s)
                              </div>
                            </div>
                          ) : null}
                        </div>

                        {/* Action Button Footer */}
                        <div className="mt-4 pt-3 border-t border-slate-100">
                          {isDisbursed ? (
                            <button
                              disabled
                              className="w-full py-2 bg-blue-100 text-blue-800 rounded-lg text-xs font-semibold cursor-not-allowed border border-blue-300"
                            >
                              ✓ Benefit Disbursed to Bank Account
                            </button>
                          ) : scheme.status === "ELIGIBLE" ? (
                            <button
                              onClick={() => handleDisbursal(scheme.scheme_id, scheme.eligibility_token)}
                              className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition shadow-sm hover:shadow flex items-center justify-center gap-1.5"
                            >
                              <span>⚡</span> Claim DBT Disbursal ({scheme.amount || "₹50,000"})
                            </button>
                          ) : (
                            <button
                              disabled
                              className="w-full py-2 bg-slate-100 text-slate-400 rounded-lg text-xs font-semibold cursor-not-allowed"
                            >
                              Ineligible — Criteria Not Satisfied ({totalChecks - passedChecks} failed)
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 4. ADMISSION & TRANSFER REQUESTS */}
          {role === "Student" && activeTab === "requests" && (
            isUnenrolled ? (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6 space-y-4">
                  <h3 className="font-bold text-slate-900 text-sm">Submit New Application</h3>
                  {requestMsg && (
                    <div className={`p-3 text-xs rounded border ${requestMsg.type === "SUCCESS" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"}`}>
                      {requestMsg.text}
                    </div>
                  )}

                  {/* Real-time Seat Capacity Alert / Badge */}
                  {selectedInstAvailableSeats <= 0 ? (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-xs font-semibold flex items-center gap-2" role="alert">
                      <span>⚠️</span>
                      <span>Alert: Seats are full! {selectedInst?.name || "Selected institute"} has 0 available seats.</span>
                    </div>
                  ) : (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center justify-between">
                      <span className="font-medium">Seat Capacity Status:</span>
                      <span className="font-bold font-mono text-emerald-700">{selectedInstAvailableSeats} seats open (Sanctioned: {selectedInstIntake})</span>
                    </div>
                  )}

                  <form onSubmit={handleCreateRequest} className="space-y-3 text-xs">
                    <div>
                      <label className="block font-semibold text-slate-600 mb-1">Request Type</label>
                      <select
                        value={joinForm.type}
                        onChange={(e) => setJoinForm({ ...joinForm, type: e.target.value })}
                        className="w-full p-2 border border-slate-300 rounded"
                      >
                        <option value="join">Fresh Admission (Year 1)</option>
                        <option value="lateral">Lateral Entry (Direct Year 2 - Diploma)</option>
                        <option value="transfer">Inter-College Transfer (Carryover ABC Credits)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-600 mb-1">Target Institute</label>
                      <select
                        value={joinForm.institute_id}
                        onChange={(e) => setJoinForm({ ...joinForm, institute_id: e.target.value })}
                        className="w-full p-2 border border-slate-300 rounded"
                      >
                        {institutions.map(inst => (
                          <option key={inst.id} value={inst.id}>
                            {inst.name} ({inst.state})
                          </option>
                        ))}
                      </select>
                    </div>

                    {joinForm.type === "transfer" && (
                      <div>
                        <label className="block font-semibold text-slate-600 mb-1">Destination Transfer Institute</label>
                        <select
                          value={joinForm.target_institute_id}
                          onChange={(e) => setJoinForm({ ...joinForm, target_institute_id: e.target.value })}
                          className="w-full p-2 border border-slate-300 rounded"
                        >
                          {institutions.map(inst => (
                            <option key={inst.id} value={inst.id}>{inst.name} ({inst.state})</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={selectedInstAvailableSeats <= 0}
                      className={`w-full py-2 rounded font-semibold transition ${
                        selectedInstAvailableSeats <= 0
                          ? "bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300"
                          : "bg-blue-600 hover:bg-blue-700 text-white"
                      }`}
                    >
                      Submit Application
                    </button>
                  </form>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6">
                  <h3 className="font-bold text-slate-900 text-sm mb-4">My Application & Transfer History</h3>
                  <div className="overflow-x-auto">
                    <table className="stack w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="p-3">Request ID</th>
                          <th className="p-3">Type</th>
                          <th className="p-3">Institute</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Timestamp</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {requestsList.filter(r => String(r.apaar_id) === String(currentUser?.apaar_id || selectedApaar || "100000000008")).map((req) => (
                          <tr key={req.request_id || req.id} className="hover:bg-slate-50">
                            <td className="p-3 font-mono text-slate-400">{req.request_id || req.id}</td>
                            <td className="p-3 font-semibold uppercase">{req.type}</td>
                            <td className="p-3 text-slate-600 font-medium">
                              {institutions.find(i => i.id === (req.to_inst || req.from_inst))?.name || req.to_inst || req.from_inst}
                            </td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${req.state === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : (req.state === 'REJECTED' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800')}`}>
                                {req.state}
                              </span>
                            </td>
                            <td className="p-3 font-mono text-slate-400">{req.created_at?.slice(0, 10)}</td>
                          </tr>
                        ))}
                        {requestsList.filter(r => String(r.apaar_id) === String(currentUser?.apaar_id || selectedApaar || "100000000008")).length === 0 && (
                          <tr>
                            <td colSpan={5} className="p-4 text-center text-slate-400 italic">
                              No application history recorded yet. Choose an institution and submit your request above.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4">
                <div className="text-4xl">🎓</div>
                <h3 className="font-bold text-slate-900 text-lg">Active Institutional Enrollment</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                  Your enrollment status is currently <span className="font-bold text-emerald-600 uppercase px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200">{studentStatus}</span> at <strong className="text-slate-800">{studentDetails?.institute_name || currentUser?.inst || "your affiliated institute"}</strong>.
                  Fresh admission is only available for unenrolled applicants. You can access your verified attendance QR, academic credits, and scholarship schemes from the navigation sidebar.
                </p>
                <div className="pt-2">
                  <button
                    onClick={() => switchTab("dashboard")}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition"
                  >
                    Go to Student Dashboard →
                  </button>
                </div>
              </div>
            )
          )}

          {/* 5. INSTITUTE ATTENDANCE SCANNER */}
          {role === "Institute Admin / Teacher" && activeTab === "scanner" && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl shadow-md p-4 sm:p-6 space-y-4">
                <div className="flex flex-wrap justify-between items-center gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Faculty Rotating QR Scanner</h3>
                    <p className="text-xs text-slate-500">Scan student attendance token. Enforces single-use nonces and active enrollment.</p>
                  </div>
                  <button
                    onClick={handleResetAttendance}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded font-semibold transition"
                  >
                    Reset Session
                  </button>
                </div>

                {/* Mode Selector */}
                <div className="flex gap-2 p-1 bg-slate-100 rounded-lg text-xs">
                  <button
                    onClick={() => setScannerMode("camera")}
                    className={`flex-1 py-1.5 rounded font-semibold transition ${scannerMode === "camera" ? "bg-white shadow text-slate-900" : "text-slate-500"}`}
                  >
                    📷 Camera Scanner
                  </button>
                  <button
                    onClick={() => {
                      stopAllCameraStreams();
                      setScannerMode("quick");
                    }}
                    className={`flex-1 py-1.5 rounded font-semibold transition ${scannerMode === "quick" ? "bg-white shadow text-slate-900" : "text-slate-500"}`}
                  >
                    Instant Persona Test
                  </button>
                  <button
                    onClick={() => {
                      stopAllCameraStreams();
                      setScannerMode("manual");
                    }}
                    className={`flex-1 py-1.5 rounded font-semibold transition ${scannerMode === "manual" ? "bg-white shadow text-slate-900" : "text-slate-500"}`}
                  >
                    Raw Token Input
                  </button>
                </div>

                {/* Scanner mode view */}
                {scannerMode === "camera" && (
                  <div className="space-y-3 pt-2">
                    <CameraQrScanner
                      onScanSuccess={(decodedText) => {
                        handleExecuteScan(decodedText);
                      }}
                    />
                  </div>
                )}

                {scannerMode === "quick" && (
                  <div className="space-y-3 pt-2">
                    <label className="block text-xs font-semibold text-slate-600">Select Student to Scan</label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select
                        value={scannerTargetStudent}
                        onChange={(e) => setScannerTargetStudent(e.target.value)}
                        className="w-full sm:flex-1 min-w-0 p-2 text-xs border border-slate-300 rounded"
                      >
                        {PERSONAS.map(p => (
                          <option key={p.apaar_id} value={p.apaar_id}>{p.name} ({p.inst})</option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleQuickScanStudent(scannerTargetStudent)}
                        className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-4 py-2 rounded font-semibold transition"
                      >
                        Verify & Mark Attendance
                      </button>
                    </div>
                  </div>
                )}


                {scannerMode === "manual" && (
                  <div className="space-y-3 pt-2">
                    <textarea
                      rows={3}
                      value={scannerTokenInput}
                      onChange={(e) => setScannerTokenInput(e.target.value)}
                      placeholder="Paste 7-part HMAC-SHA256 token here..."
                      className="w-full text-xs font-mono p-2 border border-slate-300 rounded"
                    />
                    <button
                      onClick={() => handleExecuteScan(scannerTokenInput)}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition"
                    >
                      Execute Cryptographic Scan
                    </button>
                  </div>
                )}

                {/* Scan Verdict Box */}
                {scanResult && (
                  <div className={`p-4 rounded-lg text-xs border ${scanResult.status === "SUCCESS" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
                    <div className="font-bold text-sm mb-1">
                      {scanResult.status === "SUCCESS" ? "✓ Attendance Recorded Successfully" : "✗ Attendance Scan Rejected"}
                    </div>
                    <p>{scanResult.message || scanResult.reason || scanResult.detail}</p>
                    {scanResult.student_name && (
                      <div className="mt-2 font-mono text-[11px] text-slate-600">
                        Student: {scanResult.student_name} | Date: {scanResult.date}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 6. INSTITUTE ADMISSION REQUESTS QUEUE */}
          {role === "Institute Admin / Teacher" && activeTab === "institute-requests" && (
            <div className="space-y-6">
              {/* Dynamic Institutional Capacity Header */}
              <div className="p-4 sm:p-5 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">{currentInst?.name || "Institute Portal"}</h3>
                  <p className="text-xs text-slate-500 font-mono">AICTE Code: {currentInst?.aicte_code || "1-1001"} | Terminal: {currentInstId}</p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="text-right">
                    <div className="text-slate-400">Sanctioned Intake</div>
                    <div className="font-bold font-mono text-slate-800 text-sm">{currentInstIntake}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-400">Verified Enrolled</div>
                    <div className="font-bold font-mono text-emerald-700 text-sm">{currentInstVerified}</div>
                  </div>
                  <div className="text-right border-l pl-4 border-slate-200">
                    <div className="text-slate-400">Available Empty Seats</div>
                    <div className={`font-bold font-mono text-base ${currentInstAvailableSeats > 0 ? "text-blue-700" : "text-red-600 font-extrabold"}`}>
                      {currentInstAvailableSeats}
                    </div>
                  </div>
                  <div>
                    {currentInstAvailableSeats > 0 ? (
                      <span className="px-2.5 py-1 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        SEATS AVAILABLE
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded text-[11px] font-bold bg-red-100 text-red-800 border border-red-200">
                        SEATS FULL
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Admission & Verification Queue Table */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6 space-y-4">
                <div className="flex flex-wrap justify-between items-center gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Admission & Verification Queue</h3>
                    <p className="text-xs text-slate-500">Reconciles student join claims against institutional sanctioned intake and faculty ratio.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">
                      Pending: <strong>{requestsList.filter(r => r.state === 'SUBMITTED').length}</strong>
                    </span>
                    <button
                      onClick={fetchRequests}
                      className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded font-semibold transition"
                    >
                      Refresh Queue
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="stack w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="p-3">Request ID</th>
                        <th className="p-3">APAAR ID</th>
                        <th className="p-3">Type</th>
                        <th className="p-3">Program / Year</th>
                        <th className="p-3">Target Institute</th>
                        <th className="p-3">Current State</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {requestsList.map((req) => {
                        const reqInstId = req.to_inst || req.from_inst || currentInstId;
                        const reqInst = institutions.find(i => i.id === reqInstId);
                        const reqAvailableSeats = req.institute_available_seats !== undefined
                          ? req.institute_available_seats
                          : (reqInst ? (reqInst.available_seats !== undefined ? reqInst.available_seats : Math.max(0, (reqInst.sanctioned_intake || 0) - (reqInst.verified_students || 0))) : currentInstAvailableSeats);
                        const isAcceptDisabled = (req.can_accept === false) || (reqAvailableSeats <= 0);

                        return (
                          <tr key={req.request_id || req.id} className="hover:bg-slate-50">
                            <td className="p-3 font-mono text-slate-400">{req.request_id || req.id}</td>
                            <td className="p-3 font-mono font-bold text-slate-800">{req.apaar_id}</td>
                            <td className="p-3 uppercase font-semibold text-blue-700">{req.type}</td>
                            <td className="p-3 text-slate-600">B.Tech Year {req.year || 1}</td>
                            <td className="p-3">
                              <div className="font-semibold text-slate-800 dark:text-slate-100">
                                {reqInst?.name || reqInstId}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                Code: {reqInst?.aicte_code || reqInstId} • Available: {reqAvailableSeats} seats
                              </div>
                            </td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${req.state === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : (req.state === 'REJECTED' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800')}`}>
                                {req.state}
                              </span>
                            </td>
                            <td className="p-3 text-right space-x-2">
                              {req.state === "SUBMITTED" ? (
                                <>
                                  <button
                                    onClick={() => handleProcessRequest(req.request_id || req.id, "APPROVE")}
                                    disabled={isAcceptDisabled}
                                    title={isAcceptDisabled ? "Acceptance disabled: Seats are full (0 empty seats)" : "Accept and enroll student"}
                                    className={`px-2.5 py-1 rounded text-[11px] font-semibold transition ${
                                      !isAcceptDisabled
                                        ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                                        : "bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300"
                                    }`}
                                  >
                                    Accept & Verify
                                  </button>
                                  <button
                                    onClick={() => handleProcessRequest(req.request_id || req.id, "REJECT")}
                                    className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-[11px] font-semibold transition"
                                  >
                                    Reject
                                  </button>
                                </>
                              ) : (
                                <span className="text-slate-400 italic text-[11px]">Processed</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 7. AICTE COMPLIANCE RADAR */}
          {role === "AICTE Officer" && activeTab === "compliance" && (
            <div className="space-y-6">
              <div className="flex flex-wrap justify-between items-center gap-3">
                <div>
                  <h2 className="page-title">Institutional Compliance Radar</h2>
                  <p className="text-xs text-slate-500">Real-time enforcement of Sanctioned Intake, Faculty-Student Ratio (20:1), and Under-filling Flags.</p>
                </div>
                <button
                  onClick={fetchCompliance}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-semibold transition flex items-center gap-1.5"
                >
                  <IconRefresh /> Refresh Radar
                </button>
              </div>

              <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {complianceData.map(inst => (
                  <div key={inst.institute_id} className={`p-4 rounded-xl border bg-white shadow-sm flex flex-col justify-between ${inst.ratio_breach ? "border-red-300 ring-2 ring-red-100" : (inst.under_filled ? "border-amber-300 ring-1 ring-amber-100" : "border-slate-200")}`}>
                    <div>
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${inst.ratio_breach ? "bg-red-100 text-red-800" : (inst.under_filled ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")}`}>
                        {inst.compliance_status}
                      </span>
                      <h4 className="font-bold text-sm leading-snug text-slate-900 mt-2 line-clamp-2">{inst.institute_name}</h4>
                      <p className="text-[10px] text-slate-400 font-mono">{inst.institute_id} • {inst.state}</p>

                      <dl className="mt-3 space-y-1 text-xs">
                        <div className="flex justify-between"><dt className="text-slate-500">Intake:</dt><dd className="font-bold">{inst.verified_students}/{inst.sanctioned_intake}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">Occupancy:</dt><dd className="font-bold">{inst.occupancy_pct}%</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">Faculty Ratio:</dt><dd className={`font-bold ${inst.ratio_breach ? "text-red-600" : "text-emerald-700"}`}>{inst.faculty_student_ratio}</dd></div>
                      </dl>
                      <div className="mini-gauge is-wide" aria-hidden="true"><i className={Number(inst.occupancy_pct) < 50 ? "is-low" : ""} style={{ width: `${Math.min(100, Math.max(0, Number(inst.occupancy_pct) || 0))}%` }} /></div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Ghost student anomaly detection panel */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6 space-y-3">
                <h3 className="font-bold text-slate-900 text-sm text-red-600 flex items-center gap-2">
                  <IconAlert /> Ghost Student Anomaly Flags (Zero Scans in 15-Day Confirmation Window)
                </h3>
                <div className="overflow-x-auto">
                  <table className="stack w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="p-3">APAAR ID</th>
                        <th className="p-3">Candidate Name</th>
                        <th className="p-3">Enrolled Institute</th>
                        <th className="p-3">Days Enrolled</th>
                        <th className="p-3">Scans</th>
                        <th className="p-3">Anomaly Classification</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {ghostStudents.map(st => (
                        <tr key={st.apaar_id} className="hover:bg-red-50/50">
                          <td className="p-3 font-mono font-bold text-slate-800">{st.apaar_id}</td>
                          <td className="p-3 font-semibold">{st.name}</td>
                          <td className="p-3 text-slate-600">{st.institute_id}</td>
                          <td className="p-3 font-mono">{st.days_enrolled} Days</td>
                          <td className="p-3 font-mono font-bold text-red-600">{st.scans_recorded} Scans</td>
                          <td className="p-3 text-red-700 font-medium">{st.flagged_reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 8. AICTE RECONCILIATION */}
          {role === "AICTE Officer" && activeTab === "reconciliation" && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6 space-y-4">
                <div className="flex flex-wrap justify-between items-center gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Automated Nightly State Reconciliation</h3>
                    <p className="text-xs text-slate-500">Atomic ledger audit between institute counters and active student enrollments.</p>
                  </div>
                  <button
                    onClick={handleRunReconciliation}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded font-semibold transition"
                  >
                    Trigger Reconciliation Run
                  </button>
                </div>

                {reconciliationResult && (
                  <div className="space-y-3 pt-2 text-xs">
                    <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg">
                      <div className="font-bold text-sm mb-1">✓ Automated Reconciliation Completed</div>
                      <p>Scanned 5 institutions, verified 378 active enrollment states. 2 compliance warnings isolated.</p>
                    </div>

                    <div className="space-y-2">
                      <h4 className="font-bold text-slate-700">Flagged Institution Discrepancies</h4>
                      {reconciliationResult.details?.map((d, i) => (
                        <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded flex justify-between">
                          <span className="font-mono font-bold text-slate-800">{d.institute_id}</span>
                          <span className="text-red-600 font-medium">{d.issue}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 9. GRIEVANCES */}
          {activeTab === "grievances" && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6 space-y-4">
                <h3 className="font-bold text-slate-900 text-sm">Lodge Grievance / Dispute</h3>
                {grievanceMsg && (
                  <div className={`p-3 text-xs rounded border ${grievanceMsg.type === "SUCCESS" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"}`}>
                    {grievanceMsg.text}
                  </div>
                )}
                <form onSubmit={handleCreateGrievance} className="space-y-3 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1">Complainant APAAR ID</label>
                    <input
                      type="text"
                      disabled
                      value={currentUser.apaar_id}
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded font-mono text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1">Issue Description</label>
                    <textarea
                      rows={4}
                      required
                      value={grievanceIssue}
                      onChange={(e) => setGrievanceIssue(e.target.value)}
                      placeholder="Describe identity mismatch, incorrect attendance, or scholarship deduction..."
                      className="w-full p-2 border border-slate-300 rounded"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold transition"
                  >
                    Submit Grievance to AICTE Cell
                  </button>
                </form>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6 space-y-4">
                <h3 className="font-bold text-slate-900 text-sm">Dispute & Grievance Ledger</h3>
                <div className="overflow-x-auto">
                  <table className="stack w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="p-3">ID</th>
                        <th className="p-3">APAAR ID</th>
                        <th className="p-3">Issue</th>
                        <th className="p-3">Status</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {grievancesList.map((g) => (
                        <tr key={g.id} className="hover:bg-slate-50">
                          <td className="p-3 font-mono text-slate-400">{g.id.slice(0, 10)}...</td>
                          <td className="p-3 font-mono font-semibold">{g.apaar_id}</td>
                          <td className="p-3 text-slate-700 max-w-xs">{g.issue}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${g.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                              {g.status}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {g.status !== "RESOLVED" && role !== "Student" && (
                              <button
                                onClick={() => handleResolveGrievance(g.id)}
                                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-[11px] font-semibold transition"
                              >
                                Resolve
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 10. TAMPER-EVIDENT AUDIT TRAIL */}
          {activeTab === "audit" && (
            <div className="space-y-6">
              <div className="flex flex-wrap justify-between items-center gap-3">
                <div>
                  <h2 className="page-title">Cryptographically Chained Audit Ledger</h2>
                  <p className="text-xs text-slate-500">Every lifecycle transition forms a SHA-256 hash link with the previous block: SHA256(prev_hash + payload).</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={tamperAuditLog}
                    className="bg-red-100 hover:bg-red-200 text-red-800 border border-red-300 px-3 py-1.5 rounded text-xs font-semibold transition"
                  >
                    [Demo 10] Trigger Demo Tamper
                  </button>
                  <button
                    onClick={handleVerifyAuditChain}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-xs font-semibold transition flex items-center gap-1.5"
                  >
                    <IconCheck /> Verify Audit Chain
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
                          <td className="p-3 text-slate-500 max-w-xs truncate">{typeof log.payload === 'object' ? JSON.stringify(log.payload) : log.payload}</td>
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
      <footer className="colophon py-5 text-center text-xs text-slate-500 dark:text-slate-400">
        My Aapar &bull; AICTE Student Verification & Compliance Gateway &bull; SIH 2026
      </footer>
    </div>
  </div>
  );
}
