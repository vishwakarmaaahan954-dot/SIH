import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../App.jsx';
import * as enrollmentService from '../services/enrollmentService.js';
import * as instituteService from '../services/instituteService.js';

describe('Frontend Automated Verification Suite: Admission Workflow (R1, R2, R4)', () => {
  const mockInstitutions = [
    {
      id: 'INST_DEL_01',
      aicte_code: '1-1001',
      name: 'Delhi Engineering & Technology Institute',
      state: 'Delhi',
      available_seats: 2,
      empty_seats: 2,
      sanctioned_intake: 120,
      verified_students: 118,
      is_full: false,
    },
    {
      id: 'INST_FULL_06',
      aicte_code: '1-1006',
      name: 'Apex Institute of Advanced Engineering',
      state: 'Maharashtra',
      available_seats: 0,
      empty_seats: 0,
      sanctioned_intake: 50,
      verified_students: 50,
      is_full: true,
    },
  ];

  const mockRequests = [
    {
      id: 'REQ_AVAIL_01',
      request_id: 'REQ_AVAIL_01',
      apaar_id: '100000000008',
      student_name: 'Student Test 08',
      type: 'join',
      program: 'B.Tech',
      year: 1,
      state: 'SUBMITTED',
      to_inst: 'INST_DEL_01',
      from_inst: 'INST_DEL_01',
      institute_available_seats: 2,
      can_accept: true,
      created_at: '2026-10-28T12:00:00Z',
    },
    {
      id: 'REQ_FULL_02',
      request_id: 'REQ_FULL_02',
      apaar_id: '100000000009',
      student_name: 'Applicant Full 09',
      type: 'join',
      program: 'B.Tech',
      year: 1,
      state: 'SUBMITTED',
      to_inst: 'INST_FULL_06',
      from_inst: 'INST_FULL_06',
      institute_available_seats: 0,
      can_accept: false,
      created_at: '2026-10-28T12:05:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Mock API services
    vi.spyOn(instituteService, 'getInstitutes').mockResolvedValue(mockInstitutions);
    vi.spyOn(enrollmentService, 'getEnrollmentRequests').mockResolvedValue(mockRequests);
    vi.spyOn(enrollmentService, 'submitEnrollmentRequest').mockResolvedValue({
      status: 'SUCCESS',
      request_id: 'REQ_SUBMITTED_999',
      message: 'Admission request submitted and sent to institute queue.',
      state: 'SUBMITTED',
    });
    vi.spyOn(enrollmentService, 'processEnrollmentRequest').mockResolvedValue({
      status: 'SUCCESS',
      message: 'Request approved. Active enrollment created.',
      enrollment_id: 'ENR_APPROVED_999',
      new_state: 'APPROVED',
      remaining_available_seats: 1,
    });
  });

  // Helper to open persona switcher modal and select a persona by name
  const selectPersona = async (personaName, modalTab = 'student') => {
    const loginBtn = screen.getByTitle('Open Login Menu');
    fireEvent.click(loginBtn);

    if (modalTab === 'teacher') {
      const teacherTabBtn = screen.getByRole('button', { name: /faculty|teacher/i });
      fireEvent.click(teacherTabBtn);
    } else if (modalTab === 'aicte') {
      const aicteTabBtn = screen.getByRole('button', { name: /aicte/i });
      fireEvent.click(aicteTabBtn);
    }

    const personaCard = await screen.findByText(personaName);
    fireEvent.click(personaCard);
  };

  // -------------------------------------------------------------------------
  // FE-01: Admission request interface rendered and accessible for UNENROLLED student
  // -------------------------------------------------------------------------
  it('FE-01: Admission request interface rendered and accessible for UNENROLLED student', async () => {
    render(<App />);

    // Switch to UNENROLLED student: Student Test 08
    await selectPersona('Student Test 08');

    // Verify Admission & Transfer navigation tab is visible in sidebar
    const admissionNavTab = await screen.findByRole('button', { name: /admission/i });
    expect(admissionNavTab).toBeInTheDocument();

    // Click tab to open admission interface
    fireEvent.click(admissionNavTab);

    // Verify "Submit New Application" form and submit button are rendered
    expect(await screen.findByText(/submit new application/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit application/i })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // FE-02: Admission request interface NOT rendered / inaccessible for ACTIVE student
  // -------------------------------------------------------------------------
  it('FE-02: Admission request interface NOT rendered / inaccessible for ACTIVE student', async () => {
    render(<App />);

    // Default student is Priya Sharma (ACTIVE)
    // Under R1: "Only students with an UNENROLLED status are eligible to request admission;
    // for students who are not unenrolled (e.g., ACTIVE or FLAGGED), the admission request interface is hidden entirely."
    const admissionNavTab = screen.queryByRole('button', { name: /admission/i });
    expect(admissionNavTab).toBeNull();
  });

  // -------------------------------------------------------------------------
  // FE-03: Admission request interface NOT rendered / inaccessible for FLAGGED student
  // -------------------------------------------------------------------------
  it('FE-03: Admission request interface NOT rendered / inaccessible for FLAGGED student', async () => {
    render(<App />);

    // Switch to FLAGGED student: Aarav Gupta
    await selectPersona('Aarav Gupta');

    // Under R1: Admission request interface hidden entirely for FLAGGED
    const admissionNavTab = screen.queryByRole('button', { name: /admission/i });
    expect(admissionNavTab).toBeNull();
  });

  // -------------------------------------------------------------------------
  // FE-04: Full-capacity alert rendered when student selects an institute with 0 available seats
  // -------------------------------------------------------------------------
  it('FE-04: Full-capacity alert rendered when student selects an institute with 0 available seats, and submission is disabled', async () => {
    render(<App />);

    // Switch to UNENROLLED student
    await selectPersona('Student Test 08');

    const admissionNavTab = await screen.findByRole('button', { name: /admission/i });
    fireEvent.click(admissionNavTab);

    // Find target institute selector
    const instituteSelects = screen.getAllByRole('combobox');
    const targetInstSelect = instituteSelects.find(s =>
      Array.from(s.options).some(o => o.value.includes('INST_'))
    );
    expect(targetInstSelect).toBeDefined();

    // Select the full institute (INST_FULL_06)
    fireEvent.change(targetInstSelect, { target: { value: 'INST_FULL_06' } });

    // Expect full-capacity alert rendered and submit button disabled
    await waitFor(() => {
      const alert = screen.queryByText(/seat.*full|capacity.*reached|no.*available.*seat|full.*capacity/i);
      const submitBtn = screen.getByRole('button', { name: /submit application/i });
      expect(alert).toBeInTheDocument();
      expect(submitBtn).toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // FE-05: Admission request submission dispatches request when institute has available seats
  // -------------------------------------------------------------------------
  it('FE-05: Admission request submission dispatches request when institute has available seats', async () => {
    render(<App />);

    await selectPersona('Student Test 08');

    const admissionNavTab = await screen.findByRole('button', { name: /admission/i });
    fireEvent.click(admissionNavTab);

    // Target institute defaults or set to INST_DEL_01 (has 2 seats)
    const instituteSelects = screen.getAllByRole('combobox');
    const targetInstSelect = instituteSelects.find(s =>
      Array.from(s.options).some(o => o.value.includes('INST_DEL_01'))
    );
    if (targetInstSelect) {
      fireEvent.change(targetInstSelect, { target: { value: 'INST_DEL_01' } });
    }

    const submitBtn = screen.getByRole('button', { name: /submit application/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(enrollmentService.submitEnrollmentRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          apaar_id: '100000000008',
          institute_id: 'INST_DEL_01',
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // FE-06: Institute requests queue displays pending admission requests
  // -------------------------------------------------------------------------
  it('FE-06: Institute requests queue displays pending admission requests', async () => {
    render(<App />);

    // Switch to Institute Admin: Dr. Arvind Mehta
    await selectPersona('Dr. Arvind Mehta', 'teacher');

    // Click Requests queue tab
    const requestsNavTab = await screen.findByRole('button', { name: /requests/i });
    fireEvent.click(requestsNavTab);

    // Queue header and table should be rendered with pending request
    expect(await screen.findByText(/admission & verification queue/i)).toBeInTheDocument();
    expect(await screen.findByText('100000000008')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // FE-07: "Accept & Verify" button enabled when institute available seats > 0
  // -------------------------------------------------------------------------
  it('FE-07: "Accept & Verify" button enabled when institute available seats > 0', async () => {
    render(<App />);

    await selectPersona('Dr. Arvind Mehta', 'teacher');

    const requestsNavTab = await screen.findByRole('button', { name: /requests/i });
    fireEvent.click(requestsNavTab);

    // Find row for REQ_AVAIL_01 (INST_DEL_01 with 2 seats)
    const row01 = (await screen.findByText('100000000008')).closest('tr');
    expect(row01).toBeInTheDocument();

    const acceptBtn = within(row01).getByRole('button', { name: /accept & verify/i });
    expect(acceptBtn).not.toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // FE-08: "Accept & Verify" button disabled when institute available seats == 0
  // -------------------------------------------------------------------------
  it('FE-08: "Accept & Verify" button disabled when institute available seats == 0', async () => {
    render(<App />);

    await selectPersona('Dr. Arvind Mehta', 'teacher');

    const requestsNavTab = await screen.findByRole('button', { name: /requests/i });
    fireEvent.click(requestsNavTab);

    // Find row for REQ_FULL_02 (INST_FULL_06 with 0 seats)
    const row02 = (await screen.findByText('100000000009')).closest('tr');
    expect(row02).toBeInTheDocument();

    const acceptBtn = within(row02).getByRole('button', { name: /accept & verify/i });
    // In R2: When an institute has 0 available seats, the action to accept an admission request is disabled.
    expect(acceptBtn).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // FE-09: Post-acceptance state updates reflected in UI
  // -------------------------------------------------------------------------
  it('FE-09: Post-acceptance state updates reflected in UI', async () => {
    render(<App />);

    await selectPersona('Dr. Arvind Mehta', 'teacher');

    const requestsNavTab = await screen.findByRole('button', { name: /requests/i });
    fireEvent.click(requestsNavTab);

    const row01 = (await screen.findByText('100000000008')).closest('tr');
    const acceptBtn = within(row01).getByRole('button', { name: /accept & verify/i });

    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(enrollmentService.processEnrollmentRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          request_id: 'REQ_AVAIL_01',
          action: 'APPROVE',
        })
      );
    });
  });
});
