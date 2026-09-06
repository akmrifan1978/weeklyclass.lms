import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import * as resetService from '@/services/resetService';
import { Button, Card, FormSheet, SectionHeader, TextField } from '@/components/ui';

/** Typed exactly, in capitals. Not translated — see below. */
const CONFIRM_WORD = 'DELETE';

/**
 * The two buttons that empty the platform.
 *
 * Everything here is designed to slow somebody down. The section is last on the
 * settings screen, the buttons open a sheet rather than acting, the sheet counts
 * the documents and names them before offering anything to press, and the button
 * that finally does it stays disabled until the word has been typed out.
 *
 * The word is `DELETE` in every language. A confirmation phrase is a padlock,
 * not a sentence — translating it would mean an admin whose app is in Tamil has
 * to type a Tamil word to destroy an English-named collection, and a support
 * call about it becomes impossible to talk through.
 */
export function DangerZone() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();

  const [level, setLevel] = useState<resetService.ResetLevel | null>(null);
  const [tally, setTally] = useState<resetService.ResetTally | null>(null);
  const [typed, setTyped] = useState('');
  const [counting, setCounting] = useState(false);
  const [progress, setProgress] = useState<resetService.ResetProgress | null>(null);

  const open = async (next: resetService.ResetLevel) => {
    setLevel(next);
    setTyped('');
    setTally(null);
    setProgress(null);
    setCounting(true);
    try {
      // Counted on opening, not on pressing. The number is the warning, so it
      // has to be on screen while the decision is still being made.
      setTally(await resetService.tally(next));
    } catch (err) {
      toast.error(friendlyMessage(err, t));
      setLevel(null);
    } finally {
      setCounting(false);
    }
  };

  const run = async () => {
    if (!user || !level) return;
    setProgress({ step: '', done: 0, total: 1 });
    try {
      const outcome = await resetService.reset(level, user, setProgress);
      if (outcome.failed.length > 0) {
        // Not a success and not a failure. Say which parts did not go, because
        // the admin has to decide what to do about them.
        toast.error(
          t('settings.resetPartial', {
            count: outcome.removed,
            names: outcome.failed.join(', '),
          })
        );
      } else {
        toast.success(t('settings.resetDone', { count: outcome.removed }));
      }
      setLevel(null);
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setProgress(null);
    }
  };

  const running = progress !== null;

  return (
    <>
      <SectionHeader title={t('settings.dangerZone')} icon="warning-outline" />
      <Card style={styles.card}>
        <View style={styles.banner}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.bannerText}>{t('settings.dangerZoneWarning')}</Text>
        </View>

        <Text style={styles.itemTitle}>{t('settings.resetData')}</Text>
        <Text style={styles.itemBody}>{t('settings.resetDataHelp')}</Text>
        <Button
          label={t('settings.resetData')}
          icon="trash-outline"
          variant="danger"
          fullWidth
          onPress={() => void open('data')}
        />

        <View style={styles.rule} />

        <Text style={styles.itemTitle}>{t('settings.factoryReset')}</Text>
        <Text style={styles.itemBody}>{t('settings.factoryResetHelp')}</Text>
        <Button
          label={t('settings.factoryReset')}
          icon="nuclear-outline"
          variant="danger"
          fullWidth
          onPress={() => void open('factory')}
        />
      </Card>

      <FormSheet
        visible={level !== null}
        title={t(level === 'factory' ? 'settings.factoryReset' : 'settings.resetData')}
        onClose={() => (running ? undefined : setLevel(null))}
        onSubmit={run}
        submitLabel={t('settings.deleteForever')}
        submitting={running}
        submitDisabled={typed !== CONFIRM_WORD || counting || tally?.total === 0}
      >
        {counting ? (
          <Text style={styles.counting}>{t('settings.counting')}</Text>
        ) : tally && tally.total === 0 ? (
          <Text style={styles.counting}>{t('settings.nothingToDelete')}</Text>
        ) : tally ? (
          <>
            <Text style={styles.sheetLead}>
              {t('settings.aboutToDelete', { count: tally.total })}
            </Text>

            <View style={styles.tally}>
              {tally.people > 0 ? (
                <Row label={t('settings.countPeople')} value={tally.people} />
              ) : null}
              {Object.entries(tally.counts).map(([path, count]) => (
                <Row key={path} label={path} value={count} />
              ))}
            </View>

            {/* Said plainly rather than buried, because it is the part that
                surprises people afterwards. */}
            <Text style={styles.caveat}>{t('settings.resetCaveats')}</Text>

            <TextField
              label={t('settings.typeToConfirm', { word: CONFIRM_WORD })}
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              icon="key-outline"
              containerStyle={{ marginTop: spacing.lg }}
            />

            {running ? (
              <Text style={styles.progress}>
                {progress?.step
                  ? t('settings.clearing', { name: progress.step })
                  : t('settings.counting')}
              </Text>
            ) : null}
          </>
        ) : null}
      </FormSheet>
    </>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.danger },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { flex: 1, fontSize: fontSize.xs, color: colors.danger, lineHeight: 17 },
  itemTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: 2,
  },
  itemBody: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  rule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginVertical: spacing.lg,
  },
  counting: { fontSize: fontSize.sm, color: colors.textSecondary, paddingVertical: spacing.lg },
  sheetLead: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.danger,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  tally: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: spacing.md },
  rowLabel: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary },
  rowValue: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.text },
  caveat: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 17,
    marginTop: spacing.md,
  },
  progress: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
