import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { AppHeader, Button, Card, Screen, Spacer } from '@/components/ui';

/**
 * Which way the Kaaba is.
 *
 * Two separate questions, and the screen answers them separately because a
 * device can answer one and not the other:
 *
 *   THE BEARING — the direction from here to Makkah, in degrees from true
 *   north. This is arithmetic on two coordinates and is exact. It needs only
 *   the location.
 *
 *   WHICH WAY YOU ARE FACING — needs a compass, and phones have one while
 *   most laptops do not. Without it the bearing is still worth showing: "142°
 *   from north" is usable with any compass, including the one in somebody's
 *   other hand.
 *
 * So a device with no compass gets the number and is told to use a compass,
 * rather than getting a dial that points confidently at nothing. A dial that
 * looks authoritative and is wrong is worse here than no dial: somebody may
 * pray facing it.
 */

/** The Kaaba, to five decimal places — about a metre. */
const KAABA = { latitude: 21.4224779, longitude: 39.8251832 };

type Problem = 'denied' | 'unavailable' | 'unsupported';

/**
 * Great-circle bearing from one point to another, in degrees clockwise from
 * true north.
 *
 * The straight-line bearing on a sphere, which is what the qibla is — not the
 * direction it would appear on a flat map, which for anywhere far from Makkah
 * is a noticeably different line.
 */
function bearingTo(from: { latitude: number; longitude: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const lat1 = toRad(from.latitude);
  const lat2 = toRad(KAABA.latitude);
  const deltaLon = toRad(KAABA.longitude - from.longitude);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Great-circle distance in kilometres, for the "how far" line. */
function distanceTo(from: { latitude: number; longitude: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(KAABA.latitude - from.latitude);
  const dLon = toRad(KAABA.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) * Math.cos(toRad(KAABA.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function QiblaScreen() {
  const { t } = useTranslation();

  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setProblem('unsupported');
      return;
    }
    setLocating(true);
    setProblem(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocating(false);
      },
      (error) => {
        // 1 is PERMISSION_DENIED; everything else is the device failing to fix
        // a position, which is a different problem with a different remedy.
        setProblem(error.code === 1 ? 'denied' : 'unavailable');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    locate();
  }, [locate]);

  /**
   * The compass, where there is one.
   *
   * `webkitCompassHeading` is degrees from MAGNETIC north and iOS gives it
   * directly. Elsewhere `alpha` is degrees anticlockwise from north, so it is
   * subtracted from 360 rather than used as-is — using it raw mirrors the dial
   * and points people the wrong way round.
   */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (!('DeviceOrientationEvent' in window)) return;

    const onOrientation = (event: DeviceOrientationEvent) => {
      const webkit = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
        .webkitCompassHeading;
      if (typeof webkit === 'number') {
        setHeading(webkit);
        return;
      }
      if (typeof event.alpha === 'number' && event.absolute) {
        setHeading((360 - event.alpha) % 360);
      }
    };

    window.addEventListener('deviceorientationabsolute', onOrientation as EventListener);
    window.addEventListener('deviceorientation', onOrientation as EventListener);
    return () => {
      window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener);
      window.removeEventListener('deviceorientation', onOrientation as EventListener);
    };
  }, []);

  const qibla = useMemo(() => (coords ? bearingTo(coords) : null), [coords]);
  const distance = useMemo(() => (coords ? distanceTo(coords) : null), [coords]);

  // How far the needle turns on screen: the qibla relative to where the device
  // is pointing. With no compass it simply points at the bearing itself, with
  // north at the top, which is what a printed compass rose would show.
  const needle = qibla === null ? 0 : heading === null ? qibla : (qibla - heading + 360) % 360;

  return (
    <>
      <AppHeader title={t('qibla.title')} subtitle={t('qibla.lead')} showBack />

      <Screen>
        {problem ? (
          <Card style={styles.problem}>
            <Ionicons name="location-outline" size={26} color={colors.danger} />
            <Text style={styles.problemTitle}>{t(`qibla.problem_${problem}_title`)}</Text>
            <Text style={styles.problemBody}>{t(`qibla.problem_${problem}_body`)}</Text>
            {problem !== 'unsupported' ? (
              <Button
                label={t('common.retry')}
                icon="refresh-outline"
                onPress={locate}
                loading={locating}
                style={{ marginTop: spacing.md }}
              />
            ) : null}
          </Card>
        ) : null}

        {qibla !== null ? (
          <>
            <Card style={styles.dialCard}>
              <View style={styles.dial}>
                {/* North, so the dial can be read against a real compass. */}
                <Text style={[styles.cardinal, styles.north]}>N</Text>
                <Text style={[styles.cardinal, styles.east]}>E</Text>
                <Text style={[styles.cardinal, styles.south]}>S</Text>
                <Text style={[styles.cardinal, styles.west]}>W</Text>

                <View
                  style={[styles.needle, { transform: [{ rotate: `${needle}deg` }] }]}
                  accessibilityLabel={t('qibla.degrees', { degrees: Math.round(qibla) })}
                >
                  <View style={styles.needleStem} />
                  <View style={styles.needleHead}>
                    <Ionicons name="navigate" size={20} color={colors.textInverse} />
                  </View>
                </View>
              </View>

              <Text style={styles.degrees}>
                {t('qibla.degrees', { degrees: Math.round(qibla) })}
              </Text>
              {distance !== null ? (
                <Text style={styles.distance}>
                  {t('qibla.distance', { km: distance.toLocaleString() })}
                </Text>
              ) : null}
            </Card>

            {/* The honest caveat, and it is not small print. */}
            <Card style={styles.note}>
              <Ionicons
                name={heading === null ? 'compass-outline' : 'information-circle-outline'}
                size={16}
                color={colors.textSecondary}
              />
              <Text style={styles.noteText}>
                {t(heading === null ? 'qibla.noCompass' : 'qibla.magneticNote')}
              </Text>
            </Card>
          </>
        ) : null}

        {!qibla && !problem ? (
          <Card style={styles.problem}>
            <Ionicons name="locate-outline" size={26} color={colors.primary} />
            <Text style={styles.problemTitle}>{t('qibla.locating')}</Text>
          </Card>
        ) : null}

        <Spacer size={spacing.xxl} />
      </Screen>
    </>
  );
}

const DIAL = 240;

const styles = StyleSheet.create({
  dialCard: { alignItems: 'center', paddingVertical: spacing.xl },
  dial: {
    width: DIAL,
    height: DIAL,
    borderRadius: DIAL / 2,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardinal: {
    position: 'absolute',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textMuted,
  },
  north: { top: 8 },
  south: { bottom: 8 },
  east: { right: 10 },
  west: { left: 10 },
  needle: { width: DIAL * 0.7, height: DIAL * 0.7, alignItems: 'center' },
  needleStem: {
    position: 'absolute',
    top: '50%',
    width: 3,
    height: DIAL * 0.35,
    backgroundColor: colors.border,
  },
  needleHead: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: brand.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  degrees: {
    fontSize: 30,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: spacing.lg,
  },
  distance: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  noteText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 18 },
  problem: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  problemTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  problemBody: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
