/**
 * Settings Screen — Server connection & app configuration
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { Colors, Spacing, Radius, FontSizes, FontWeights } from '../theme';
import { fetchHealth, getServerUrl, setServerUrl, fetchWhatsAppStatus, HealthStatus, WhatsAppStatus } from '../api';

export default function SettingsScreen() {
  const [serverUrl, setServerUrlState] = useState(getServerUrl());
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [urlInput, setUrlInput] = useState(getServerUrl());

  const checkConnection = async () => {
    setLoading(true);
    try {
      const h = await fetchHealth();
      setHealth(h);
      
      try {
        const wa = await fetchWhatsAppStatus();
        setWaStatus(wa);
      } catch {
        setWaStatus(null);
      }
    } catch (err: any) {
      setHealth(null);
      Alert.alert('Connection Failed', `Could not connect to ${serverUrl}\n\n${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkConnection();
  }, []);

  const handleSaveUrl = () => {
    const url = urlInput.trim().replace(/\/+$/, '');
    if (!url) return;
    setServerUrl(url);
    setServerUrlState(url);
    checkConnection();
  };

  const ServiceRow = ({ icon, label, value, status }: {
    icon: string;
    label: string;
    value: string;
    status: 'active' | 'inactive' | 'warning';
  }) => (
    <View style={styles.serviceRow}>
      <Text style={styles.serviceIcon}>{icon}</Text>
      <View style={styles.serviceInfo}>
        <Text style={styles.serviceLabel}>{label}</Text>
        <Text style={[
          styles.serviceValue,
          status === 'active' && styles.serviceActive,
          status === 'warning' && styles.serviceWarning,
          status === 'inactive' && styles.serviceInactive,
        ]}>
          {value}
        </Text>
      </View>
      <View style={[
        styles.statusDot,
        status === 'active' && styles.dotActive,
        status === 'warning' && styles.dotWarning,
        status === 'inactive' && styles.dotInactive,
      ]} />
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Server URL Config */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🌐 Server Connection</Text>
        <Text style={styles.cardSubtitle}>
          Connect to your AI Voice Agent backend server
        </Text>

        <View style={styles.urlInputRow}>
          <TextInput
            style={styles.urlInput}
            value={urlInput}
            onChangeText={setUrlInput}
            placeholder="http://localhost:3000"
            placeholderTextColor={Colors.textDark}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TouchableOpacity style={styles.saveBtn} onPress={handleSaveUrl}>
            <Text style={styles.saveBtnText}>Save</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.testBtn}
          onPress={checkConnection}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={styles.testBtnText}>🔍 Test Connection</Text>
          )}
        </TouchableOpacity>

        {health && (
          <View style={styles.statusCard}>
            <View style={styles.statusHeader}>
              <Text style={styles.statusDotLarge}>🟢</Text>
              <Text style={styles.statusText}>{health.message}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Services Status */}
      {health && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔧 Backend Services</Text>

          <ServiceRow
            icon="🧠"
            label="Brain (LLM)"
            value={health.services?.llm || 'Not configured'}
            status={health.services?.llm?.includes('✅') ? 'active' : 'inactive'}
          />
          <ServiceRow
            icon="👂"
            label="Ears (STT)"
            value={health.services?.stt || 'Not configured'}
            status={health.services?.stt?.includes('✅') ? 'active' : 'inactive'}
          />
          <ServiceRow
            icon="👄"
            label="Mouth (TTS)"
            value={health.services?.tts || 'Not configured'}
            status={health.services?.tts?.includes('✅') ? 'active' : 'inactive'}
          />
          <ServiceRow
            icon="📞"
            label="Twilio"
            value={health.services?.twilio || 'Not configured'}
            status={health.services?.twilio?.includes('✅') ? 'active' : 'inactive'}
          />
          <ServiceRow
            icon="⚡"
            label="WebSocket"
            value={health.services?.websocket || 'Ready'}
            status="active"
          />
        </View>
      )}

      {/* WhatsApp Status */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📱 WhatsApp Agent</Text>
        {waStatus ? (
          <>
            <ServiceRow
              icon={waStatus.connected ? '🟢' : '🔴'}
              label="Connection"
              value={waStatus.connected ? 'Connected & Online' : 'Disconnected'}
              status={waStatus.connected ? 'active' : 'inactive'}
            />
            {waStatus.user && (
              <ServiceRow
                icon="👤"
                label="Paired Account"
                value={`${waStatus.user.name} (+${waStatus.user.id?.split(':')[0] || ''})`}
                status="active"
              />
            )}
            <ServiceRow
              icon="💬"
              label="Active Conversations"
              value={`${waStatus.activeConversations || 0} chats`}
              status="active"
            />
          </>
        ) : (
          <Text style={styles.notConnected}>
            WhatsApp agent not reachable. Make sure it's running on port 3005.
          </Text>
        )}
      </View>

      {/* Quick Links */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🔗 Quick Links</Text>
        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => Linking.openURL(`${serverUrl}`)}
        >
          <Text style={styles.linkBtnText}>🌐 Open Web Studio</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => Linking.openURL(`${serverUrl.replace(':3000', ':3005')}/qr`)}
        >
          <Text style={styles.linkBtnText}>📱 WhatsApp QR Page</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => Linking.openURL('https://github.com/husnain-tech-png/Voice-Agent')}
        >
          <Text style={styles.linkBtnText}>📦 GitHub Repository</Text>
        </TouchableOpacity>
      </View>

      {/* App Info */}
      <View style={styles.appInfo}>
        <Text style={styles.appName}>AI Voice Agent</Text>
        <Text style={styles.appVersion}>v1.0.0 • Built with Expo + React Native</Text>
        <Text style={styles.appVersion}>iOS • Android • macOS</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgBase,
  },
  content: {
    padding: Spacing.lg,
    gap: Spacing.lg,
    paddingBottom: Spacing.xxxl * 2,
  },

  // Cards
  card: {
    backgroundColor: Colors.bgCardSolid,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.borderCard,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  cardTitle: {
    color: Colors.textMain,
    fontSize: FontSizes.lg,
    fontWeight: FontWeights.bold,
  },
  cardSubtitle: {
    color: Colors.textMuted,
    fontSize: FontSizes.sm,
    marginTop: -4,
  },

  // URL Input
  urlInputRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  urlInput: {
    flex: 1,
    height: 44,
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: Radius.sm,
    color: Colors.white,
    fontSize: FontSizes.sm,
    paddingHorizontal: Spacing.md,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  saveBtn: {
    backgroundColor: Colors.primaryHover,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: Colors.white,
    fontWeight: FontWeights.semibold,
    fontSize: FontSizes.sm,
  },
  testBtn: {
    backgroundColor: Colors.primaryDim,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderRadius: Radius.sm,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  testBtnText: {
    color: Colors.primary,
    fontWeight: FontWeights.semibold,
    fontSize: FontSizes.sm,
  },

  // Status
  statusCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: Radius.sm,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  statusDotLarge: { fontSize: 16 },
  statusText: {
    color: Colors.successText,
    fontSize: FontSizes.sm,
    fontWeight: FontWeights.medium,
    flex: 1,
  },

  // Service rows
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  serviceIcon: {
    fontSize: 18,
    width: 28,
    textAlign: 'center',
  },
  serviceInfo: {
    flex: 1,
  },
  serviceLabel: {
    color: Colors.textMain,
    fontSize: FontSizes.sm,
    fontWeight: FontWeights.medium,
  },
  serviceValue: {
    fontSize: FontSizes.xs,
    marginTop: 2,
  },
  serviceActive: { color: Colors.successText },
  serviceWarning: { color: Colors.warningText },
  serviceInactive: { color: Colors.textDark },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: { backgroundColor: Colors.success },
  dotWarning: { backgroundColor: Colors.warning },
  dotInactive: { backgroundColor: Colors.textDark },

  notConnected: {
    color: Colors.textDark,
    fontSize: FontSizes.sm,
    fontStyle: 'italic',
  },

  // Links
  linkBtn: {
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.borderCard,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  linkBtnText: {
    color: Colors.primary,
    fontSize: FontSizes.sm,
    fontWeight: FontWeights.medium,
  },

  // App Info
  appInfo: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: 4,
  },
  appName: {
    color: Colors.textMain,
    fontSize: FontSizes.lg,
    fontWeight: FontWeights.bold,
  },
  appVersion: {
    color: Colors.textDark,
    fontSize: FontSizes.xs,
  },
});
