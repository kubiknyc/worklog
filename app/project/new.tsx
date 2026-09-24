/**
 * Create a project (M2 project bootstrap). Online-only: `createProject` writes
 * directly to Supabase (no offline draft — a project must exist server-side
 * before anything can be filed against it). On success this follows the
 * caller order documented at `src/data/createProject.ts:26-28`: create ->
 * `useAuth().refresh()` (so the new `super` membership lands in context) ->
 * `setActiveProject(newId)` (so Today and everywhere else picks it up
 * immediately — `useActiveProjectSync` then mirrors it into the repo/pull
 * cursor on its own).
 */
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth';
import { PrimaryButton, TextField, useToast } from '../../src/components';
import { createProject } from '../../src/data/createProject';
import { useActiveProject } from '../../src/project';
import { useTheme } from '../../src/theme';
import { hitSlopFor } from '../../src/theme/touchTarget';

const BACK_ICON_SIZE = 26;

export default function NewProjectScreen() {
  const { colors, fonts, spacing, sizes } = useTheme();
  const { refresh } = useAuth();
  const { setActiveProject } = useActiveProject();
  const toast = useToast();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = useCallback(async () => {
    if (saving) return;
    if (name.trim().length === 0) {
      toast.showError('Enter a project name.');
      return;
    }
    setSaving(true);
    try {
      const projectId = await createProject({ name, address: address.trim() || null });
      await refresh();
      setActiveProject(projectId);
      router.back();
    } catch (err) {
      toast.showError(err instanceof Error ? err.message : 'Could not create the project.');
    } finally {
      setSaving(false);
    }
  }, [address, name, refresh, saving, setActiveProject, toast]);

  return (
    <SafeAreaView
      testID="screen-project-new"
      style={[styles.root, { backgroundColor: colors.bg }]}
      edges={['top', 'bottom']}
    >
      <View style={[styles.header, { paddingHorizontal: sizes.screenPad }]}>
        <Pressable
          testID="project-new-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={hitSlopFor(BACK_ICON_SIZE)}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Ionicons name="chevron-back" size={BACK_ICON_SIZE} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text, fontFamily: fonts.ui.extrabold }]}>
          New project
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: sizes.screenPad, gap: spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <TextField
          testID="project-new-name"
          label="Project name"
          value={name}
          onChangeText={setName}
          placeholder="123 Main St renovation"
        />
        <TextField
          testID="project-new-address"
          label="Address (optional)"
          value={address}
          onChangeText={setAddress}
          placeholder="123 Main St, Brooklyn, NY"
        />
        <PrimaryButton
          testID="project-new-submit"
          label="Create project"
          onPress={() => void handleCreate()}
          busy={saving}
        />
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
});
