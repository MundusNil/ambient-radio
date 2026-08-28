/**
 * SQLite 存储适配器（技术设计 §5 数据模型）。
 * better-sqlite3 同步 API；tracks/plays/segments 三个表 P1 使用，
 * messages/memories 表结构就位（P2/P3 接入）。
 * 「电台重启不失忆」：时间线从 plays 表重建。
 */
import { randomUUID } from 'node:crypto';
import type { MemoryKind, Segment, SegmentKind, Track } from '@ambient-radio/core';
import Database from 'better-sqlite3';

export interface PlayRow {
  id: string;
  trackId: string;
  startedAt: number;
  endedAt: number | null;
}

export interface RecentPlay {
  trackId: string;
  startedAt: number;
}

export interface Store {
  upsertTracks(tracks: Track[]): void;
  listTracks(): Track[];
  startPlay(trackId: string, startedAt: number): string;
  endPlay(id: string, endedAt: number): void;
  getLastUnfinishedPlay(): { id: string; trackId: string; startedAt: number } | null;
  listRecentPlays(sinceMs: number): RecentPlay[];
  insertSegment(segment: Segment): void;
  listSegments(): Segment[];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artist TEXT,
  duration_ms INTEGER NOT NULL,
  styles_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plays (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id),
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_plays_started ON plays(started_at);
CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  audio_path TEXT,
  duration_ms INTEGER,
  planned_at INTEGER NOT NULL,
  aired_at INTEGER,
  status TEXT NOT NULL DEFAULT 'planned'
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  importance REAL NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
);
`;

interface TrackRow {
  id: string;
  path: string;
  title: string;
  artist: string | null;
  duration_ms: number;
  styles_json: string;
  enabled: number;
  added_at: number;
}

interface SegmentRow {
  id: string;
  kind: SegmentKind;
  text: string;
  audio_path: string | null;
  duration_ms: number | null;
  planned_at: number;
  aired_at: number | null;
  status: Segment['status'];
}

export function createStore(dbPath: string): Store {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  return {
    upsertTracks(tracks: Track[]): void {
      const upsert = db.prepare(`
        INSERT INTO tracks (id, path, title, artist, duration_ms, styles_json, enabled, added_at)
        VALUES (@id, @path, @title, @artist, @durationMs, @stylesJson, @enabled, @addedAt)
        ON CONFLICT(path) DO UPDATE SET
          id = excluded.id,
          title = excluded.title,
          artist = excluded.artist,
          duration_ms = excluded.duration_ms,
          styles_json = excluded.styles_json,
          enabled = excluded.enabled,
          added_at = excluded.added_at
      `);
      const tx = db.transaction((rows: Array<Record<string, unknown>>) => {
        for (const row of rows) upsert.run(row);
      });
      tx(
        tracks.map((t) => ({
          id: t.id,
          path: t.path,
          title: t.title,
          artist: t.artist,
          durationMs: t.durationMs,
          stylesJson: JSON.stringify(t.styles),
          enabled: t.enabled ? 1 : 0,
          addedAt: t.addedAt,
        })),
      );
    },

    listTracks(): Track[] {
      const rows = db.prepare('SELECT * FROM tracks ORDER BY added_at').all() as TrackRow[];
      return rows.map((r) => ({
        id: r.id,
        path: r.path,
        title: r.title,
        artist: r.artist,
        durationMs: r.duration_ms,
        styles: JSON.parse(r.styles_json) as string[],
        enabled: r.enabled === 1,
        addedAt: r.added_at,
      }));
    },

    startPlay(trackId: string, startedAt: number): string {
      const id = randomUUID();
      db.prepare('INSERT INTO plays (id, track_id, started_at) VALUES (?, ?, ?)').run(
        id,
        trackId,
        startedAt,
      );
      return id;
    },

    endPlay(id: string, endedAt: number): void {
      db.prepare('UPDATE plays SET ended_at = ? WHERE id = ?').run(endedAt, id);
    },

    getLastUnfinishedPlay() {
      const row = db
        .prepare(
          'SELECT id, track_id, started_at FROM plays WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
        )
        .get() as { id: string; track_id: string; started_at: number } | undefined;
      if (!row) return null;
      return { id: row.id, trackId: row.track_id, startedAt: row.started_at };
    },

    listRecentPlays(sinceMs: number): RecentPlay[] {
      const rows = db
        .prepare('SELECT track_id, started_at FROM plays WHERE started_at >= ? ORDER BY started_at')
        .all(sinceMs) as Array<{ track_id: string; started_at: number }>;
      return rows.map((r) => ({ trackId: r.track_id, startedAt: r.started_at }));
    },

    insertSegment(segment: Segment): void {
      db.prepare(`
        INSERT INTO segments (id, kind, text, audio_path, duration_ms, planned_at, aired_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        segment.id,
        segment.kind,
        segment.text,
        segment.audioPath,
        segment.durationMs,
        segment.plannedAt,
        segment.airedAt,
        segment.status,
      );
    },

    listSegments(): Segment[] {
      const rows = db.prepare('SELECT * FROM segments ORDER BY planned_at').all() as SegmentRow[];
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        text: r.text,
        audioPath: r.audio_path,
        durationMs: r.duration_ms,
        plannedAt: r.planned_at,
        airedAt: r.aired_at,
        status: r.status,
      }));
    },
  };
}

export type { MemoryKind };
