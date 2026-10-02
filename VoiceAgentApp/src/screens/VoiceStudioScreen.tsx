/**
 * Voice Studio Screen — Main AI voice interaction interface
 * Features: Mic recording, chat bubbles, live latency telemetry, text input
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Audio } from 'expo-av';
import { Colors, Spacing, Radius, FontSizes, FontWeights } from '../theme';
import { sendChatMessage, getServerUrl } from '../api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface LatencyMetrics {
  ttfa: number | null;
  stt: number | null;
  llm: number | null;
  tts: number | null;
}

export default function VoiceStudioScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'system',
      text: '🎙️ Voice Studio Connected',
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [latency, setLatency] = useState<LatencyMetrics>({
    ttfa: null, stt: null, llm: null, tts: null,
  });

  const scrollRef = useRef<ScrollView>(null);
  const micPulse = useRef(new Animated.Value(1)).current;
  const speakingPulse = useRef(new Animated.Value(0.3)).current;
  const wsRef = useRef<WebSocket | null>(null);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Mic pulse animation
  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(micPulse, { toValue: 1.15, duration: 600, useNativeDriver: true }),
          Animated.timing(micPulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      micPulse.setValue(1);
    }
  }, [isRecording, micPulse]);

  // Speaking wave animation
  useEffect(() => {
    if (isSpeaking) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(speakingPulse, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(speakingPulse, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ])
      ).start();
    } else {
      speakingPulse.setValue(0.3);
    }
  }, [isSpeaking, speakingPulse]);

  // ─── Send Text Message ──────────────────────────────────────────────
  const handleSendText = async () => {
    const text = inputText.trim();
    if (!text || isProcessing) return;

    setInputText('');
    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsProcessing(true);

    const llmStart = Date.now();
    try {
      const response = await sendChatMessage(text);
      const llmTime = Date.now() - llmStart;
      setLatency(prev => ({ ...prev, llm: llmTime }));

      const botMsg: ChatMessage = {
        id: `bot_${Date.now()}`,
        role: 'assistant',
        text: response.reply,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botMsg]);
    } catch (err: any) {
      const errMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        role: 'system',
        text: `⚠️ ${err.message || 'Connection error'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsProcessing(false);
    }
  };

  // ─── Voice Recording ────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Please grant microphone access to use voice features.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecording(newRecording);
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
      Alert.alert('Error', 'Could not start recording. Please check your microphone permissions.');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    setIsRecording(false);

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);

      if (!uri) return;

      // Add user message indicator
      const userMsg: ChatMessage = {
        id: `voice_user_${Date.now()}`,
        role: 'user',
        text: '🎙️ Voice message...',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMsg]);
      setIsProcessing(true);

      const sttStart = Date.now();

      // Upload audio to backend
      const formData = new FormData();
      formData.append('audio', {
        uri,
        type: 'audio/m4a',
        name: 'recording.m4a',
      } as any);

      // Step 1: Transcribe
      const transcribeRes = await fetch(`${getServerUrl()}/transcribe`, {
        method: 'POST',
        body: formData,
      });

      if (!transcribeRes.ok) throw new Error('Transcription failed');
      const { text: transcript } = await transcribeRes.json();
      const sttTime = Date.now() - sttStart;

      // Update the user message with actual transcript
      setMessages(prev => prev.map(m =>
        m.id === userMsg.id ? { ...m, text: transcript || '(could not transcribe)' } : m
      ));
      setLatency(prev => ({ ...prev, stt: sttTime }));

      if (!transcript) {
        setIsProcessing(false);
        return;
      }

      // Step 2: Get LLM response
      const llmStart = Date.now();
      const chatRes = await sendChatMessage(transcript);
      const llmTime = Date.now() - llmStart;
      setLatency(prev => ({ ...prev, llm: llmTime }));

      const botMsg: ChatMessage = {
        id: `bot_${Date.now()}`,
        role: 'assistant',
        text: chatRes.reply,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botMsg]);

      // Step 3: TTS playback
      const ttsStart = Date.now();
      try {
        const ttsRes = await fetch(`${getServerUrl()}/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: chatRes.reply }),
        });

        if (ttsRes.ok) {
          const ttsTime = Date.now() - ttsStart;
          setLatency(prev => ({
            ...prev,
            tts: ttsTime,
            ttfa: (sttTime + llmTime + ttsTime),
          }));

          // Play the audio
          const audioBlob = await ttsRes.blob();
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = (reader.result as string).split(',')[1];
            if (base64) {
              setIsSpeaking(true);
              try {
                const { sound } = await Audio.Sound.createAsync(
                  { uri: `data:audio/mp3;base64,${base64}` },
                  { shouldPlay: true }
                );
                sound.setOnPlaybackStatusUpdate((status) => {
                  if ('didJustFinish' in status && status.didJustFinish) {
                    setIsSpeaking(false);
                    sound.unloadAsync();
                  }
                });
              } catch {
                setIsSpeaking(false);
              }
            }
          };
          reader.readAsDataURL(audioBlob);
        }
      } catch {
        // TTS is optional — text reply is enough
      }
    } catch (err: any) {
      const errMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        role: 'system',
        text: `⚠️ ${err.message || 'Voice processing error'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Latency Telemetry Dashboard */}
      <View style={styles.telemetryGrid}>
        <View style={styles.telemetryItem}>
          <Text style={styles.telemetryLabel}>⚡ TTFA</Text>
          <Text style={[styles.telemetryValue, (latency.ttfa !== null && latency.ttfa < 500) ? styles.telemetryGood : null]}>
            {latency.ttfa ? `${latency.ttfa}ms` : '—'}
          </Text>
        </View>
        <View style={styles.telemetryItem}>
          <Text style={styles.telemetryLabel}>👂 STT</Text>
          <Text style={styles.telemetryValue}>
            {latency.stt ? `${latency.stt}ms` : '—'}
          </Text>
        </View>
        <View style={styles.telemetryItem}>
          <Text style={styles.telemetryLabel}>🧠 LLM</Text>
          <Text style={styles.telemetryValue}>
            {latency.llm ? `${latency.llm}ms` : '—'}
          </Text>
        </View>
        <View style={styles.telemetryItem}>
          <Text style={styles.telemetryLabel}>👄 TTS</Text>
          <Text style={styles.telemetryValue}>
            {latency.tts ? `${latency.tts}ms` : '—'}
          </Text>
        </View>
      </View>

      {/* Speaking Banner */}
      {isSpeaking && (
        <View style={styles.speakingBanner}>
          <View style={styles.soundWaves}>
            {[0, 1, 2, 3].map(i => (
              <Animated.View
                key={i}
                style={[
                  styles.soundWaveBar,
                  { opacity: speakingPulse, transform: [{ scaleY: i % 2 === 0 ? 1 : 0.6 }] },
                ]}
              />
            ))}
          </View>
          <Text style={styles.speakingText}>🔊 AI is speaking...</Text>
        </View>
      )}

      {/* Recording Banner */}
      {isRecording && (
        <View style={styles.recordingBanner}>
          <View style={styles.soundWaves}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={[styles.soundWaveBar, styles.recordWaveBar]} />
            ))}
          </View>
          <Text style={styles.recordingText}>🎙️ Recording...</Text>
          <TouchableOpacity onPress={stopRecording} style={styles.stopBtn}>
            <Text style={styles.stopBtnText}>⏹ Stop</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Chat Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.chatBox}
        contentContainerStyle={styles.chatContent}
        showsVerticalScrollIndicator={false}
      >
        {messages.map(msg => (
          <View
            key={msg.id}
            style={[
              styles.msgBubble,
              msg.role === 'user' && styles.userBubble,
              msg.role === 'assistant' && styles.botBubble,
              msg.role === 'system' && styles.systemBubble,
            ]}
          >
            <Text
              style={[
                styles.msgText,
                msg.role === 'system' && styles.systemText,
              ]}
            >
              {msg.text}
            </Text>
          </View>
        ))}

        {isProcessing && (
          <View style={[styles.msgBubble, styles.botBubble]}>
            <ActivityIndicator size="small" color={Colors.primary} />
          </View>
        )}
      </ScrollView>

      {/* Input Row */}
      <View style={styles.inputRow}>
        {/* Mic Button */}
        <Animated.View style={{ transform: [{ scale: micPulse }] }}>
          <TouchableOpacity
            style={[styles.micBtn, isRecording && styles.micBtnRecording]}
            onPress={toggleRecording}
            disabled={isProcessing}
          >
            <Text style={styles.micBtnText}>
              {isRecording ? '⏹' : '🎙️'}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Text Input */}
        <TextInput
          style={styles.textInput}
          placeholder="Type a message..."
          placeholderTextColor={Colors.textDark}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSendText}
          returnKeyType="send"
          editable={!isProcessing && !isRecording}
        />

        {/* Send Button */}
        <TouchableOpacity
          style={[styles.sendBtn, (!inputText.trim() || isProcessing) && styles.sendBtnDisabled]}
          onPress={handleSendText}
          disabled={!inputText.trim() || isProcessing}
        >
          <Text style={styles.sendBtnText}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgBase,
  },

  // Telemetry
  telemetryGrid: {
    flexDirection: 'row',
    backgroundColor: Colors.bgOverlay,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  telemetryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  telemetryLabel: {
    color: Colors.textMuted,
    fontSize: FontSizes.xs,
    fontWeight: FontWeights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  telemetryValue: {
    color: Colors.textSecondary,
    fontSize: FontSizes.md,
    fontWeight: FontWeights.bold,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  telemetryGood: {
    color: Colors.successText,
  },

  // Banners
  speakingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.accentDim,
    borderWidth: 1,
    borderColor: 'rgba(192, 132, 252, 0.3)',
    borderRadius: Radius.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  speakingText: {
    color: '#e9d5ff',
    fontSize: FontSizes.sm,
    fontWeight: FontWeights.medium,
  },
  recordingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dangerGlow,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: Radius.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  recordingText: {
    color: '#fca5a5',
    fontSize: FontSizes.sm,
    fontWeight: FontWeights.medium,
    flex: 1,
  },
  stopBtn: {
    backgroundColor: Colors.danger,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.sm,
  },
  stopBtnText: {
    color: Colors.white,
    fontSize: FontSizes.xs,
    fontWeight: FontWeights.bold,
  },
  soundWaves: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 14,
  },
  soundWaveBar: {
    width: 3,
    height: '100%',
    backgroundColor: Colors.accent,
    borderRadius: 2,
  },
  recordWaveBar: {
    backgroundColor: Colors.danger,
  },

  // Chat
  chatBox: {
    flex: 1,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  chatContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  msgBubble: {
    maxWidth: '85%',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.userBubble,
    borderBottomRightRadius: 3,
  },
  botBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.botBubble,
    borderBottomLeftRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
  },
  systemBubble: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  msgText: {
    color: Colors.textSecondary,
    fontSize: FontSizes.base,
    lineHeight: 22,
  },
  systemText: {
    color: Colors.textMuted,
    fontSize: FontSizes.sm,
    textAlign: 'center',
  },

  // Input Row
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingBottom: Platform.OS === 'ios' ? Spacing.xxl : Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderSubtle,
    backgroundColor: Colors.bgBase,
  },
  micBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryDim,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnRecording: {
    backgroundColor: Colors.danger,
    borderColor: Colors.dangerText,
    shadowColor: Colors.danger,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
  },
  micBtnText: {
    fontSize: 22,
  },
  textInput: {
    flex: 1,
    height: 48,
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: Radius.md,
    color: Colors.white,
    fontSize: FontSizes.base,
    paddingHorizontal: Spacing.lg,
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    color: Colors.white,
    fontSize: 20,
    fontWeight: FontWeights.bold,
  },
});
