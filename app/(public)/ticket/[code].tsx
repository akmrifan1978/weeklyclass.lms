import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { PublicPage } from '@/components/public/PublicPage';
import { Fact, ListState, PublicCard } from '@/components/public/PublicControls';
import { useAsync } from '@/hooks/useAsync';
import { publicTicket } from '@/services/eventRegistrationService';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { tone } from '@/components/public/tone';

/**
 * What a scanned ticket shows.
 *
 * The QR on a ticket used to carry the six-character code by itself, so a
 * camera reported "A7K3PQ" — which tells a steward nothing, and looks exactly
 * like a scan that failed. It now carries a link here.
 *
 * SIGNED OUT, DELIBERATELY. The person holding the ticket at the door may not
 * have an account, and the steward scanning it may be using their own phone.
 * Requiring a sign-in to read a ticket would put a login screen between a
 * family and a doorway, so this reads the thin public copy instead — event,
 * date, venue, seats, validity, and the holder as a first name and an initial.
 * Nothing else about them is in that document to show.
 *
 * It states validity in words rather than only in colour: a ticket is checked
 * in bright sun, through a cracked screen, by somebody who may not read
 * English, and a green tint is not an answer.
 */
export default function PublicTicketPage() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ code?: string }>();
  const code = String(params.code ?? '').trim().toUpperCase();

  const load = useCallback(() => publicTicket(code), [code]);
  const { data, loading, refreshing, refresh } = useAsync(load, [code]);

  const status = data?.status;
  const valid = status === 'confirmed';
  const verdictKey =
    status === 'confirmed'
      ? 'event.scanValid'
      : status === 'pending'
        ? 'event.scanPending'
        : status === 'rejected'
          ? 'event.scanRejected'
          : 'event.scanCancelled';

  return (
    <PublicPage
      badge={t('event.scanTitle')}
      title={data?.eventTitle ?? t('event.scanTitle')}
      subtitle={code}
      onRefresh={refresh}
      refreshing={refreshing}
    >
      {loading || !data ? (
        <ListState
          loading={loading}
          empty={!loading && !data}
          icon="ticket-outline"
          title={t('event.scanNotFound')}
          message={t('event.scanNotFoundHelp')}
        />
      ) : null}

      <>
        {data ? (
          <PublicCard>
            {/* The answer first, in words, before anything that needs reading. */}
            <View style={[styles.verdict, valid ? styles.verdictOk : styles.verdictNo]}>
              <Ionicons
                name={valid ? 'checkmark-circle' : 'alert-circle'}
                size={22}
                color={valid ? colors.success : colors.warning}
              />
              <Text style={[styles.verdictText, valid ? styles.textOk : styles.textNo]}>
                {t(verdictKey)}
              </Text>
            </View>

            <Text style={styles.holderLabel}>{t('event.scanHolder')}</Text>
            <Text style={styles.holder}>{data.holder}</Text>

            <View style={styles.facts}>
              {data.date ? (
                <Fact
                  icon="calendar-outline"
                  text={[data.date, data.startTime].filter(Boolean).join('  ·  ')}
                />
              ) : null}
              {data.venue ? <Fact icon="location-outline" text={data.venue} /> : null}
              <Fact icon="people-outline" text={`${t('event.scanSeats')}: ${data.seats}`} />
              <Fact
                icon={data.paid ? 'checkmark-done-outline' : 'time-outline'}
                text={t(data.paid ? 'event.scanPaid' : 'event.scanUnpaid')}
              />
            </View>

            <Text style={styles.code}>{data.code}</Text>
            <Text style={styles.hint}>{t('event.scanAtDoor')}</Text>
          </PublicCard>
        ) : null}
      </>
    </PublicPage>
  );
}

const styles = StyleSheet.create({
  verdict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  verdictOk: { backgroundColor: colors.successSoft },
  verdictNo: { backgroundColor: colors.warningSoft },
  verdictText: { fontSize: fontSize.md, fontWeight: fontWeight.bold, flex: 1 },
  textOk: { color: colors.success },
  textNo: { color: colors.warning },
  holderLabel: { fontSize: fontSize.xs, color: tone.body },
  holder: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: tone.title },
  facts: { gap: spacing.sm, marginTop: spacing.md },
  code: {
    marginTop: spacing.md,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    letterSpacing: 3,
    color: tone.title,
  },
  hint: { fontSize: fontSize.xs, color: tone.body, marginTop: spacing.sm, lineHeight: 17 },
});
