/**
 * Settings. The tab bar already titles this screen, so it carries no heading of
 * its own — it used to render "Settings — M2", leaking an internal milestone
 * name to users (#20). Rows are top-aligned so the list grows downward as
 * settings are added.
 *
 * The account block is a store-submission requirement, not a nicety: App Store
 * Review 5.1.1(v) obliges any app supporting account creation to offer account
 * deletion from inside the app, and WorkLog registers companies from
 * `(auth)/register`. `AuthProvider` has carried `signOut`/`deleteAccount`
 * since M0, but until now no screen called either, so neither was reachable.
 *
 * Deletion is server-authoritative: `deleteAccount()` invokes the
 * `delete-account` edge function, which resolves the caller from the session
 * JWT and refuses with a plain-language message when deletion must not proceed
 * (e.g. the caller is a company's only administrator). That message is shown
 * verbatim — the user needs to know *why* it was refused, and generic "try
 * again" copy would be wrong advice for a refusal that cannot succeed unaided.
 */
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';

import { useAuth } from '../../src/auth';
import { ConfirmSheet, SheetRow, useToast } from '../../src/components';
import { PRIVACY_URL, TERMS_URL } from '../../src/lib/legal';
import { useTheme } from '../../src/theme';

export default function SettingsScreen() {
  const { colors, sizes } = useTheme();
  const { signOut, deleteAccount } = useAuth();
  const toast = useToast();

  const [signOutOpen, setSignOutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Guards the double-tap: deletion is a network round-trip, and the sheet
  // stays up until it resolves so a refusal is read in place.
  const [deleting, setDeleting] = useState(false);

  const handleSignOut = useCallback(() => {
    setSignOutOpen(false);
    void signOut();
  }, [signOut]);

  const handleDelete = useCallback(() => {
    if (deleting) return;
    setDeleting(true);
    void (async () => {
      // null = deleted; the provider then signs this device out and the router
      // falls back to the (auth) stack. Anything else is a message to show.
      const message = await deleteAccount();
      setDeleting(false);
      if (message === null) return;
      setDeleteOpen(false);
      toast.showError(message);
    })();
  }, [deleteAccount, deleting, toast]);

  return (
    <View
      testID="screen-settings"
      style={{
        flex: 1,
        alignItems: 'center',
        backgroundColor: colors.bg,
        paddingTop: sizes.screenPad,
        gap: 16,
      }}
    >
      <View style={{ width: '100%', paddingHorizontal: sizes.screenPad, gap: 8 }}>
        <SheetRow
          testID="settings-sync-link"
          icon="sync-outline"
          label="Sync queue"
          accessibilityLabel="Sync queue"
          onPress={() => router.push('/settings/sync')}
        />
        {/* System browser, never a web view — same treatment the register
            screen gives these two URLs (src/lib/legal.ts). */}
        <SheetRow
          testID="settings-terms-link"
          icon="document-text-outline"
          label="Terms of Service"
          accessibilityLabel="Terms of Service"
          onPress={() => void Linking.openURL(TERMS_URL).catch(() => {})}
        />
        <SheetRow
          testID="settings-privacy-link"
          icon="lock-closed-outline"
          label="Privacy Policy"
          accessibilityLabel="Privacy Policy"
          onPress={() => void Linking.openURL(PRIVACY_URL).catch(() => {})}
        />
        <SheetRow
          testID="settings-signout"
          icon="log-out-outline"
          label="Sign out"
          accessibilityLabel="Sign out"
          onPress={() => setSignOutOpen(true)}
        />
        <SheetRow
          testID="settings-delete-account"
          icon="trash-outline"
          label="Delete account"
          accessibilityLabel="Delete account"
          onPress={() => setDeleteOpen(true)}
        />
      </View>

      {/* Sign-out is confirmed too: it clears this account's local caches, and
          anything queued but undrained lives only on this device. */}
      <ConfirmSheet
        visible={signOutOpen}
        testID="settings-signout"
        title="Sign out?"
        message="Reports waiting to sync are stored on this device and will be cleared."
        confirmLabel="Sign out"
        cancelLabel="Cancel"
        onConfirm={handleSignOut}
        onClose={() => setSignOutOpen(false)}
      />

      <ConfirmSheet
        visible={deleteOpen}
        testID="settings-delete-account"
        title="Delete your account?"
        message="This permanently deletes your account and removes your access to this company's reports. It cannot be undone."
        confirmLabel={deleting ? 'Deleting…' : 'Delete account'}
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        onClose={() => {
          if (!deleting) setDeleteOpen(false);
        }}
      />
    </View>
  );
}
