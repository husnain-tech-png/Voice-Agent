/**
 * AI Voice Agent — Design System & Theme
 * Matches the premium glassmorphic dark UI from the web studio
 */

export const Colors = {
  // Backgrounds
  bgDeep: '#020617',
  bgBase: '#0f172a',
  bgCard: 'rgba(30, 41, 59, 0.78)',
  bgCardSolid: '#1e293b',
  bgInput: 'rgba(15, 23, 42, 0.7)',
  bgOverlay: 'rgba(15, 23, 42, 0.55)',

  // Borders
  borderCard: 'rgba(255, 255, 255, 0.1)',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderFocus: 'rgba(56, 189, 248, 0.4)',

  // Primary
  primary: '#38bdf8',
  primaryHover: '#0284c7',
  primaryGlow: 'rgba(56, 189, 248, 0.25)',
  primaryDim: 'rgba(56, 189, 248, 0.12)',

  // Accent
  accent: '#c084fc',
  accentGlow: 'rgba(192, 132, 252, 0.35)',
  accentDim: 'rgba(192, 132, 252, 0.15)',

  // Semantic
  success: '#10b981',
  successGlow: 'rgba(16, 185, 129, 0.18)',
  successText: '#34d399',
  warning: '#f59e0b',
  warningGlow: 'rgba(234, 179, 8, 0.18)',
  warningText: '#fde047',
  danger: '#ef4444',
  dangerGlow: 'rgba(239, 68, 68, 0.18)',
  dangerText: '#f87171',

  // Text
  textMain: '#f8fafc',
  textSecondary: '#f1f5f9',
  textMuted: '#94a3b8',
  textDark: '#64748b',

  // Chat
  userBubble: '#2563eb',
  userBubbleDark: '#1d4ed8',
  botBubble: 'rgba(51, 65, 85, 0.85)',

  // Misc
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 18,
  xxl: 22,
  full: 9999,
};

export const FontSizes = {
  xs: 11,
  sm: 13,
  md: 14,
  base: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  title: 28,
};

export const FontWeights = {
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};
