/**
 * Today's create-company offer: decides whether CreateCompanyCard shows, and
 * what happens after a create.
 *
 * Shown only to someone with no project, no company and no parked company
 * (`canCreateOwnCompany`), and not again this session once the server has
 * refused them.
 *
 * Success: a "Your company is set up." toast, then an account reload. The card
 * stays hidden even if that reload falls back to a cached account from before
 * the company existed.
 *
 * PL002 (already affiliated): the account is reloaded and re-checked.
 *  - A company membership now exists → it was our own create whose response
 *    was lost: treated exactly as success.
 *  - Otherwise the refusal notice is shown once and the card is hidden. If the
 *    reload shows no membership at all, the refusal comes from something the
 *    app cannot see: a company the user created without a membership row
 *    (permanent), or a live phone-book contact (lifted when they are removed
 *    from the phone book). So the refusal is remembered for this app session
 *    only, never persisted: a later launch offers the card again, and a user
 *    who has since become eligible can use it.
 */
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { canCreateOwnCompany } from '../auth/roles';
import { useTheme } from '../theme';
import { CreateCompanyCard } from './CreateCompanyCard';
import { useToast } from './ToastProvider';

export const COMPANY_CREATED_TOAST = 'Your company is set up.';

// Users refused this session (module scope, so a remount of Today keeps it;
// a fresh app launch starts empty). Never persisted — see the header.
const refusedThisSession = new Set<string>();

/** Test seam: what a fresh app launch looks like to this module. */
export function resetCreateCompanyRefusalsForTests(): void {
  refusedThisSession.clear();
}

export function CreateCompanySection() {
  const { userId, memberships, companyMemberships, session, refresh } = useAuth();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const [refused, setRefused] = useState(() => !!userId && refusedThisSession.has(userId));
  const [created, setCreated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Set after a PL002 reload; evaluated on the next render, which carries the
  // reloaded account.
  const [recheck, setRecheck] = useState<string | null>(null);

  // Everything here belongs to one user; an account switch starts over.
  useEffect(() => {
    setRefused(!!userId && refusedThisSession.has(userId));
    setCreated(false);
    setNotice(null);
    setRecheck(null);
  }, [userId]);

  const markCreated = useCallback(() => {
    setCreated(true);
    toast.show(COMPANY_CREATED_TOAST);
  }, [toast]);

  const onCreated = useCallback(async () => {
    markCreated();
    await refresh();
  }, [markCreated, refresh]);

  const onAlreadyAffiliated = useCallback(
    async (message: string) => {
      await refresh();
      setRecheck(message);
    },
    [refresh],
  );

  useEffect(() => {
    if (recheck === null) return;
    setRecheck(null);
    if (companyMemberships.length > 0) {
      markCreated();
      return;
    }
    setNotice(recheck);
    // Unconditional, as ToastProvider does: the live region below only covers
    // Android, and iOS needs the explicit announcement.
    AccessibilityInfo.announceForAccessibility(recheck);
    if (memberships.length === 0 && userId) {
      refusedThisSession.add(userId);
      setRefused(true);
    }
  }, [recheck, companyMemberships, memberships, userId, markCreated]);

  const showCard =
    !refused &&
    !created &&
    canCreateOwnCompany(memberships, companyMemberships, session?.user.app_metadata);

  return (
    <>
      {showCard ? (
        <CreateCompanyCard onCreated={onCreated} onAlreadyAffiliated={onAlreadyAffiliated} />
      ) : null}
      {notice ? (
        <Text
          testID="today-company-notice"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.notice, { color: colors.muted, fontFamily: fonts.ui.medium }]}
        >
          {notice}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  notice: { fontSize: 15 },
});
