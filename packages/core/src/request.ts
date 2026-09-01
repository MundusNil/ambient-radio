/**
 * 点歌受理：把听众 query 匹配到曲库。LLM 只抽 query，不选歌（D2）。
 */
import type { Track } from './types';

export function matchSongRequest(tracks: Track[], query: string): Track | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const exact = tracks.find((t) => t.title.toLowerCase() === q);
  if (exact) return exact;
  const tokens = q.split(/[\s，,。.!！？?、/]+/).filter((s) => s.length > 0);
  for (const token of tokens) {
    const hit = tracks.find((t) => t.title.toLowerCase().includes(token));
    if (hit) return hit;
  }
  return tracks.find((t) => t.styles.some((s) => q.includes(s.toLowerCase()))) ?? null;
}
