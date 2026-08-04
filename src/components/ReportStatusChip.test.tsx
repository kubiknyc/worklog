/**
 * `ReportStatusChip` had no test (#24 item 9) despite rendering on both screens
 * that show a report — Today and report detail.
 *
 * The claim worth pinning is the one in its header: "status is never conveyed
 * by color alone" (PRD §9 AC-S2). That is an accessibility requirement, and the
 * only thing keeping it true is that the chip renders a text label next to the
 * dot. Deleting the `<Text>` would leave a chip that still looks right to
 * someone who can distinguish the four hues, and is unreadable to everyone else.
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider, type ReportStatus } from '../theme';
import { REPORT_STATUS_LABELS, ReportStatusChip } from './ReportStatusChip';

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

const STATUSES: readonly ReportStatus[] = ['draft', 'submitted', 'locked', 'amended'];

describe('ReportStatusChip', () => {
  it.each(STATUSES)('renders a text label for %s, not colour alone', (status) => {
    render(<ReportStatusChip status={status} />, { wrapper });

    // PRD §9 AC-S2. Without this the chip is a coloured pill and nothing else.
    expect(screen.getByText(REPORT_STATUS_LABELS[status])).toBeTruthy();
  });

  it('labels every status distinctly', () => {
    const labels = STATUSES.map((status) => REPORT_STATUS_LABELS[status]);

    // Two statuses sharing a label makes the dot the only differentiator, which
    // is the exact failure the labels exist to prevent.
    expect(new Set(labels).size).toBe(STATUSES.length);
  });

  it('tints the label with a theme status colour', () => {
    render(<ReportStatusChip status="locked" />, { wrapper });

    const style = screen.getByText('Locked').props.style as readonly { color?: string }[];
    const color = style.map((s) => s?.color).find(Boolean);

    expect(typeof color).toBe('string');
  });

  it('renders the derived amended state like any other', () => {
    // `amended` is a DERIVED display state (a locked report with >=1 amendment),
    // not a fourth lifecycle stage — it still gets the full chip treatment.
    render(<ReportStatusChip status="amended" />, { wrapper });

    expect(screen.getByText('Amended')).toBeTruthy();
  });

  it('renders the small variant with a smaller label than the default', () => {
    const { rerender } = render(<ReportStatusChip status="draft" size="sm" />, { wrapper });
    const small = screen.getByText('Draft').props.style as readonly { fontSize?: number }[];
    const smallSize = small.map((s) => s?.fontSize).find(Boolean) as number;

    rerender(
      <ThemeProvider>
        <ReportStatusChip status="draft" />
      </ThemeProvider>,
    );
    const medium = screen.getByText('Draft').props.style as readonly { fontSize?: number }[];
    const mediumSize = medium.map((s) => s?.fontSize).find(Boolean) as number;

    // Today uses `sm` inline in a list row, report detail the default in a
    // header. If the sizes collapse, one of those two layouts is wrong.
    expect(smallSize).toBeLessThan(mediumSize);
  });
});
