/**
 * `readOnly` disables the sheet body (`pointerEvents: 'none'`, PRD §B.7) but
 * had no visible signal — a locked report's section sheet looked identical to
 * an editable one, silently swallowing taps with no explanation. Also, no
 * flow could assert lock actually produced read-only mode on device.
 * `sheet-readonly` is both: real copy for the user, and the selector
 * `.maestro/lifecycle-lock.yaml` asserts after locking.
 */
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../theme';
import { SectionSheetScaffold } from './SectionSheetScaffold';

function renderScaffold(readOnly: boolean) {
  return render(
    <ThemeProvider>
      <SectionSheetScaffold
        visible
        title="Test section"
        onClose={jest.fn()}
        onNoneToday={jest.fn()}
        readOnly={readOnly}
        testID="sheet-test"
      >
        <Text>body content</Text>
      </SectionSheetScaffold>
    </ThemeProvider>,
  );
}

describe('SectionSheetScaffold read-only notice', () => {
  it('shows the locked notice when readOnly', () => {
    renderScaffold(true);

    expect(screen.getByTestId('sheet-readonly')).toBeTruthy();
    expect(
      screen.getByText('This report is locked. Changes need a formal amendment.'),
    ).toBeTruthy();
  });

  it('does not show the notice for an editable (draft) report', () => {
    renderScaffold(false);

    expect(screen.queryByTestId('sheet-readonly')).toBeNull();
  });

  it('suppresses the "None today" affirmation when readOnly, matching the write it would issue', () => {
    // onNoneToday is passed in both cases; only readOnly should hide it — it
    // would otherwise issue a write the lifecycle guard forbids (§B.7).
    renderScaffold(true);
    expect(screen.queryByTestId('sheet-test-none')).toBeNull();

    renderScaffold(false);
    expect(screen.getByTestId('sheet-test-none')).toBeTruthy();
  });
});
