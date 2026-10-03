/**
 * Settings Screen — Server connection & app configuration
 */

import React, { useState, useEffect, useCallback } from 'react';
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
  Image,
} from 'react-native';
import { Colors, Spacing, Radius, FontSizes, FontWeights } from '../theme';
import {
  fetchHealth,
  getServerUrl,
  setServerUrl,
  fetchWhatsAppStatus,
  requestWhatsAppPairingCode,
  logoutWhatsApp,
  HealthStatus,
  WhatsAppStatus,
  PRESET_SERVERS,
} from '../api';

export default function SettingsScreen() {
  const [serverUrl, setServerUrlState] = useState(getServerUrl());
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [urlInput, setUrlInput] = useState(getServerUrl());
  const [pairPhone, setPairPhone] = useState('');
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);

  const refreshWhatsApp = useCallback(async () => {
    try {
      const wa = await fetchWhatsAppStatus();
      setWaStatus(wa);
      if (wa.connected) setPairCode(null);
    } catch {
      setWaStatus(null);
    }
  }, []);

  const checkConnection = async () => {
    setLoading(true);
    try {
      const h = await fetchHealth();
      setHealth(h);
      await refreshWhatsApp();
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

  // Poll while WhatsApp is not yet linked — QR codes rotate every ~20s
  const waLinked = !!waStatus?.connected;
  useEffect(() => {
    if (!health || waLinked) return;
    const id = setInterval(refreshWhatsApp, 4000);
    return () => clearInterval(id);
  }, [health, waLinked, refreshWhatsApp]);

  const handleRequestPairingCode = async () => {
    const digits = pairPhone.replace(/\D/g, '');
    if (digits.length < 10) {
      Alert.alert('Invalid number', 'Enter your full WhatsApp number with country code, e.g. 923001234567');
      return;
    }
    setPairing(true);
    try {
      const code = await requestWhatsAppPairingCode(digits);
      setPairCode(code);
    } catch (err: any) {
      Alert.alert('Pairing failed', err.message);
    } finally {
      setPairing(false);
    }
  };

  const handleDisconnectWhatsApp = () => {
    Alert.alert('Disconnect WhatsApp?', 'The agent will stop replying until you link a number again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          try {
            await logoutWhatsApp();
            setPairCode(null);
            setTimeout(refreshWhatsApp, 2500);
          } catch (err: any) {
            Alert.alert('Disconnect failed', err.message);
          }
        },
      },
    ]);
  };

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

        {/* Quick Presets */}
        <View style={styles.presetsRow}>
          {PRESET_SERVERS.map((preset) => {
            const isActive = urlInput.trim().replace(/\/+$/, '') === preset.url.trim().replace(/\/+$/, '');
            return (
              <TouchableOpacity
                key={preset.url}
                style={[styles.presetChip, isActive && styles.presetChipActive]}
                onPress={() => {
                  setUrlInput(preset.url);
                  setServerUrl(preset.url);
                  setServerUrlState(preset.url);
                  // auto test on preset change
                  setTimeout(checkConnection, 100);
                }}
              >
                <Text style={[styles.presetChipText, isActive && styles.presetChipTextActive]}>
                  {preset.label}
                </Text>
              </TouchableOpacity>
            );
          })}
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
        {!waStatus || waStatus.status === 'not_running' ? (
          <Text style={styles.notConnected}>
            WhatsApp agent not reachable. Start it on the server with: npm run whatsapp
          </Text>
        ) : waStatus.connected ? (
          <>
            <ServiceRow
              icon="🟢"
              label="Connection"
              value="Connected & Online"
              status="active"
            />
            {waStatus.user && (
              <ServiceRow
                icon="👤"
                label="Paired Account"
                value={`${waStatus.user.name || 'WhatsApp'} (+${waStatus.user.id?.split(':')[0] || ''})`}
                status="active"
              />
            )}
            <ServiceRow
              icon="💬"
              label="Active Conversations"
              value={`${waStatus.activeConversations || 0} chats`}
              status="active"
            />
            <TouchableOpacity style={styles.dangerBtn} onPress={handleDisconnectWhatsApp}>
              <Text style={styles.dangerBtnText}>Disconnect & Pair New Number</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ServiceRow
              icon="🟡"
              label="Connection"
              value={waStatus.qrDataUrl ? 'Waiting for you to link a device' : 'Preparing a fresh QR code…'}
              status="warning"
            />

            {/* Option 1: Scan QR (from another phone, or this app on a tablet/PC) */}
            <Text style={styles.waSectionLabel}>Option 1 — Scan QR from another device</Text>
            <View style={styles.qrBox}>
              {waStatus.qrDataUrl ? (
                <Image source={{ uri: waStatus.qrDataUrl }} style={styles.qrImage} resizeMode="contain" />
              ) : (
                <ActivityIndicator size="large" color={Colors.black} />
              )}
            </View>
            <Text style={styles.waHint}>
              WhatsApp → Settings → Linked Devices → Link a Device. The code refreshes automatically.
            </Text>

            {/* Option 2: Pairing code (when WhatsApp is on THIS phone) */}
            <Text style={styles.waSectionLabel}>Option 2 — WhatsApp is on this phone</Text>
            <View style={styles.urlInputRow}>
              <TextInput
                style={styles.urlInput}
                value={pairPhone}
                onChangeText={setPairPhone}
                placeholder="923001234567"
                placeholderTextColor={Colors.textDark}
                keyboardType="phone-pad"
                maxLength={16}
              />
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleRequestPairingCode}
                disabled={pairing}
              >
                {pairing ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.saveBtnText}>Get Code</Text>
                )}
              </TouchableOpacity>
            </View>
            {(pairCode || waStatus.pairingCode) && (
              <View style={styles.pairCodeBox}>
                <Text style={styles.pairCodeText} selectable>
                  {pairCode || waStatus.pairingCode}
                </Text>
              </View>
            )}
            <Text style={styles.waHint}>
              WhatsApp → Linked Devices → Link a Device → “Link with phone number instead”, then enter the code.
            </Text>
          </>
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
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  presetChip: {
    backgroundColor: Colors.bgInput,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  presetChipActive: {
    backgroundColor: Colors.primaryDim,
    borderColor: Colors.primary,
  },
  presetChipText: {
    color: Colors.textDark,
    fontSize: FontSizes.xs,
    fontWeight: FontWeights.medium,
  },
  presetChipTextActive: {
    color: Colors.primary,
    fontWeight: FontWeights.bold,
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

  // WhatsApp linking
  waSectionLabel: {
    color: Colors.textMuted,
    fontSize: FontSizes.xs,
    fontWeight: FontWeights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: Spacing.sm,
  },
  qrBox: {
    alignSelf: 'center',
    width: 252,
    height: 252,
    backgroundColor: Colors.white, // QR must be dark-on-light to scan reliably
    borderRadius: Radius.lg,
    padding: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrImage: {
    width: 236,
    height: 236,
  },
  waHint: {
    color: Colors.textDark,
    fontSize: FontSizes.xs,
    lineHeight: 16,
  },
  pairCodeBox: {
    backgroundColor: Colors.successGlow,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    borderRadius: Radius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  pairCodeText: {
    color: Colors.successText,
    fontSize: FontSizes.xxl,
    fontWeight: FontWeights.bold,
    letterSpacing: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  dangerBtn: {
    backgroundColor: Colors.dangerGlow,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: Radius.sm,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  dangerBtnText: {
    color: Colors.dangerText,
    fontWeight: FontWeights.semibold,
    fontSize: FontSizes.sm,
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
