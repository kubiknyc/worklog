/**
 * Today's create-company offer: decides whether CreateCompanyCard shows, and
 * what happens after a create.
 *
 * Shown only to someone with no project, no company and no parked company
 * (`canCreateOwnCompany`), and never once this user has been refused for good.
 *
 * Success: a "Your company is set up." toast, then an account reload. The card
 * stays hidden even if that reload falls back to a cached account from before
 * the company existed.
 *
 * PL002 (already affiliated): the account is reloaded and re-checked.
 *  - A company membership now exists → it was our own create whose response
 *    was lost: treated exactly as success.
 *  - Otherwise the message is shown once. If the reload shows no membership
 *    at all (a live phone-book contact, or a company creator with no membership
 *    row), the server will refuse every retry, so the refusal is remembered per
 *    user (`createCompanyRefusedKey`, swept on sign-out) and the card never
 *    comes back for them.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';

import { createCompanyRefusedKey } from '../auth/accountCaches';
import { useAuth } from '../auth/AuthProvider';
import { canCreateOwnCompany } from '../auth/roles';
import { useTheme } from '../theme';
import { CreateCompanyCard } from './CreateCompanyCard';
import { useToast } from './ToastProvider';

export const COMPANY_CREATED_TOAST = 'Your company is set up.';

export function CreateCompanySection() {
  const { userId, memberships, companyMemberships, session, refresh } = useAuth();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  // null until this user's refusal flag has been read; the card stays hidden
  // until then so a refused user never sees it flash up.
  const [refused, setRefused] = useState<boolean | null>(null);
  const [created, setCreated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Set after a PL002 reload; evaluated on the next render, which carries the
  // reloaded account.
  const [recheck, setRecheck] = useState<string | null>(null);

  useEffect(() => {
    setRefused(null);
    if (!userId) return;
    let active = true;
    AsyncStorage.getItem(createCompanyRefusedKey(userId))
      .then((stored) => {
        if (active) setRefused(stored !== null);
      })
      .catch(() => {
        if (active) setRefused(false);
      });
    return () => {
      active = false;
    };
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
    AccessibilityInfo.announceForAccessibility(recheck);
    if (memberships.length === 0 && userId) {
      setRefused(true);
      AsyncStorage.setItem(createCompanyRefusedKey(userId), '1').catch(() => {});
    }
  }, [recheck, companyMemberships, memberships, userId, markCreated]);

  const showCard =
    refused === false &&
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
