/**
 * Projects — switch between job sites, or start a new one (T23).
 *
 * Before this screen the only route to `/project/new` lived in Today's
 * no-project empty state, and `setActiveProject` was only ever called right
 * after a create — so an account that already had a project could neither add
 * a second one nor move between them. One superintendent, several job sites.
 *
 * The list comes from the user's memberships (what `resolveActiveProject`
 * validates against), named from `repo.listProjects()`; list-building is pure
 * in `src/project/projectOptions.ts`. Picking a row sets the active project
 * and returns — `useActiveProjectSync` mirrors it into the repo/pull cursor.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth';
import { DetailSkeleton, PrimaryButton, SheetRow } from '../../src/components';
import { useRepository } from '../../src/data';
import { useAsyncData } from '../../src/hooks/useAsyncData';
import { useRefreshOnFocusAndSync } from '../../src/hooks/useRefreshOnFocusAndSync';
import { buildProjectOptions, useActiveProject, type ProjectSummary } from '../../src/project';
import { useTheme } from '../../src/theme';
import { hitSlopFor } from '../../src/theme/touchTarget';

const BACK_ICON_SIZE = 26;

export default function ProjectSwitchScreen() {
  const { colors, fonts, spacing, sizes } = useTheme();
  const repo = useRepository();
  const { memberships } = useAuth();
  const { activeProjectId, setActiveProject } = useActiveProject();

  const load = useCallback(() => repo.listProjects(), [repo]);
  const { data: rows, loading, error, reload } = useAsyncData(load, []);
  // A project created a moment ago is in `memberships` before its row is
  // pulled down; re-read when the engine finishes a pull.
  useRefreshOnFocusAndSync(reload);

  const options = useMemo(() => {
    const byId = new Map<string, ProjectSummary | null>(
      (rows ?? []).map((r) => [r.id, { name: r.name, address: r.address }]),
    );
    return buildProjectOptions(memberships, byId, activeProjectId);
  }, [rows, memberships, activeProjectId]);

  const choose = useCallback(
    (projectId: string) => {
      if (projectId !== activeProjectId) setActiveProject(projectId);
      router.back();
    },
    [activeProjectId, setActiveProject],
  );

  return (
    <SafeAreaView
      testID="screen-project-switch"
      style={[styles.root, { backgroundColor: colors.bg }]}
      edges={['top', 'bottom']}
    >
      <View style={[styles.header, { paddingHorizontal: sizes.screenPad }]}>
        <Pressable
          testID="project-switch-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={hitSlopFor(BACK_ICON_SIZE)}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Ionicons name="chevron-back" size={BACK_ICON_SIZE} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text, fontFamily: fonts.ui.extrabold }]}>
          Projects
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: sizes.screenPad, gap: spacing.sm }}
        showsVerticalScrollIndicator={false}
      >
        {loading && !rows && !error ? (
          <DetailSkeleton />
        ) : (
          options.map((option) => (
            <SheetRow
              key={option.id}
              testID={`project-switch-row-${option.id}`}
              icon="business-outline"
              accessibilityLabel={
                option.active ? `${option.name}, current project` : `Switch to ${option.name}`
              }
              onPress={() => choose(option.id)}
              trailing={
                option.active ? (
                  <Ionicons
                    testID="project-switch-active"
                    name="checkmark-circle"
                    size={22}
                    color={colors.accent}
                  />
                ) : null
              }
            >
              <Text
                numberOfLines={1}
                style={[styles.name, { color: colors.text, fontFamily: fonts.ui.semibold }]}
              >
                {option.name}
              </Text>
              {option.address ? (
                <Text
                  numberOfLines={1}
                  style={[styles.address, { color: colors.muted, fontFamily: fonts.ui.regular }]}
                >
                  {option.address}
                </Text>
              ) : null}
            </SheetRow>
          ))
        )}

        <View style={{ marginTop: spacing.md }}>
          <PrimaryButton
            testID="project-switch-new"
            label="New project"
            onPress={() => router.push('/project/new')}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontSize: 17 },
  headerSpacer: { width: 26 },
  name: { fontSize: 15 },
  address: { fontSize: 13, marginTop: 2 },
  pressed: { opacity: 0.7 },
});
