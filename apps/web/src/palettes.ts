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
  // 晴空：Cyan & Sky Blue 极光青蓝
  { id: 'cyan', name: '晴空', colors: ['#67E8F9', '#22D3EE', '#0EA5E9'], accent: '#38BDF8' },
  // 深海：Deep Indigo & Royal Purple 沉静靛蓝
  { id: 'indigo', name: '深海', colors: ['#818CF8', '#5B5BD6', '#3730A3'], accent: '#818CF8' },
  // 晨雾：Emerald & Mint Teal 雾光薄荷绿
  { id: 'mint', name: '晨雾', colors: ['#86EFAC', '#34D399', '#0F766E'], accent: '#34D399' },
  // 午后：Amber & Golden Sunset 暖金落日
  { id: 'amber', name: '午后', colors: ['#FDE68A', '#F59E0B', '#B45309'], accent: '#FBBF24' },
  // 暮色：Neon Violet & Magenta 霓虹暮紫
  { id: 'violet', name: '暮色', colors: ['#C4B5FD', '#A855F7', '#86198F'], accent: '#A855F7' },
  // 夜樱：Rose Gold & Crimson Bloom 夜樱冷绯
  { id: 'rose', name: '夜樱', colors: ['#FDCFE8', '#FB7185', '#BE123C'], accent: '#FB7185' },
];

export const DEFAULT_SCHEME: OrbScheme = {
  id: 'cyan',
  name: '晴空',
  colors: ['#67E8F9', '#22D3EE', '#0EA5E9'],
  accent: '#38BDF8',
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
