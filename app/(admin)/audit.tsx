import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/contexts/LanguageContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { usePaginated } from '@/hooks/useAsync';
import { formatDateTime } from '@/utils/date';
import { humanise } from '@/utils/format';
import { listLogs } from '@/services/auditService';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import type { AuditAction } from '@/types';
import type { Cursor } from '@/services/firestore';
import {
  AsyncBoundary,
  Badge,
  Button,
  Card,
  ChipGroup,
  Screen,
  SkeletonList,
  Spacer,
} from '@/components/ui';

const ACTION_ICON: Record<AuditAction, keyof typeof Ionicons.glyphMap> = {
  CREATE: 'add-circle-outline',
  UPDATE: 'create-outline',
  DELETE: 'trash-outline',
  LOGIN: 'log-in-outline',
  LOGOUT: 'log-out-outline',
  ACTIVATE: 'checkmark-circle-outline',
  DEACTIVATE: 'close-circle-outline',
  PERMISSION_CHANGED: 'key-outline',
};

const ACTION_TONE: Record<AuditAction, string> = {
  CREATE: 'active',
  UPDATE: 'pending',
  DELETE: 'suspended',
  LOGIN: 'active',
  LOGOUT: 'inactive',
  ACTIVATE: 'active',
  DEACTIVATE: 'inactive',
  PERMISSION_CHANGED: 'pending',
};

/**
 * Audit log.
 *
 * Entries are append-only at the rules level — nobody, admins included, can
 * edit or delete one from the app.
 */
function AuditScreen() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [action, setAction] = useState<AuditAction | 'all'>('all');

  const fetchPage = useCallback(
    (cursor: Cursor) =>
      listLogs({ cursor, action: action === 'all' ? undefined : action, pageSize: 25 }),
    [action]
  );

  const list = usePaginated(fetchPage, [action]);

  return (
    <Screen refreshing={list.refreshing} onRefresh={list.refresh} edges={['bottom']}>
      <Text style={styles.title} accessibilityRole="header">
        {t('nav.auditLogs')}
      </Text>

      <Spacer />

      <ChipGroup<AuditAction | 'all'>
        options={[
          { value: 'all', label: t('common.all') },
          { value: 'CREATE', label: 'Create' },
          { value: 'UPDATE', label: 'Update' },
          { value: 'DELETE', label: 'Delete' },
          { value: 'PERMISSION_CHANGED', label: t('nav.permissions') },
          { value: 'LOGIN', label: 'Login' },
        ]}
        value={action}
        onChange={setAction}
      />

      <Spacer />

      <AsyncBoundary
        loading={list.loading}
        error={list.error}
        empty={list.items.length === 0}
        onRetry={list.reload}
        skeleton={<SkeletonList count={6} />}
        emptyProps={{ icon: 'document-text-outline', title: t('admin.noAuditLogs') }}
      >
        <View style={{ gap: spacing.md }}>
          {list.items.map((log) => (
            <Card key={log.id}>
              <View style={styles.row}>
                <View style={styles.icon}>
                  <Ionicons
                    name={ACTION_ICON[log.action] ?? 'ellipse-outline'}
                    size={17}
                    color={colors.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summary}>{log.summary}</Text>
                  <Text style={styles.meta}>
                    {log.actorName} ({humanise(log.actorRole)}) ·{' '}
                    {formatDateTime(log.at ?? log.createdAt, language)}
                  </Text>
                  <Text style={styles.meta}>
                    {log.collection}
                    {log.documentId ? ` · ${log.documentId}` : ''}
                  </Text>

                  {log.changes && Object.keys(log.changes).length ? (
                    <View style={styles.changes}>
                      {Object.entries(log.changes)
                        .slice(0, 6)
                        .map(([field, change]) => (
                          <Text key={field} style={styles.change} numberOfLines={1}>
                            <Text style={styles.changeField}>{field}: </Text>
                            {String(change.from ?? '—')} → {String(change.to ?? '—')}
                          </Text>
                        ))}
                      {Object.keys(log.changes).length > 6 ? (
                        <Text style={styles.change}>
                          +{Object.keys(log.changes).length - 6}…
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
                <Badge label={humanise(log.action)} tone={ACTION_TONE[log.action]} />
              </View>
            </Card>
          ))}

          {list.hasMore ? (
            <Button
              label={t('common.loadMore')}
              onPress={list.loadMore}
              loading={list.loadingMore}
              variant="outline"
            />
          ) : null}
        </View>
      </AsyncBoundary>

      <Spacer size={spacing.xxxl} />
    </Screen>
  );
}

export default function AdminAudit() {
  return (
    <PermissionGuard permission="MANAGE_SETTINGS">
      <AuditScreen />
    </PermissionGuard>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    paddingTop: spacing.sm,
  },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.infoSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: { fontSize: fontSize.sm, color: colors.text, lineHeight: 19 },
  meta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  changes: {
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 2,
  },
  change: { fontSize: 11, color: colors.textSecondary },
  changeField: { fontWeight: fontWeight.semibold, color: colors.text },
});
