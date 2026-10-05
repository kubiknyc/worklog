import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { CompanyMembership, Membership } from '../auth/roles';
import { ThemeProvider } from '../theme';
import {
  COMPANY_CREATED_TOAST,
  CreateCompanySection,
  resetCreateCompanyRefusalsForTests,
} from './CreateCompanySection';

const mockCreate = jest.fn();
jest.mock('../data/createOwnCompany', () => ({
  createOwnCompany: (...args: unknown[]) => mockCreate(...args),
}));

interface MockAuth {
  userId: string | null;
  memberships: Membership[];
  companyMemberships: CompanyMembership[];
  session: { user: { app_metadata: Record<string, unknown> } } | null;
  refresh: jest.Mock;
}
let mockAuth: MockAuth;
jest.mock('../auth/AuthProvider', () => ({ useAuth: () => mockAuth }));

const mockToastShow = jest.fn();
jest.mock('./ToastProvider', () => ({ useToast: () => ({ show: mockToastShow }) }));

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

const ALREADY = 'Already linked.';

async function submitName() {
  fireEvent.changeText(await screen.findByTestId('today-company-name'), 'Acme');
  fireEvent.press(screen.getByTestId('today-company-submit'));
}

let announceSpy: jest.SpyInstance;

beforeEach(() => {
  mockCreate.mockReset();
  mockToastShow.mockReset();
  mockAuth = {
    userId: 'u1',
    memberships: [],
    companyMemberships: [],
    session: { user: { app_metadata: {} } },
    refresh: jest.fn(() => Promise.resolve()),
  };
  announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
  // Each test starts as a fresh app session.
  resetCreateCompanyRefusalsForTests();
});

afterEach(() => announceSpy.mockRestore());

describe('CreateCompanySection', () => {
  it('shows the card to an unaffiliated user', () => {
    render(<CreateCompanySection />, { wrapper });
    expect(screen.getByTestId('today-company-card')).toBeTruthy();
  });

  it('confirms a create with a toast and keeps the card hidden after a cached reload', async () => {
    mockCreate.mockResolvedValue({ kind: 'created' });
    render(<CreateCompanySection />, { wrapper });

    await submitName();

    await waitFor(() => expect(mockToastShow).toHaveBeenCalledWith(COMPANY_CREATED_TOAST));
    expect(mockAuth.refresh).toHaveBeenCalled();
    // The reload left the account unchanged (a cached fallback), yet the
    // create still counts: the card does not come back.
    expect(screen.queryByTestId('today-company-card')).toBeNull();
  });

  it('treats PL002 as success when the reload finds the company (lost response)', async () => {
    mockCreate.mockResolvedValue({ kind: 'alreadyAffiliated', message: ALREADY });
    mockAuth.refresh = jest.fn(() => {
      mockAuth = { ...mockAuth, companyMemberships: [{ company_id: 'c1', role: 'admin' }] };
      return Promise.resolve();
    });
    render(<CreateCompanySection />, { wrapper });

    await submitName();

    await waitFor(() => expect(mockToastShow).toHaveBeenCalledWith(COMPANY_CREATED_TOAST));
    expect(screen.queryByTestId('today-company-notice')).toBeNull();
  });

  // refresh() resolving with the account unchanged is also what a cached
  // fallback looks like: the refusal still holds for the session.
  it('after a refused PL002 with an unchanged account, hides the card for the session only', async () => {
    mockCreate.mockResolvedValue({ kind: 'alreadyAffiliated', message: ALREADY });
    const first = render(<CreateCompanySection />, { wrapper });

    await submitName();

    // The notice is shown (and announced) once, in place of the card.
    expect(await screen.findByTestId('today-company-notice')).toHaveTextContent(ALREADY);
    expect(announceSpy).toHaveBeenCalledWith(ALREADY);
    expect(screen.queryByTestId('today-company-card')).toBeNull();
    expect(mockToastShow).not.toHaveBeenCalled();

    // Same session, Today remounted: still hidden, notice not repeated.
    first.unmount();
    const second = render(<CreateCompanySection />, { wrapper });
    expect(screen.queryByTestId('today-company-card')).toBeNull();
    expect(screen.queryByTestId('today-company-notice')).toBeNull();
    second.unmount();

    // A fresh session (new app launch) offers it again: nothing was persisted,
    // so a phone-book contact who has since been removed can use it.
    resetCreateCompanyRefusalsForTests();
    render(<CreateCompanySection />, { wrapper });
    expect(screen.getByTestId('today-company-card')).toBeTruthy();
  });

  it('remembers a refusal per user: another account still sees the card', async () => {
    mockCreate.mockResolvedValue({ kind: 'alreadyAffiliated', message: ALREADY });
    const view = render(<CreateCompanySection />, { wrapper });
    await submitName();
    expect(await screen.findByTestId('today-company-notice')).toBeTruthy();

    // Account switch on the same mounted screen: state starts over.
    mockAuth = { ...mockAuth, userId: 'u2' };
    view.rerender(<CreateCompanySection />);
    await waitFor(() => expect(screen.getByTestId('today-company-card')).toBeTruthy());
    expect(screen.queryByTestId('today-company-notice')).toBeNull();
  });

  it('does not remember a refusal when the reload shows a project membership', async () => {
    mockCreate.mockResolvedValue({ kind: 'alreadyAffiliated', message: ALREADY });
    mockAuth.refresh = jest.fn(() => {
      mockAuth = { ...mockAuth, memberships: [{ project_id: 'p1', role: 'sub' }] };
      return Promise.resolve();
    });
    const first = render(<CreateCompanySection />, { wrapper });

    await submitName();

    expect(await screen.findByTestId('today-company-notice')).toHaveTextContent(ALREADY);
    // Hidden by the membership gate, not by a remembered refusal: if the
    // membership goes away, the card is offered again in the same session.
    expect(screen.queryByTestId('today-company-card')).toBeNull();
    first.unmount();
    mockAuth = { ...mockAuth, memberships: [] };
    render(<CreateCompanySection />, { wrapper });
    expect(screen.getByTestId('today-company-card')).toBeTruthy();
  });

  it('never shows the card to someone with a parked company to claim', () => {
    mockAuth.session = { user: { app_metadata: { pending_company: 'Acme' } } };
    render(<CreateCompanySection />, { wrapper });
    expect(screen.queryByTestId('today-company-card')).toBeNull();
  });
});
