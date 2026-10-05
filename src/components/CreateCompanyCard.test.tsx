import type { ReactNode } from 'react';
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

const onRecheck = jest.fn();

beforeEach(() => {
  mockCreate.mockReset();
  onRecheck.mockReset();
});

describe('CreateCompanyCard', () => {
  it('creates the company with the typed name and tells the caller', async () => {
    mockCreate.mockResolvedValue({ kind: 'created' });
    const onCreated = jest.fn();
    render(<CreateCompanyCard onCreated={onCreated} onRecheck={onRecheck} />, { wrapper });

    expect(screen.getByText('Run your own company?')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('today-company-name'), 'Acme Builders');
    fireEvent.press(screen.getByTestId('today-company-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith('Acme Builders');
    expect(screen.queryByTestId('today-company-error')).toBeNull();
  });

  it('shows the plain failure copy and does not report success', async () => {
    mockCreate.mockResolvedValue({ kind: 'failed', message: 'Plain failure copy.' });
    const onCreated = jest.fn();
    render(<CreateCompanyCard onCreated={onCreated} onRecheck={onRecheck} />, { wrapper });

    fireEvent.changeText(screen.getByTestId('today-company-name'), 'Acme');
    fireEvent.press(screen.getByTestId('today-company-submit'));

    expect(await screen.findByTestId('today-company-error')).toHaveTextContent(
      'Plain failure copy.',
    );
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('sends one request for a double tap', async () => {
    let resolve: (value: { kind: 'created' }) => void = () => {};
    mockCreate.mockReturnValue(new Promise((r) => (resolve = r)));
    const onCreated = jest.fn();
    render(<CreateCompanyCard onCreated={onCreated} onRecheck={onRecheck} />, { wrapper });

    fireEvent.changeText(screen.getByTestId('today-company-name'), 'Acme');
    fireEvent.press(screen.getByTestId('today-company-submit'));
    fireEvent.press(screen.getByTestId('today-company-submit'));
    resolve({ kind: 'created' });

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('on PL002 shows the message and asks the caller to re-check affiliation', async () => {
    mockCreate.mockResolvedValue({ kind: 'alreadyAffiliated', message: 'Already linked.' });
    const onCreated = jest.fn();
    render(<CreateCompanyCard onCreated={onCreated} onRecheck={onRecheck} />, { wrapper });

    fireEvent.changeText(screen.getByTestId('today-company-name'), 'Acme');
    fireEvent.press(screen.getByTestId('today-company-submit'));

    expect(await screen.findByTestId('today-company-error')).toHaveTextContent('Already linked.');
    await waitFor(() => expect(onRecheck).toHaveBeenCalledTimes(1));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('submits from the keyboard Return key', async () => {
    mockCreate.mockResolvedValue({ kind: 'created' });
    const onCreated = jest.fn();
    render(<CreateCompanyCard onCreated={onCreated} onRecheck={onRecheck} />, { wrapper });

    fireEvent.changeText(screen.getByTestId('today-company-name'), 'Acme');
    fireEvent(screen.getByTestId('today-company-name'), 'submitEditing');

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith('Acme');
  });
});
