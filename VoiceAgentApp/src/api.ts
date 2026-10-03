/**
 * API Service — Connects to the Voice Agent backend
 * Handles health checks, chat, STT, TTS, and WebSocket connections
 */

import { Platform } from 'react-native';

export const PRESET_SERVERS = [
  { label: '💻 Localhost', url: 'http://localhost:3000' },
  { label: '🤖 Android Emulator', url: 'http://10.0.2.2:3000' },
  { label: '🌐 Live Tunnel', url: 'https://large-hotels-listen.loca.lt' },
  { label: '🏠 Wi-Fi (LAN)', url: 'http://10.9.26.152:3000' },
];

// Auto-detect the backend URL based on platform
function getDefaultServerUrl(): string {
  // On emulator: Android uses 10.0.2.2 (loopback to host localhost), iOS/Web uses localhost
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3000';
  }
  return 'http://localhost:3000';
}

let SERVER_URL = getDefaultServerUrl();

export function setServerUrl(url: string) {
  SERVER_URL = url.replace(/\/+$/, '');
}

export function getServerUrl(): string {
  return SERVER_URL;
}

export function getWsUrl(): string {
  return SERVER_URL.replace(/^http/, 'ws') + '/ws/voice';
}

// ─── Health Check ────────────────────────────────────────────────────────────

export interface HealthStatus {
  status: string;
  message: string;
  services?: {
    llm?: string;
    stt?: string;
    tts?: string;
    twilio?: string;
    openai?: string;
    websocket?: string;
  };
  stage3?: any;
  stage4?: any;
  stage5?: any;
  telnyx?: any;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch(`${SERVER_URL}/api/health`, { 
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

// ─── Text Chat ───────────────────────────────────────────────────────────────

export interface ChatResponse {
  reply: string;
  model?: string;
  tokens?: number;
}

export async function sendChatMessage(message: string): Promise<ChatResponse> {
  const res = await fetch(`${SERVER_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
  return res.json();
}

// ─── Voice Chat (Upload audio, get audio back) ──────────────────────────────

export async function sendVoiceChat(audioBase64: string, mimeType: string = 'audio/wav'): Promise<{
  transcript: string;
  reply: string;
  audioBase64?: string;
}> {
  const formData = new FormData();
  
  // Convert base64 to blob-like for FormData
  formData.append('audio', {
    uri: `data:${mimeType};base64,${audioBase64}`,
    type: mimeType,
    name: 'recording.wav',
  } as any);

  const res = await fetch(`${SERVER_URL}/voice-chat`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`Voice chat failed: ${res.status}`);
  return res.json();
}

// ─── Transcription (STT) ────────────────────────────────────────────────────

export async function transcribeAudio(audioUri: string): Promise<{ text: string }> {
  const formData = new FormData();
  formData.append('audio', {
    uri: audioUri,
    type: 'audio/wav',
    name: 'recording.wav',
  } as any);

  const res = await fetch(`${SERVER_URL}/transcribe`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`Transcription failed: ${res.status}`);
  return res.json();
}

// ─── Text-to-Speech ─────────────────────────────────────────────────────────

export async function synthesizeSpeech(text: string, voiceId?: string): Promise<ArrayBuffer> {
  const body: any = { text };
  if (voiceId) body.voiceId = voiceId;

  const res = await fetch(`${SERVER_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
  return res.arrayBuffer();
}

// ─── Voices List ─────────────────────────────────────────────────────────────

export interface VoiceInfo {
  id: string;
  name: string;
  category?: string;
}

export async function fetchVoices(): Promise<VoiceInfo[]> {
  const res = await fetch(`${SERVER_URL}/api/voices`);
  if (!res.ok) throw new Error(`Voices fetch failed: ${res.status}`);
  const data = await res.json();
  return data.voices || [];
}

// ─── Call History ────────────────────────────────────────────────────────────

export interface CallRecord {
  callSid: string;
  callerNumber: string;
  channel?: string;
  type?: string;
  startTime: string;
  endTime?: string;
  durationSeconds?: number;
  transcript?: Array<{ role: string; text: string }>;
  summary?: string;
  smsSent?: boolean;
}

export async function fetchCallHistory(limit: number = 20): Promise<CallRecord[]> {
  const res = await fetch(`${SERVER_URL}/api/calls/history?limit=${limit}`);
  if (!res.ok) throw new Error(`Call history failed: ${res.status}`);
  const data = await res.json();
  return data.history || data || [];
}

// ─── WhatsApp Status ─────────────────────────────────────────────────────────
// All WhatsApp calls go through the main server's /api/whatsapp/* proxy so the
// app works with a single URL (tunnel, LAN or emulator) — no port 3005 guessing.

export interface WhatsAppStatus {
  status: string; // "connecting" | "qr_ready" | "connected" | "disconnected" | "not_running"
  connected: boolean;
  user?: { id: string; name: string } | null;
  activeConversations?: number;
  qrDataUrl?: string | null;   // PNG data URL of the current QR (when not connected)
  pairingCode?: string | null; // Last issued phone-number pairing code
  error?: string;
}

export async function fetchWhatsAppStatus(): Promise<WhatsAppStatus> {
  const res = await fetch(`${SERVER_URL}/api/whatsapp/qr`, {
    headers: { 'Accept': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 503) throw new Error(data?.error || `WhatsApp status failed: ${res.status}`);
  return data as WhatsAppStatus;
}

/**
 * Request an 8-character pairing code for linking WhatsApp by phone number.
 * Use this when the app runs on the same phone as WhatsApp (a phone can't scan its own screen).
 * @param phone Full number with country code, digits only, e.g. "923001234567"
 */
export async function requestWhatsAppPairingCode(phone: string): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/whatsapp/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phone.replace(/\D/g, '') }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || `Pairing failed: ${res.status}`);
  return data.code;
}

export async function logoutWhatsApp(): Promise<void> {
  const res = await fetch(`${SERVER_URL}/api/whatsapp/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || `Logout failed: ${res.status}`);
}
