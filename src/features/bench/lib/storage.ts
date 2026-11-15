import type { LabDocument } from "../../../shared/document";
import {
  emptyTimeline,
  type TimelineDocument,
} from "../../../shared/timeline";

function finiteArray(v: unknown, max: number): boolean {
  return (
    Array.isArray(v) &&
    v.length <= max &&
    v.every(
      (x) =>
        typeof x === "object" &&
        x !== null &&
        Number.isFinite((x as { t: unknown }).t) &&
        Number.isFinite((x as { value: unknown }).value),
    )
  );
}

/**
 * 本地保存不包含播放状态：时间轴随文档一起存储，预览值从不落盘。
 */
export function saveDocument(doc: LabDocument) {
  localStorage.setItem(
    "lumen-document",
    JSON.stringify({
      version: doc.version,
      items: doc.items,
      timeline: doc.timeline ?? emptyTimeline,
    }),
  );
}

export function loadDocument(): LabDocument | null {
  try {
    const raw = JSON.parse(localStorage.getItem("lumen-document") ?? "null");
    if (raw?.version !== 1 || !Array.isArray(raw.items) || raw.items.length > 80)
      return null;
    for (const e of raw.items) {
      if (
        !["source", "mirror", "lens", "prism", "screen"].includes(e.kind) ||
        typeof e.id !== "string"
      )
        return null;
      for (const k of [
        "x",
        "y",
        "angle",
        "size",
        "power",
        "rays",
        "spread",
        "wavelength",
        "focal",
        "index",
      ])
        if (!Number.isFinite(e[k])) return null;
      if (
        e.rays < 1 ||
        e.rays > 41 ||
        e.size <= 0 ||
        Math.abs(e.focal) < 1 ||
        e.index < 1
      )
        return null;
    }
    const timeline = sanitizeTimeline(raw.timeline, raw.items);
    return {
      version: 1,
      items: raw.items,
      timeline: timeline ?? emptyTimeline,
    };
  } catch {
    return null;
  }
}

function sanitizeTimeline(
  value: unknown,
  items: { id: string }[],
): TimelineDocument | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { duration?: unknown; tracks?: unknown };
  const duration = Number(v.duration);
  if (!Number.isFinite(duration) || duration < 1000 || duration > 120000)
    return null;
  if (!v.tracks || typeof v.tracks !== "object" || Array.isArray(v.tracks))
    return null;
  const ids = new Set(items.map((e) => e.id));
  const tracks: TimelineDocument["tracks"] = {};
  for (const [id, track] of Object.entries(
    v.tracks as Record<string, Record<string, unknown>>,
  )) {
    if (!ids.has(id) || !track || typeof track !== "object") continue;
    const clean: Record<string, { t: number; value: number; direction?: string }[]> =
      {};
    for (const [key, keys] of Object.entries(track)) {
      if (!["x", "y", "angle", "focal", "power"].includes(key)) continue;
      if (!finiteArray(keys, 200)) continue;
      clean[key] = (keys as { t: number; value: number; direction?: string }[])
        .map((k) => ({
          t: Math.round(k.t),
          value: k.value,
          ...(k.direction === "cw" || k.direction === "ccw"
            ? { direction: k.direction }
            : {}),
        }))
        .sort((a, b) => a.t - b.t);
    }
    if (Object.keys(clean).length) tracks[id] = clean;
  }
  return { duration: Math.round(duration), tracks };
}
