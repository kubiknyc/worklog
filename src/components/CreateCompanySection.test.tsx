import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { createCompanyRefusedKey } from '../auth/accountCaches';
import type { CompanyMembership, Membership } from '../auth/roles';
import { ThemeProvider } from '../theme';
import { COMPANY_CREATED_TOAST, CreateCompanySection } from './CreateCompanySection';

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

beforeEach(async () => {
  await AsyncStorage.clear();
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
});

afterEach(() => announceSpy.mockRestore());

describe('CreateCompanySection', () => {
  it('shows the card to an unaffiliated user with no refusal on record', async () => {
    render(<CreateCompanySection />, { wrapper });
    expect(await screen.findByTestId('today-company-card')).toBeTruthy();
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
    expect(await AsyncStorage.getItem(createCompanyRefusedKey('u1'))).toBeNull();
  });

  it('hides the card after a refused PL002 and keeps it hidden after a remount', async () => {
    mockCreate.mockResolvedValue({ kind: 'alreadyAffiliated', message: ALREADY });
    const first = render(<CreateCompanySection />, { wrapper });

    await submitName();

    // The message is shown (and announced) once, in place of the card.
    expect(await screen.findByTestId('today-company-notice')).toHaveTextContent(ALREADY);
    expect(announceSpy).toHaveBeenCalledWith(ALREADY);
    expect(screen.queryByTestId('today-company-card')).toBeNull();
    expect(mockToastShow).not.toHaveBeenCalled();
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(createCompanyRefusedKey('u1'))).toBe('1'),
    );

    first.unmount();
    render(<CreateCompanySection />, { wrapper });
    // Let the flag read settle, then confirm the card never returns and the
    // notice is not repeated.
    await act(async () => {
      await AsyncStorage.getItem(createCompanyRefusedKey('u1'));
    });
    expect(screen.queryByTestId('today-company-card')).toBeNull();
    expect(screen.queryByTestId('today-company-notice')).toBeNull();
  });

  it('does not record a refusal when the reload shows a project membership', async () => {
    mockCreate.mockResolvedValue({ kind: 'alreadyAffiliated', message: ALREADY });
    mockAuth.refresh = jest.fn(() => {
      mockAuth = { ...mockAuth, memberships: [{ project_id: 'p1', role: 'sub' }] };
      return Promise.resolve();
    });
    render(<CreateCompanySection />, { wrapper });

    await submitName();

    expect(await screen.findByTestId('today-company-notice')).toHaveTextContent(ALREADY);
    expect(screen.queryByTestId('today-company-card')).toBeNull();
    expect(await AsyncStorage.getItem(createCompanyRefusedKey('u1'))).toBeNull();
  });

  it('never shows the card to someone with a parked company to claim', async () => {
    mockAuth.session = { user: { app_metadata: { pending_company: 'Acme' } } };
    render(<CreateCompanySection />, { wrapper });
    await act(async () => {
      await AsyncStorage.getItem(createCompanyRefusedKey('u1'));
    });
    expect(screen.queryByTestId('today-company-card')).toBeNull();
  });
});
