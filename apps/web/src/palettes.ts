// 氛围层配色（D4 留缝生长）：六套方案，右上角设置面板手动切换，localStorage 记忆。
// 切换不是瞬间换色：shader 颜色逐帧插值，CSS 强调色走长过渡，整体丝滑滑变。
// 谱系来自 ui-ux-pro-max 技能库（White Noise & Ambient Sound / Sleep Tracker 暗底行），
// accent 对 #0f172a 背景的对比度均 ≥ 4:1（焦点环 / 灯珠可见性）。
export interface OrbScheme {
  id: string;
  name: string;
  /** GrainGradient 三色：亮 → 深 */
  colors: [string, string, string];
  /** UI 强调色：ON AIR 灯珠、焦点环、开台按钮 */
  accent: string;
}

export const ORB_SCHEMES: readonly OrbScheme[] = [
  { id: 'cyan', name: '晴空', colors: ['#22D3EE', '#06B6D4', '#0284C7'], accent: '#0284C7' },
  { id: 'indigo', name: '深海', colors: ['#818CF8', '#6366F1', '#4338CA'], accent: '#6366F1' },
  { id: 'mint', name: '晨雾', colors: ['#6EE7B7', '#34D399', '#0D9488'], accent: '#34D399' },
  { id: 'amber', name: '午后', colors: ['#FCD34D', '#FBBF24', '#D97706'], accent: '#FBBF24' },
  { id: 'violet', name: '暮色', colors: ['#C084FC', '#A855F7', '#7C3AED'], accent: '#A855F7' },
  { id: 'rose', name: '夜樱', colors: ['#FDA4AF', '#FB7185', '#E11D48'], accent: '#FB7185' },
];

export const DEFAULT_SCHEME: OrbScheme = {
  id: 'cyan',
  name: '晴空',
  colors: ['#22D3EE', '#06B6D4', '#0284C7'],
  accent: '#0284C7',
};

const STORAGE_KEY = 'mock-radio.scheme';

export function schemeById(id: string | null): OrbScheme {
  return ORB_SCHEMES.find((s) => s.id === id) ?? DEFAULT_SCHEME;
}

/** 解析初始主题：?scheme= 强制 > localStorage 记忆 > 默认晴空 */
export function initialScheme(): OrbScheme {
  if (typeof window !== 'undefined') {
    const forced = new URLSearchParams(window.location.search).get('scheme');
    if (forced) return schemeById(forced);
    try {
      return schemeById(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      // 隐私模式等场景读不了 storage：走默认
    }
  }
  return DEFAULT_SCHEME;
}

export function persistScheme(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 写不进去就算了，本次会话仍然生效
  }
}

export function hexToRgb01(hex: string): [number, number, number, number] {
  const v = hex.replace('#', '');
  return [
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255,
    1,
  ];
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
