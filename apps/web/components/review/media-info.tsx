"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { MediaFile } from "@/types";

function formatFps(fps: number): string {
  // 25 -> "25", 23.976023… -> "23.976"
  const rounded = Math.round(fps);
  return Math.abs(fps - rounded) < 0.001 ? `${rounded}` : fps.toFixed(3);
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function Row({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-tertiary">{label}</span>
      <span className={cn("text-xs ml-4 truncate", muted ? "text-text-tertiary" : "text-text-primary")}>
        {value}
      </span>
    </div>
  );
}

/** Source media properties — resolution, frame rate, duration, size. */
export function MediaInfo({ file }: { file?: MediaFile | null }) {
  if (!file) return null;

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
        Media
      </p>

      {file.width && file.height ? (
        <Row label="Resolution" value={`${file.width} × ${file.height}`} />
      ) : null}

      {/* Frame rate drives marker-export timecodes, so call it out when unknown. */}
      <Row
        label="Frame rate"
        value={file.fps ? `${formatFps(file.fps)} fps` : "Unknown"}
        muted={!file.fps}
      />

      {file.duration_seconds ? (
        <Row label="Duration" value={formatDuration(file.duration_seconds)} />
      ) : null}

      {file.file_size_bytes ? (
        <Row label="Size" value={formatBytes(file.file_size_bytes)} />
      ) : null}

      {file.mime_type ? <Row label="Format" value={file.mime_type} /> : null}

      {file.original_filename ? (
        <Row label="File" value={file.original_filename} />
      ) : null}

      {!file.fps && file.file_type === "video" ? (
        <p className="text-[11px] leading-snug text-amber-400/80">
          Frame rate unknown — marker exports will assume 30 fps. An admin can run
          the media-metadata backfill to fix this.
        </p>
      ) : null}
    </div>
  );
}
