/**
 * AI Voice Agent — Main App Entry Point
 * Tab navigation with Voice Studio, Call History, and Settings
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  SafeAreaView,
  Platform,
  Animated,
} from 'react-native';
import { Colors, Spacing, Radius, FontSizes, FontWeights } from './src/theme';
import VoiceStudioScreen from './src/screens/VoiceStudioScreen';
import CallHistoryScreen from './src/screens/CallHistoryScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { fetchHealth } from './src/api';

type TabName = 'studio' | 'history' | 'settings';

interface TabInfo {
  key: TabName;
  icon: string;
  label: string;
}

const TABS: TabInfo[] = [
  { key: 'studio', icon: '🎙️', label: 'Voice Studio' },
  { key: 'history', icon: '📋', label: 'History' },
  { key: 'settings', icon: '⚙️', label: 'Settings' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabName>('studio');
  const [isConnected, setIsConnected] = useState(false);

  // Check connection on mount
  useEffect(() => {
    const checkHealth = async () => {
      try {
        await fetchHealth();
        setIsConnected(true);
      } catch {
        setIsConnected(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const renderScreen = () => {
    switch (activeTab) {
      case 'studio':
        return <VoiceStudioScreen />;
      case 'history':
        return <CallHistoryScreen />;
      case 'settings':
        return <SettingsScreen />;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bgDeep} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>AI Voice Agent</Text>
        </View>
        <View style={[
          styles.statusBadge,
          isConnected ? styles.statusOnline : styles.statusOffline,
        ]}>
          <View style={[
            styles.statusDot,
            isConnected ? styles.dotOnline : styles.dotOffline,
          ]} />
          <Text style={[
            styles.statusText,
            isConnected ? styles.statusTextOnline : styles.statusTextOffline,
          ]}>
            {isConnected ? 'Connected' : 'Offline'}
          </Text>
        </View>
      </View>

      {/* Tab Bar (Top) */}
      <View style={styles.tabBar}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabBtn, activeTab === tab.key && styles.tabBtnActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={styles.tabIcon}>{tab.icon}</Text>
            <Text style={[
              styles.tabLabel,
              activeTab === tab.key && styles.tabLabelActive,
            ]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Screen Content */}
      <View style={styles.screenContainer}>
        {renderScreen()}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ? StatusBar.currentHeight + 8 : 40 : Spacing.sm,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.bgDeep,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  headerTitle: {
    fontSize: FontSizes.xxl,
    fontWeight: FontWeights.bold,
    color: Colors.primary,
  },

  // Status Badge
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  statusOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  statusOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotOnline: {
    backgroundColor: Colors.success,
  },
  dotOffline: {
    backgroundColor: Colors.danger,
  },
  statusText: {
    fontSize: FontSizes.xs,
    fontWeight: FontWeights.semibold,
  },
  statusTextOnline: {
    color: Colors.successText,
  },
  statusTextOffline: {
    color: Colors.dangerText,
  },

  // Tab Bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 4,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
  },
  tabBtnActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.18)',
    borderWidth: 1,
    borderColor: Colors.borderFocus,
  },
  tabIcon: {
    fontSize: 14,
  },
  tabLabel: {
    color: Colors.textMuted,
    fontSize: FontSizes.sm,
    fontWeight: FontWeights.semibold,
  },
  tabLabelActive: {
    color: Colors.white,
  },

  // Screen
  screenContainer: {
    flex: 1,
    backgroundColor: Colors.bgBase,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    overflow: 'hidden',
  },
});
