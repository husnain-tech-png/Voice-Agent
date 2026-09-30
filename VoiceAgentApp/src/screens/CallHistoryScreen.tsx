/**
 * Call History Screen — Displays all call records with transcripts
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Colors, Spacing, Radius, FontSizes, FontWeights } from '../theme';
import { fetchCallHistory, CallRecord } from '../api';

export default function CallHistoryScreen() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setError(null);
      const history = await fetchCallHistory(30);
      setCalls(history);
    } catch (err: any) {
      setError(err.message || 'Failed to load call history');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const onRefresh = () => {
    setRefreshing(true);
    loadHistory();
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '—';
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  const getTypeIcon = (type?: string) => {
    if (!type) return '📞';
    if (type.includes('Voice Note')) return '🎙️';
    if (type.includes('Text')) return '💬';
    if (type.includes('Call') && type.includes('Rejected')) return '📵';
    if (type.includes('Call')) return '📞';
    return '📋';
  };

  const getTypeBadgeStyle = (type?: string) => {
    if (!type) return styles.badgeBlue;
    if (type.includes('Voice')) return styles.badgePurple;
    if (type.includes('Text')) return styles.badgeBlue;
    if (type.includes('Rejected')) return styles.badgeRed;
    return styles.badgeGreen;
  };

  const renderCallCard = ({ item }: { item: CallRecord }) => {
    const isExpanded = expandedId === item.callSid;

    return (
      <TouchableOpacity
        style={styles.callCard}
        onPress={() => setExpandedId(isExpanded ? null : item.callSid)}
        activeOpacity={0.7}
      >
        {/* Header Row */}
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.callerIcon}>{getTypeIcon(item.type)}</Text>
            <View>
              <Text style={styles.callerNumber}>{item.callerNumber}</Text>
              <Text style={styles.callTime}>{formatDate(item.startTime)}</Text>
            </View>
          </View>
          <View style={styles.cardHeaderRight}>
            <View style={[styles.typeBadge, getTypeBadgeStyle(item.type)]}>
              <Text style={styles.typeBadgeText}>
                {item.channel || 'WhatsApp'}
              </Text>
            </View>
            <Text style={styles.duration}>{formatDuration(item.durationSeconds)}</Text>
          </View>
        </View>

        {/* Summary */}
        {item.summary && (
          <Text style={styles.summary} numberOfLines={isExpanded ? undefined : 2}>
            {item.summary}
          </Text>
        )}

        {/* Expanded Transcript */}
        {isExpanded && item.transcript && item.transcript.length > 0 && (
          <View style={styles.transcriptContainer}>
            <Text style={styles.transcriptTitle}>📝 Transcript</Text>
            {item.transcript.map((t, i) => (
              <View key={i} style={styles.transcriptLine}>
                <Text style={[
                  styles.transcriptRole,
                  t.role === 'user' && styles.roleUser,
                  t.role === 'assistant' && styles.roleBot,
                  t.role === 'system' && styles.roleSystem,
                ]}>
                  {t.role === 'user' ? '👤' : t.role === 'assistant' ? '🤖' : 'ℹ️'} {t.role}:
                </Text>
                <Text style={styles.transcriptText}>{t.text}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Expand hint */}
        <Text style={styles.expandHint}>
          {isExpanded ? '▲ Collapse' : '▼ Show details'}
        </Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading call history...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadHistory}>
          <Text style={styles.retryBtnText}>🔄 Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header Stats */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{calls.length}</Text>
          <Text style={styles.statLabel}>Total Calls</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {calls.filter(c => c.type?.includes('Voice')).length}
          </Text>
          <Text style={styles.statLabel}>Voice Notes</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {calls.filter(c => c.type?.includes('Text')).length}
          </Text>
          <Text style={styles.statLabel}>Text Chats</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {calls.filter(c => c.type?.includes('Call')).length}
          </Text>
          <Text style={styles.statLabel}>Calls</Text>
        </View>
      </View>

      <FlatList
        data={calls}
        keyExtractor={(item) => item.callSid}
        renderItem={renderCallCard}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>No calls yet</Text>
            <Text style={styles.emptySubtext}>
              Call history will appear here when someone messages or calls your AI agent.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgBase,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: Colors.bgBase,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
  },

  // Stats Bar
  statsBar: {
    flexDirection: 'row',
    backgroundColor: Colors.bgOverlay,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    color: Colors.primary,
    fontSize: FontSizes.xl,
    fontWeight: FontWeights.bold,
  },
  statLabel: {
    color: Colors.textMuted,
    fontSize: FontSizes.xs,
    marginTop: 2,
  },

  // List
  listContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
    paddingBottom: Spacing.xxxl,
  },

  // Call Card
  callCard: {
    backgroundColor: Colors.bgCardSolid,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.borderCard,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  callerIcon: {
    fontSize: 20,
  },
  callerNumber: {
    color: Colors.textMain,
    fontSize: FontSizes.base,
    fontWeight: FontWeights.semibold,
  },
  callTime: {
    color: Colors.textMuted,
    fontSize: FontSizes.xs,
    marginTop: 2,
  },
  cardHeaderRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  typeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  badgeBlue: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  badgePurple: {
    backgroundColor: Colors.accentDim,
    borderColor: 'rgba(192, 132, 252, 0.3)',
  },
  badgeGreen: {
    backgroundColor: Colors.successGlow,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  badgeRed: {
    backgroundColor: Colors.dangerGlow,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  typeBadgeText: {
    fontSize: FontSizes.xs,
    fontWeight: FontWeights.semibold,
    color: Colors.textMuted,
  },
  duration: {
    color: Colors.textDark,
    fontSize: FontSizes.xs,
    fontWeight: FontWeights.medium,
  },
  summary: {
    color: Colors.textMuted,
    fontSize: FontSizes.sm,
    lineHeight: 18,
    marginTop: 4,
  },
  expandHint: {
    color: Colors.textDark,
    fontSize: FontSizes.xs,
    textAlign: 'center',
    marginTop: 4,
  },

  // Transcript
  transcriptContainer: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  transcriptTitle: {
    color: Colors.textMuted,
    fontSize: FontSizes.sm,
    fontWeight: FontWeights.semibold,
    marginBottom: Spacing.sm,
  },
  transcriptLine: {
    marginBottom: Spacing.sm,
  },
  transcriptRole: {
    fontSize: FontSizes.xs,
    fontWeight: FontWeights.bold,
    color: Colors.textDark,
    textTransform: 'capitalize',
    marginBottom: 2,
  },
  roleUser: { color: Colors.primary },
  roleBot: { color: Colors.accent },
  roleSystem: { color: Colors.textDark },
  transcriptText: {
    color: Colors.textMuted,
    fontSize: FontSizes.sm,
    lineHeight: 18,
  },

  // Empty & Error
  emptyContainer: {
    alignItems: 'center',
    padding: Spacing.xxxl,
    marginTop: Spacing.xxxl,
  },
  emptyIcon: { fontSize: 48, marginBottom: Spacing.md },
  emptyText: {
    color: Colors.textMain,
    fontSize: FontSizes.lg,
    fontWeight: FontWeights.semibold,
  },
  emptySubtext: {
    color: Colors.textMuted,
    fontSize: FontSizes.sm,
    textAlign: 'center',
    marginTop: Spacing.sm,
    lineHeight: 20,
  },
  errorIcon: { fontSize: 48, marginBottom: Spacing.md },
  errorText: {
    color: Colors.dangerText,
    fontSize: FontSizes.base,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  retryBtn: {
    backgroundColor: Colors.primaryDim,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
  },
  retryBtnText: {
    color: Colors.primary,
    fontWeight: FontWeights.semibold,
  },
  loadingText: {
    color: Colors.textMuted,
    marginTop: Spacing.md,
    fontSize: FontSizes.sm,
  },
});
