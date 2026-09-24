/**
 * Project members (M2 project bootstrap). Lists the project's members via
 * `Repository.listMembers` and invites a teammate via `src/data/inviteMember.ts`
 * — a standalone, online-only edge-function call that never touches the sync
 * queue (see that file's header). Only a `super` on this project can invite,
 * mirroring the report screen's `isSuper` gate (`app/report/[id]/index.tsx`).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../../src/auth';
import { roleForProject, isValidEmail } from '../../../src/auth/roles';
import {
  ChipRow,
  DetailSkeleton,
  EmptyState,
  PrimaryButton,
  TextField,
  useToast,
} from '../../../src/components';
import { useRepository } from '../../../src/data';
import { inviteMember } from '../../../src/data/inviteMember';
import type { MemberRow } from '../../../src/data/types';
import { useAsyncData } from '../../../src/hooks/useAsyncData';
import { useTheme } from '../../../src/theme';
import { hitSlopFor } from '../../../src/theme/touchTarget';

const BACK_ICON_SIZE = 26;

const ROLE_OPTIONS = [
  { value: 'sub', label: 'Sub' },
  { value: 'super', label: 'Super' },
] as const;

function memberLabel(member: MemberRow): string {
  const name = member.full_name.trim() || member.email || 'Unnamed';
  return member.title ? `${name} — ${member.title}` : name;
}

export default function ProjectMembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = id ?? '';
  const { colors, fonts, spacing, sizes } = useTheme();
  const repo = useRepository();
  const { memberships } = useAuth();
  const toast = useToast();

  const isSuper = roleForProject(memberships, projectId) === 'super';

  const load = useCallback(() => repo.listMembers(projectId), [repo, projectId]);
  const { data: members, loading, error, reload } = useAsyncData(load, [projectId]);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'super' | 'sub'>('sub');
  const [inviting, setInviting] = useState(false);

  const handleInvite = useCallback(async () => {
    if (inviting) return;
    if (!isValidEmail(email)) {
      toast.showError('Enter a valid email address.');
      return;
    }
    setInviting(true);
    try {
      const result = await inviteMember({ email, projectId, role });
      if (!result.ok) {
        toast.showError(result.message);
        return;
      }
      setEmail('');
      toast.show(
        result.existingUser
          ? 'Added to the project — they already have an account.'
          : result.emailSent
            ? 'Invite sent.'
            : 'Invite created — email delivery is not configured for this instance.',
      );
      reload();
    } catch {
      toast.showError("Couldn't send the invite. Please check your connection and try again.");
    } finally {
      setInviting(false);
    }
  }, [email, inviting, projectId, reload, role, toast]);

  return (
    <SafeAreaView
      testID="screen-project-members"
      style={[styles.root, { backgroundColor: colors.bg }]}
      edges={['top', 'bottom']}
    >
      <View style={[styles.header, { paddingHorizontal: sizes.screenPad }]}>
        <Pressable
          testID="project-members-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={hitSlopFor(BACK_ICON_SIZE)}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Ionicons name="chevron-back" size={BACK_ICON_SIZE} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text, fontFamily: fonts.ui.extrabold }]}>
          Members
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: sizes.screenPad, gap: spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        {loading && !members ? (
          <DetailSkeleton />
        ) : error ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load members"
            subtitle={error.message}
          />
        ) : members && members.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            {members.map((member) => (
              <View
                key={member.user_id}
                style={[
                  styles.memberRow,
                  { borderColor: colors.border, backgroundColor: colors.surface2 },
                ]}
              >
                <Text
                  style={[styles.memberName, { color: colors.text, fontFamily: fonts.ui.semibold }]}
                >
                  {memberLabel(member)}
                </Text>
                <Text
                  style={[styles.memberRole, { color: colors.muted, fontFamily: fonts.ui.regular }]}
                >
                  {member.role}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState icon="people-outline" title="No members yet" />
        )}

        {isSuper ? (
          <View style={{ gap: spacing.md }}>
            <Text
              style={[styles.sectionLabel, { color: colors.muted, fontFamily: fonts.ui.semibold }]}
            >
              INVITE A TEAMMATE
            </Text>
            <TextField
              testID="project-members-invite-email"
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <ChipRow
              options={ROLE_OPTIONS as unknown as { value: string; label: string }[]}
              value={role}
              onChange={(value) => setRole(value === 'super' ? 'super' : 'sub')}
            />
            <PrimaryButton
              testID="project-members-invite-submit"
              label="Send invite"
              onPress={() => void handleInvite()}
              busy={inviting}
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontSize: 17 },
  headerSpacer: { width: 26 },
  pressed: { opacity: 0.7 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    padding: 12,
  },
  memberName: { fontSize: 15, flex: 1 },
  memberRole: { fontSize: 13, textTransform: 'capitalize' },
  sectionLabel: { fontSize: 12, letterSpacing: 0.4 },
});
