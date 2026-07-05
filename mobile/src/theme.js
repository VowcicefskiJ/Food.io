import { Platform } from 'react-native';

export const colors = {
  green950: '#0D1F0D',
  green800: '#1B3B1A',
  green700: '#2E6B28',
  green600: '#3D8035',
  green500: '#4E9342',
  green200: '#B6D4B0',
  green100: '#D5ECD0',
  green50:  '#EBF5E8',
  amber:    '#C4962A',
  amberBg:  '#FDF6E3',
  terra:    '#B85C38',
  terraBg:  '#FAE8DF',
  bg:       '#F6F3EE',
  surface:  '#FFFFFF',
  text:     '#191917',
  text2:    '#48453E',
  text3:    '#807C74',
  border:   '#E2DDD4',
};

export const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });

export const shadow = {
  sm: Platform.select({
    ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 10 },
    android: { elevation: 3 },
    default: {},
  }),
  md: Platform.select({
    ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 20 },
    android: { elevation: 6 },
    default: {},
  }),
  lg: Platform.select({
    ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 28 },
    android: { elevation: 12 },
    default: {},
  }),
};
