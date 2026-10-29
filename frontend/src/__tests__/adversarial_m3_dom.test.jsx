import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../App.jsx';
import * as enrollmentService from '../services/enrollmentService.js';
import * as instituteService from '../services/instituteService.js';

describe('Tier 5 Challenger 2: Frontend Accessibility & DOM Attribute Integrity Suite', () => {
  const mockInstitutes = [
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

    vi.spyOn(instituteService, 'getInstitutes').mockResolvedValue(mockInstitutes);
    vi.spyOn(enrollmentService, 'getEnrollmentRequests').mockResolvedValue(mockRequests);
    vi.spyOn(enrollmentService, 'submitEnrollmentRequest').mockResolvedValue({
      status: 'SUCCESS',
      request_id: 'REQ_999',
      message: 'Admission request submitted successfully',
      state: 'SUBMITTED',
    });
    vi.spyOn(enrollmentService, 'processEnrollmentRequest').mockResolvedValue({
      status: 'SUCCESS',
      message: 'Request approved successfully',
      enrollment_id: 'ENR_999',
      new_state: 'APPROVED',
    });
  });

  const selectPersona = async (personaName, modalTab = 'student') => {
    const loginBtn = screen.getByTitle('Open Login Menu');
    fireEvent.click(loginBtn);

    if (modalTab === 'teacher') {
      const teacherTabBtn = screen.getByRole('button', { name: /faculty|teacher/i });
      fireEvent.click(teacherTabBtn);
    }

    const personaCard = await screen.findByText(personaName);
    fireEvent.click(personaCard);
  };

  it('DOM Integrity: Form submit button is strictly disabled with cursor-not-allowed when 0 seats available', async () => {
    render(<App />);
    await selectPersona('Student Test 08');

    const admissionTab = await screen.findByRole('button', { name: /admission/i });
    fireEvent.click(admissionTab);

    // Default target is INST_DEL_01 which has 2 seats.
    const instSelect = await screen.findByDisplayValue(/Delhi Engineering & Technology Institute/i);
    const submitBtn = screen.getByRole('button', { name: /submit application/i });

    // Switch to INST_FULL_06 (0 seats)
    fireEvent.change(instSelect, { target: { value: 'INST_FULL_06' } });

    // Assert DOM disabled attribute and styling classes
    expect(submitBtn).toBeDisabled();
    expect(submitBtn.className).toContain('cursor-not-allowed');
    expect(submitBtn.className).toContain('bg-slate-200');

    // Assert accessibility alert banner exists with role="alert"
    const alertBanner = screen.getByRole('alert');
    expect(alertBanner).toBeInTheDocument();
    expect(alertBanner.textContent).toMatch(/Alert: Seats are full!/i);

    // Bypass test: attempting to submit form while disabled must NOT dispatch request
    fireEvent.submit(submitBtn.closest('form'));
    expect(enrollmentService.submitEnrollmentRequest).not.toHaveBeenCalled();
  });

  it('DOM Integrity: Institute Queue "Accept & Verify" button is disabled with descriptive title and cursor-not-allowed for 0 seats', async () => {
    render(<App />);
    await selectPersona('Dr. Arvind Mehta', 'teacher');

    const queueTab = await screen.findByRole('button', { name: /requests/i });
    fireEvent.click(queueTab);

    await waitFor(() => {
      expect(screen.getByText('100000000008')).toBeInTheDocument();
      expect(screen.getByText('100000000009')).toBeInTheDocument();
    });

    const row01 = (await screen.findByText('100000000008')).closest('tr');
    const row02 = (await screen.findByText('100000000009')).closest('tr');

    const enabledBtn = within(row01).getByRole('button', { name: /accept & verify/i });
    const disabledBtn = within(row02).getByRole('button', { name: /accept & verify/i });

    // Button for REQ_AVAIL_01 (2 seats open) -> must be enabled
    expect(enabledBtn).toBeEnabled();
    expect(enabledBtn.className).toContain('bg-emerald-600');

    // Button for REQ_FULL_02 (0 seats open) -> must be disabled
    expect(disabledBtn).toBeDisabled();
    expect(disabledBtn.className).toContain('cursor-not-allowed');
    expect(disabledBtn.className).toContain('bg-slate-200');
    expect(disabledBtn.getAttribute('title')).toContain('Acceptance disabled: Seats are full');

    // Clicking disabled button must NOT trigger processEnrollmentRequest
    fireEvent.click(disabledBtn);
    expect(enrollmentService.processEnrollmentRequest).not.toHaveBeenCalled();

    // Clicking enabled button DOES trigger processEnrollmentRequest
    fireEvent.click(enabledBtn);
    expect(enrollmentService.processEnrollmentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ request_id: 'REQ_AVAIL_01', action: 'APPROVE' })
    );
  });

  it('Accessibility & State Badge: Header correctly displays institutional capacity badges', async () => {
    render(<App />);
    await selectPersona('Dr. Arvind Mehta', 'teacher');

    const queueTab = await screen.findByRole('button', { name: /requests/i });
    fireEvent.click(queueTab);

    // Check header capacity elements
    expect(screen.getByText('Sanctioned Intake')).toBeInTheDocument();
    expect(screen.getByText('Verified Enrolled')).toBeInTheDocument();
    expect(screen.getByText('Available Empty Seats')).toBeInTheDocument();
  });

  it('Navigation Gating: Admission menu tab is absent from navigation DOM for ACTIVE and FLAGGED students', async () => {
    render(<App />);

    // Case A: Default persona is Priya Sharma (ACTIVE)
    expect(screen.queryByRole('button', { name: /admission/i })).toBeNull();

    // Case B: Switch to Aarav Gupta (FLAGGED)
    await selectPersona('Aarav Gupta');
    expect(screen.queryByRole('button', { name: /admission/i })).toBeNull();
  });
});
