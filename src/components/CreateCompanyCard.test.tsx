import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../theme';
import { CreateCompanyCard } from './CreateCompanyCard';

const mockCreate = jest.fn();
jest.mock('../data/createOwnCompany', () => ({
  createOwnCompany: (...args: unknown[]) => mockCreate(...args),
}));

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

const onCreated = jest.fn();
const onAlreadyAffiliated = jest.fn();

function renderCard() {
  return render(
    <CreateCompanyCard onCreated={onCreated} onAlreadyAffiliated={onAlreadyAffiliated} />,
    { wrapper },
  );
}

let announceSpy: jest.SpyInstance;

beforeEach(() => {
  mockCreate.mockReset();
  onCreated.mockReset();
  onAlreadyAffiliated.mockReset();
  announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
});

afterEach(() => announceSpy.mockRestore());

describe('CreateCompanyCard', () => {
  it('creates the company with the typed name and tells the caller', async () => {
    mockCreate.mockResolvedValue({ kind: 'created' });
    renderCard();

    expect(screen.getByText('Run your own company?')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('today-company-name'), 'Acme Builders');
    fireEvent.press(screen.getByTestId('today-company-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith('Acme Builders');
    expect(screen.queryByTestId('today-company-error')).toBeNull();
  });

  it('shows the plain failure copy, announces it, and does not report success', async () => {
    mockCreate.mockResolvedValue({ kind: 'failed', message: 'Plain failure copy.' });
    renderCard();

    fireEvent.changeText(screen.getByTestId('today-company-name'), 'Acme');
    fireEvent.press(screen.getByTestId('today-company-submit'));

    expect(await screen.findByTestId('today-company-error')).toHaveTextContent(
      'Plain failure copy.',
    );
    // iOS ignores accessibilityLiveRegion; the explicit announcement covers it.
    expect(announceSpy).toHaveBeenCalledWith('Plain failure copy.');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('hands PL002 to the caller instead of showing it', async () => {
    mockCreate.mockResolvedValue({ kind: 'alreadyAffiliated', message: 'Already linked.' });
    renderCard();

    fireEvent.changeText(screen.getByTestId('today-company-name'), 'Acme');
    fireEvent.press(screen.getByTestId('today-company-submit'));

    await waitFor(() => expect(onAlreadyAffiliated).toHaveBeenCalledWith('Already linked.'));
    expect(screen.queryByTestId('today-company-error')).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('submits from the keyboard Return key', async () => {
    mockCreate.mockResolvedValue({ kind: 'created' });
    renderCard();

    fireEvent.changeText(screen.getByTestId('today-company-name'), 'Acme');
    fireEvent(screen.getByTestId('today-company-name'), 'submitEditing');

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith('Acme');
  });

  // The button shows a spinner while busy, but the field stays editable, so a
  // Return while the first request is in flight is a real second submit. Only
  // savingRef stops it.
  it('sends one request when Return is pressed while a submit is in flight', async () => {
    let resolve: (value: { kind: 'created' }) => void = () => {};
    mockCreate.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderCard();

    fireEvent.changeText(screen.getByTestId('today-company-name'), 'Acme');
    fireEvent.press(screen.getByTestId('today-company-submit'));
    fireEvent(screen.getByTestId('today-company-name'), 'submitEditing');
    expect(mockCreate).toHaveBeenCalledTimes(1);

    resolve({ kind: 'created' });
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
