import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import {
  brand,
  colors,
  fontSize,
  fontWeight,
  radius,
  shadow,
  spacing,
  statusColor,
  statusSoftColor,
} from '@/constants/theme';
import { formatDate, formatDuration, formatShortDate, formatTimeRange, toDate } from '@/utils/date';
import { formatBytes, truncate } from '@/utils/format';
import { autoThumbnail } from '@/services/videoService';
import { Badge, Card } from '@/components/ui';
import type {
  Announcement,
  Article,
  AttendanceSummary,
  CalendarEvent,
  Lesson,
  Material,
  Quiz,
  Result,
  VideoItem,
} from '@/types';

/** The prominent "next event" card at the top of the student dashboard. */
export function UpcomingEventCard({
  event,
  onPress,
  locale,
}: {
  event: CalendarEvent;
  onPress?: () => void;
  locale?: string;
}) {
  const { t } = useTranslation();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${t('dashboard.nextEvent')}: ${event.title}`}
      style={({ pressed }) => [styles.eventCard, { opacity: pressed ? 0.94 : 1 }]}
    >
      <View style={styles.eventBadgeRow}>
        <View style={styles.eventBadge}>
          <Ionicons name="calendar" size={12} color={brand.navyDeep} />
          <Text style={styles.eventBadgeText}>{t('dashboard.nextEvent')}</Text>
        </View>
        {event.status !== 'scheduled' ? (
          <Badge
            label={t(event.status === 'cancelled' ? 'calendar.eventCancelled' : 'calendar.eventCompleted')}
            tone={event.status}
          />
        ) : null}
      </View>

      <Text style={styles.eventTitle} numberOfLines={2}>
        {event.title}
      </Text>

      <View style={styles.eventMetaRow}>
        <Ionicons name="calendar-outline" size={14} color={brand.sandLight} />
        <Text style={styles.eventMeta}>{formatDate(event.date, locale)}</Text>
      </View>
      <View style={styles.eventMetaRow}>
        <Ionicons name="time-outline" size={14} color={brand.sandLight} />
        <Text style={styles.eventMeta}>
          {formatTimeRange(event.startTime, event.endTime, locale)}
        </Text>
      </View>
      {event.venue ? (
        <View style={styles.eventMetaRow}>
          <Ionicons name="location-outline" size={14} color={brand.sandLight} />
          <Text style={styles.eventMeta} numberOfLines={1}>
            {event.venue}
          </Text>
        </View>
      ) : null}
      {event.speaker ? (
        <View style={styles.eventMetaRow}>
          <Ionicons name="mic-outline" size={14} color={brand.sandLight} />
          <Text style={styles.eventMeta} numberOfLines={1}>
            {event.speaker}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** The single featured "NEW RELEASE" video on the home screen. */
export function FeaturedVideoCard({
  video,
  onPress,
  locale,
}: {
  video: VideoItem;
  onPress: () => void;
  locale?: string;
}) {
  const { t } = useTranslation();
  const thumbnail = video.thumbnail ?? autoThumbnail(video.videoUrl);

  return (
    <Card onPress={onPress} padded={false} accessibilityLabel={`${t('video.featured')}: ${video.title}`}>
      <View style={styles.thumbWrap}>
        {thumbnail ? (
          <Image source={{ uri: thumbnail }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]}>
            <Ionicons name="videocam" size={34} color={colors.slate} />
          </View>
        )}
        <View style={styles.playOverlay}>
          <Ionicons name="play" size={22} color={colors.textInverse} />
        </View>
        <View style={styles.newBadge}>
          <Text style={styles.newBadgeText}>{t('dashboard.newRelease')}</Text>
        </View>
        {video.duration ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{formatDuration(video.duration)}</Text>
          </View>
        ) : null}
      </View>

      {video.bannerUrl ? (
        <Image source={{ uri: video.bannerUrl }} style={styles.banner} resizeMode="cover" />
      ) : null}

      <View style={styles.cardBody}>
        <View style={styles.titleWithLogo}>
          {video.logoUrl ? (
            <Image
              source={{ uri: video.logoUrl }}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel={t('video.logo')}
            />
          ) : null}
          <Text style={[styles.cardTitle, styles.titleFlex]} numberOfLines={2}>
            {video.title}
          </Text>
        </View>

        {video.speaker ? (
          <View style={styles.metaRow}>
            <Ionicons name="person-outline" size={13} color={colors.textMuted} />
            <Text style={styles.meta}>{video.speaker}</Text>
          </View>
        ) : null}
        {video.venue ? (
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={13} color={colors.textMuted} />
            <Text style={styles.meta} numberOfLines={2}>
              {video.venue}
            </Text>
          </View>
        ) : null}
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
          <Text style={styles.meta}>{formatShortDate(video.date ?? video.createdAt, locale)}</Text>
        </View>
      </View>
    </Card>
  );
}

export function VideoRow({
  video,
  onPress,
  locale,
}: {
  video: VideoItem;
  onPress: () => void;
  locale?: string;
}) {
  const thumbnail = video.thumbnail ?? autoThumbnail(video.videoUrl);

  return (
    <Card onPress={onPress} padded={false} accessibilityLabel={video.title}>
      <View style={styles.row}>
        {thumbnail ? (
          <Image source={{ uri: thumbnail }} style={styles.rowThumb} resizeMode="cover" />
        ) : (
          <View style={[styles.rowThumb, styles.thumbFallback]}>
            <Ionicons name="videocam-outline" size={20} color={colors.slate} />
          </View>
        )}
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {video.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[video.speaker, formatShortDate(video.date ?? video.createdAt, locale)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {video.venue ? (
            <Text style={styles.meta} numberOfLines={1}>
              {video.venue}
            </Text>
          ) : null}
        </View>
        {video.logoUrl ? (
          <Image source={{ uri: video.logoUrl }} style={styles.rowLogo} resizeMode="contain" />
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </Card>
  );
}

export function ArticleCard({
  article,
  onPress,
  locale,
  featured = false,
}: {
  article: Article;
  onPress: () => void;
  locale?: string;
  featured?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Card onPress={onPress} padded={false} accessibilityLabel={article.title}>
      {featured && article.image ? (
        <Image source={{ uri: article.image }} style={styles.articleImage} resizeMode="cover" />
      ) : null}
      <View style={styles.cardBody}>
        {featured ? (
          <Text style={styles.eyebrow}>{t('dashboard.latestArticle')}</Text>
        ) : null}
        <Text style={styles.cardTitle} numberOfLines={2}>
          {article.title}
        </Text>
        {article.summary ? (
          <Text style={styles.summary} numberOfLines={3}>
            {truncate(article.summary, 160)}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={13} color={colors.textMuted} />
          <Text style={styles.meta}>{article.author}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.meta}>
            {formatShortDate(article.publishedAt ?? article.createdAt, locale)}
          </Text>
        </View>
        <Text style={styles.readMore}>{t('common.readMore')} →</Text>
      </View>
    </Card>
  );
}

export function LessonRow({
  lesson,
  onPress,
}: {
  lesson: Lesson;
  onPress: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Card onPress={onPress} accessibilityLabel={lesson.title}>
      <View style={styles.row}>
        <View style={styles.weekChip}>
          <Text style={styles.weekChipLabel}>W</Text>
          <Text style={styles.weekChipValue}>{lesson.weekNumber}</Text>
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {lesson.title}
          </Text>
          {lesson.description ? (
            <Text style={styles.meta} numberOfLines={2}>
              {truncate(lesson.description, 90)}
            </Text>
          ) : null}
          <View style={styles.chipRow}>
            {lesson.videoUrl ? <MiniChip icon="videocam-outline" label="Video" /> : null}
            {lesson.audioUrl ? <MiniChip icon="headset-outline" label={t('lesson.audio')} /> : null}
            {lesson.pdfUrl ? <MiniChip icon="document-text-outline" label="PDF" /> : null}
            {lesson.status !== 'published' ? (
              <Badge label={t(`common.${lesson.status}`)} tone={lesson.status} />
            ) : null}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </Card>
  );
}

const MATERIAL_ICON: Record<Material['type'], keyof typeof Ionicons.glyphMap> = {
  pdf: 'document-text-outline',
  audio: 'headset-outline',
  image: 'image-outline',
  document: 'document-outline',
  link: 'link-outline',
};

export function MaterialRow({
  material,
  onPress,
  trailing,
}: {
  material: Material;
  onPress: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <Card onPress={onPress} accessibilityLabel={material.title}>
      <View style={styles.row}>
        <View style={styles.materialIcon}>
          <Ionicons name={MATERIAL_ICON[material.type]} size={20} color={colors.primary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {material.title}
          </Text>
          <Text style={styles.meta}>
            {[material.type.toUpperCase(), material.size ? formatBytes(material.size) : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {trailing ?? <Ionicons name="download-outline" size={18} color={colors.accent} />}
      </View>
    </Card>
  );
}

export function EventRow({
  event,
  onPress,
  locale,
  trailing,
}: {
  event: CalendarEvent;
  onPress?: () => void;
  locale?: string;
  trailing?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const date = toDate(event.date) ?? new Date(`${event.date}T00:00:00`);

  return (
    <Card onPress={onPress} accessibilityLabel={event.title}>
      {event.bannerUrl ? (
        <Image source={{ uri: event.bannerUrl }} style={styles.eventBanner} resizeMode="cover" />
      ) : null}

      <View style={styles.row}>
        <View style={styles.dateChip}>
          <Text style={styles.dateChipDay}>{date.getDate()}</Text>
          <Text style={styles.dateChipMonth}>
            {date.toLocaleDateString(locale ?? 'en', { month: 'short' })}
          </Text>
        </View>
        <View style={styles.rowBody}>
          <View style={styles.titleWithLogo}>
            {event.logoUrl ? (
              <Image source={{ uri: event.logoUrl }} style={styles.rowLogo} resizeMode="contain" />
            ) : null}
            <Text style={[styles.rowTitle, styles.titleFlex]} numberOfLines={2}>
              {event.title}
            </Text>
          </View>
          <Text style={styles.meta}>
            {formatTimeRange(event.startTime, event.endTime, locale)}
          </Text>
          {event.venue ? (
            <Text style={styles.meta} numberOfLines={1}>
              {event.venue}
            </Text>
          ) : null}
          {event.meetingUrl ? (
            <View style={styles.metaRow}>
              <Ionicons name="videocam" size={12} color={colors.accent} />
              <Text style={[styles.meta, { color: colors.accent }]}>
                {t(
                  event.meetingProvider === 'zoom'
                    ? 'calendar.zoom'
                    : event.meetingProvider === 'meet'
                      ? 'calendar.googleMeet'
                      : 'calendar.onlineClass'
                )}
              </Text>
            </View>
          ) : null}
        </View>
        {trailing}
      </View>
    </Card>
  );
}

export function AnnouncementCard({ announcement }: { announcement: Announcement }) {
  const { t } = useTranslation();
  const urgent = announcement.priority === 'urgent' || announcement.priority === 'high';

  return (
    <Card style={urgent ? styles.urgentCard : undefined}>
      <View style={styles.announcementHeader}>
        <Ionicons
          name={urgent ? 'megaphone' : 'megaphone-outline'}
          size={17}
          color={urgent ? colors.danger : colors.primary}
        />
        <Text style={styles.announcementTitle} numberOfLines={2}>
          {announcement.title}
        </Text>
        {urgent ? (
          <Badge
            label={t(`announcement.priority${announcement.priority === 'urgent' ? 'Urgent' : 'High'}`)}
            color={colors.danger}
            background={colors.dangerSoft}
          />
        ) : null}
      </View>
      <Text style={styles.announcementMessage}>{announcement.message}</Text>
    </Card>
  );
}

export function QuizRow({
  quiz,
  attemptsUsed,
  onPress,
}: {
  quiz: Quiz;
  attemptsUsed?: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const exhausted = quiz.maxAttempts > 0 && (attemptsUsed ?? 0) >= quiz.maxAttempts;

  return (
    <Card onPress={onPress} accessibilityLabel={quiz.title}>
      <View style={styles.row}>
        <View style={[styles.materialIcon, { backgroundColor: colors.accentSoft }]}>
          <Ionicons name="help-circle-outline" size={20} color={colors.accent} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {quiz.title}
          </Text>
          <Text style={styles.meta}>
            {[
              `${quiz.questionCount} ${t('quiz.questions')}`,
              quiz.totalMarks ? `${quiz.totalMarks} ${t('quiz.marks')}` : null,
              quiz.timeLimit ? formatDuration(quiz.timeLimit) : t('quiz.noTimeLimit'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {quiz.maxAttempts > 0 ? (
            <Text style={styles.meta}>
              {t('quiz.attemptsUsed', { used: attemptsUsed ?? 0, max: quiz.maxAttempts })}
            </Text>
          ) : null}
        </View>
        <Badge
          label={t(exhausted ? 'quiz.completed' : quiz.status === 'closed' ? 'quiz.closed' : 'quiz.available')}
          tone={exhausted ? 'inactive' : quiz.status === 'closed' ? 'closed' : 'active'}
        />
      </View>
    </Card>
  );
}

export function ResultRow({
  result,
  onPress,
  locale,
}: {
  result: Result;
  onPress?: () => void;
  locale?: string;
}) {
  const { t } = useTranslation();
  const tone = result.passed ? 'active' : 'suspended';

  return (
    <Card onPress={onPress} accessibilityLabel={`${result.quizTitle}: ${result.percentage}%`}>
      <View style={styles.row}>
        <View
          style={[
            styles.gradeCircle,
            { backgroundColor: statusSoftColor[tone], borderColor: statusColor[tone] },
          ]}
        >
          <Text style={[styles.gradeText, { color: statusColor[tone] }]}>{result.grade}</Text>
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {result.quizTitle}
          </Text>
          <Text style={styles.meta}>
            {result.score}/{result.totalMarks} · {result.percentage}%
          </Text>
          <Text style={styles.meta}>{formatShortDate(result.completedAt, locale)}</Text>
        </View>
        <Badge label={t(result.passed ? 'result.passed' : 'result.failed')} tone={tone} />
      </View>
    </Card>
  );
}

/** Attendance percentage with a coloured progress bar. */
export function AttendanceSummaryCard({ summary }: { summary: AttendanceSummary }) {
  const { t } = useTranslation();
  const tone =
    summary.percentage >= 75 ? colors.success : summary.percentage >= 50 ? colors.warning : colors.danger;

  return (
    <Card>
      <View style={styles.attendanceHeader}>
        <Text style={styles.attendanceLabel}>{t('attendance.percentage')}</Text>
        <Text style={[styles.attendanceValue, { color: tone }]}>{summary.percentage}%</Text>
      </View>
      <View
        style={styles.progressTrack}
        accessibilityRole="progressbar"
        accessibilityValue={{ now: summary.percentage, min: 0, max: 100 }}
      >
        <View
          style={[styles.progressFill, { width: `${Math.min(100, summary.percentage)}%`, backgroundColor: tone }]}
        />
      </View>
      <View style={styles.attendanceStats}>
        <AttendanceStat label={t('attendance.present')} value={summary.present} color={colors.success} />
        <AttendanceStat label={t('attendance.late')} value={summary.late} color={colors.warning} />
        <AttendanceStat label={t('attendance.absent')} value={summary.absent} color={colors.danger} />
        <AttendanceStat label={t('attendance.excused')} value={summary.excused} color={colors.slate} />
      </View>
    </Card>
  );
}

function AttendanceStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.attendanceStat}>
      <Text style={[styles.attendanceStatValue, { color }]}>{value}</Text>
      <Text style={styles.attendanceStatLabel}>{label}</Text>
    </View>
  );
}

function MiniChip({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.miniChip}>
      <Ionicons name={icon} size={11} color={colors.textSecondary} />
      <Text style={styles.miniChipText}>{label}</Text>
    </View>
  );
}

/** Quick-access tile grid on the dashboards. */
export function QuickAccessTile({
  icon,
  label,
  onPress,
  tint = colors.primary,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.tileIcon, { backgroundColor: `${tint}1A` }]}>
        <Ionicons name={icon} size={22} color={tint} />
      </View>
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  eventCard: {
    backgroundColor: brand.navy,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.md,
  },
  eventBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  eventBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: brand.orangeLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  eventBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: brand.navyDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  eventTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    marginBottom: spacing.md,
  },
  eventMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  eventMeta: { fontSize: fontSize.sm, color: brand.sandLight, flexShrink: 1 },
  thumbWrap: { position: 'relative' },
  thumb: {
    width: '100%',
    height: 190,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  playOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -25,
    marginLeft: -25,
    width: 50,
    height: 50,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(237,91,3,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
  },
  newBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    backgroundColor: brand.red,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  newBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  durationBadge: {
    position: 'absolute',
    bottom: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(4,30,74,0.82)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  durationText: { fontSize: fontSize.xs, color: colors.textInverse, fontWeight: fontWeight.medium },
  cardBody: { padding: spacing.lg },
  banner: { width: '100%', height: 96, backgroundColor: colors.surfaceMuted },
  titleWithLogo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  titleFlex: { flex: 1, marginBottom: 0 },
  logo: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  rowLogo: { width: 28, height: 28, borderRadius: radius.sm },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  cardTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.sm,
    lineHeight: 23,
  },
  summary: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  meta: { fontSize: fontSize.xs, color: colors.textMuted },
  metaDot: { color: colors.textMuted, fontSize: fontSize.xs },
  readMore: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
    marginTop: spacing.md,
  },
  articleImage: {
    width: '100%',
    height: 160,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowThumb: {
    width: 84,
    height: 62,
    borderTopLeftRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  rowBody: { flex: 1, paddingVertical: spacing.md },
  rowTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginBottom: 2,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  miniChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  miniChipText: { fontSize: 10, color: colors.textSecondary, fontWeight: fontWeight.medium },
  weekChip: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekChipLabel: { fontSize: 9, color: colors.accentDark, fontWeight: fontWeight.bold },
  weekChipValue: { fontSize: fontSize.lg, color: colors.accentDark, fontWeight: fontWeight.bold },
  materialIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.infoSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventBanner: {
    width: '100%',
    height: 80,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  dateChip: {
    width: 48,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: brand.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateChipDay: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textInverse },
  dateChipMonth: {
    fontSize: 10,
    color: brand.sandLight,
    textTransform: 'uppercase',
    fontWeight: fontWeight.semibold,
  },
  urgentCard: { borderColor: colors.danger, borderWidth: 1.5 },
  announcementHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  announcementTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  announcementMessage: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  gradeCircle: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradeText: { fontSize: fontSize.md, fontWeight: fontWeight.bold },
  attendanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.md,
  },
  attendanceLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  attendanceValue: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: radius.pill },
  attendanceStats: { flexDirection: 'row', marginTop: spacing.lg },
  attendanceStat: { flex: 1, alignItems: 'center' },
  attendanceStatValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  attendanceStatLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  tile: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    minHeight: 96,
    justifyContent: 'center',
    ...shadow.sm,
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  tileLabel: {
    fontSize: fontSize.xs,
    color: colors.text,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
  },
});
