/**
 * DiagnosticsScreen — in-memory log viewer + redacted export (DMY-62).
 *
 * Shows the most recent entries from the logger's in-memory ring buffer
 * (newest-first), and an Export action that hands the user a redacted log dump
 * via the OS share sheet.
 *
 * Privacy (defence-in-depth): entries are ALREADY redacted before they reach the
 * buffer (the logger runs every arg through `redact` — see logger.ts). On export
 * we re-affirm redaction by running the assembled text through `redactString`,
 * so even if a future code path pushed something unredacted, SDP / ICE
 * candidates / audio / tokens / PII are masked before leaving the device. The
 * app stays offline-first: export uses the OS share sheet only on explicit user
 * action — there is no automatic upload.
 *
 * Share/file decision: the project has NO file-system or react-native-share
 * native dependency. Rather than add a heavy native dep for this small task we
 * use React Native's built-in `Share.share({ message })` with the redacted text.
 * The user can route that to Files / Mail / AirDrop etc. (which materialises a
 * file downstream). If a true on-disk artifact is later required, swap the
 * export sink for RNFS without touching the redaction or buffer layers.
 *
 * Live updates: the entry list binds to the buffer via `useSyncExternalStore`
 * over the buffer's `subscribe` + memoised `getEntries` snapshot.
 */
import { useCallback, useSyncExternalStore } from 'react';
import {
  FlatList,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import type { Theme } from '../theme';
import type { RootStackScreenProps } from '../navigation/types';
import {
  logBuffer,
  redactString,
  REDACTED,
  type LogEntry,
  type LogLevel,
} from '../services/logger';

/** Per-level color token resolver for the level badge. */
function levelColor(level: LogLevel, theme: Theme): string {
  switch (level) {
    case 'error':
      return theme.colors.danger;
    case 'warn':
      return theme.colors.warning;
    case 'info':
      return theme.colors.primary;
    case 'debug':
    default:
      return theme.colors.textMuted;
  }
}

/** Format an epoch ms timestamp as a local HH:MM:SS.mmm clock for the row. */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
    d.getSeconds(),
  )}.${pad(d.getMilliseconds(), 3)}`;
}

/**
 * Build the export payload from the (already-redacted) buffer snapshot and
 * re-affirm redaction over the assembled text. Pure + exported for direct unit
 * testing of the privacy invariant.
 */
export function buildExportText(entries: readonly LogEntry[]): string {
  const body = entries
    .map(e => {
      const iso = new Date(e.timestamp).toISOString();
      return `${iso} [${e.level.toUpperCase()}] ${e.message}`;
    })
    .join('\n');
  // Defence-in-depth: mask inline secrets even though the buffer is pre-redacted.
  return redactString(body, REDACTED);
}

function DiagnosticsScreen(_: RootStackScreenProps<'Diagnostics'>) {
  const theme = useTheme();
  const { t } = useTranslation();

  const entries = useSyncExternalStore(
    subscribeBuffer,
    getBufferSnapshot,
    getBufferSnapshot,
  );

  const onExport = useCallback(async () => {
    const text = buildExportText(entries);
    try {
      await Share.share({
        title: t('diagnostics.export.shareTitle'),
        message: text,
      });
    } catch {
      // User cancelled or the share sheet was unavailable; nothing to recover.
    }
  }, [entries, t]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<LogEntry>) => (
      <View
        style={[
          styles.row,
          {
            borderBottomColor: theme.colors.border,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.lg,
          },
        ]}>
        <View style={styles.rowHeader}>
          <Text
            style={[
              styles.level,
              {
                color: levelColor(item.level, theme),
                fontSize: theme.typography.fontSizes.sm,
                fontWeight: theme.typography.fontWeights.bold,
              },
            ]}>
            {item.level.toUpperCase()}
          </Text>
          <Text
            style={[
              styles.time,
              {
                color: theme.colors.textMuted,
                fontSize: theme.typography.fontSizes.sm,
                marginLeft: theme.spacing.sm,
              },
            ]}>
            {formatTime(item.timestamp)}
          </Text>
        </View>
        <Text
          style={[
            styles.message,
            {
              color: theme.colors.text,
              fontSize: theme.typography.fontSizes.sm,
              lineHeight: theme.typography.lineHeights.sm,
              marginTop: theme.spacing.xs,
            },
          ]}>
          {item.message}
        </Text>
      </View>
    ),
    [theme],
  );

  return (
    <View
      testID="diagnostics-screen"
      style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <FlatList
        testID="diagnostics-list"
        data={entries}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={
          entries.length === 0 ? styles.emptyContainer : undefined
        }
        ListEmptyComponent={
          <Text
            testID="diagnostics-empty"
            style={[
              styles.empty,
              {
                color: theme.colors.textMuted,
                fontSize: theme.typography.fontSizes.md,
                padding: theme.spacing.xl,
              },
            ]}>
            {t('diagnostics.empty')}
          </Text>
        }
      />

      <TouchableOpacity
        testID="diagnostics-export"
        accessibilityRole="button"
        accessibilityLabel={t('diagnostics.export.a11y')}
        onPress={onExport}
        style={[
          styles.exportButton,
          {
            backgroundColor: theme.colors.primary,
            margin: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            borderRadius: theme.spacing.md,
          },
        ]}>
        <Text
          style={[
            styles.exportLabel,
            {
              color: theme.colors.onPrimary,
              fontSize: theme.typography.fontSizes.md,
              fontWeight: theme.typography.fontWeights.semibold,
            },
          ]}>
          {t('diagnostics.export.label')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/** Stable, module-scope bindings for useSyncExternalStore. */
function subscribeBuffer(onStoreChange: () => void): () => void {
  return logBuffer.subscribe(onStoreChange);
}
function getBufferSnapshot(): readonly LogEntry[] {
  return logBuffer.getEntries();
}
function keyExtractor(item: LogEntry, index: number): string {
  return `${item.timestamp}-${index}`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  level: {},
  time: {},
  message: {},
  emptyContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    textAlign: 'center',
  },
  exportButton: {
    alignItems: 'center',
  },
  exportLabel: {},
});

export default DiagnosticsScreen;
