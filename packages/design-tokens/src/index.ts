type ColorRoles = {
  canvas: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  onAccent: string;
  success: string;
  warning: string;
  error: string;
  focus: string;
};

export const palette = {
  light: {
    canvas: '#F5F4EE',
    surface: '#FFFEFA',
    text: '#20221C',
    muted: '#5C6154',
    border: '#DBDCD0',
    accent: '#D6F55E',
    onAccent: '#161B08',
    success: '#3E641F',
    warning: '#875708',
    error: '#A42723',
    focus: '#54792A',
  },
  dark: {
    canvas: '#181B16',
    surface: '#20241C',
    text: '#F2F3E9',
    muted: '#B8BFAB',
    border: '#3D4436',
    accent: '#D6F55E',
    onAccent: '#161B08',
    success: '#B5E77B',
    warning: '#F1C379',
    error: '#FFA099',
    focus: '#D6F55E',
  },
} as const satisfies Record<'light' | 'dark', ColorRoles>;

export const levelmaxingBrand = {
  blue: '#2448E8',
  sun: '#FFCF3A',
  green: '#23A15A',
  ink: '#101114',
  white: '#FFFFFF',
} as const;

export const mobilePalette = {
  light: {
    ...palette.light,
    canvas: '#FFFFFF',
    surface: '#F2F2F5',
    text: levelmaxingBrand.ink,
    muted: '#51545E',
    border: '#DDDDE5',
    inputBorder: '#838593',
    primary: levelmaxingBrand.blue,
    onPrimary: levelmaxingBrand.white,
    primarySoft: '#D7E5FF',
    accent: levelmaxingBrand.sun,
    onAccent: levelmaxingBrand.ink,
    accentSoft: '#FFF0B3',
    success: '#14663A',
    successGraphic: levelmaxingBrand.green,
    successSoft: '#CDEFE0',
    focus: levelmaxingBrand.blue,
  },
  dark: {
    ...palette.dark,
    canvas: '#101114',
    surface: '#1D1F28',
    text: '#F8F8FC',
    muted: '#B5B7C8',
    border: '#373A47',
    inputBorder: '#7D8294',
    primary: '#A3B8FF',
    onPrimary: '#131C42',
    primarySoft: '#202E5C',
    accent: levelmaxingBrand.sun,
    onAccent: levelmaxingBrand.ink,
    accentSoft: '#3F3211',
    success: '#81D9A9',
    successGraphic: '#81D9A9',
    successSoft: '#142E23',
    focus: '#A3B8FF',
  },
} as const;
