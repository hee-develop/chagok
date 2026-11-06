import { createContext, useContext } from 'react';
import type { TextStyle } from 'react-native';

export const colors = {
  background: '#f5f5f5',
  text: '#111111',
  textStrong: '#333333',
  textMuted: '#555555',
  border: '#d9d9d9',
  card: '#ffffff',
  notice: '#f0f0f0',
  unchecked: '#7d7d7d',
  onPrimary: '#ffffff',
  primary: '#111111',
  primaryDisabled: '#9a9a9a',
  error: '#b3261e',
  warning: '#8a5200',
  tint: '#11111112',
} as const;

export type FontWeight = 400 | 500 | 600 | 700;

const fontFamily: Record<FontWeight, string> = {
  400: 'IBMPlexSansKR_400Regular',
  500: 'IBMPlexSansKR_500Medium',
  600: 'IBMPlexSansKR_600SemiBold',
  700: 'IBMPlexSansKR_700Bold',
};

const fallbackWeight: Record<FontWeight, TextStyle['fontWeight']> = {
  400: '400',
  500: '500',
  600: '600',
  700: '700',
};

/** IBM Plex Sans KR가 로드됐는지. 로드되지 않았으면 시스템 글꼴에 fontWeight로 굵기를 맞춘다. */
export const FontsLoadedContext = createContext(false);

export function useFont(): (weight: FontWeight) => TextStyle {
  const loaded = useContext(FontsLoadedContext);
  return (weight) => (loaded ? { fontFamily: fontFamily[weight] } : { fontWeight: fallbackWeight[weight] });
}
