/**
 * 时间轴性能策略：
 * - live：播放时按显示器帧率渲染，视觉重算可合并，优先保证流畅；
 * - exact：只展示采样网格上的时间，逐点追迹，优先保证可复现。
 *
 * 二者共用同一个采样时间定义与关键帧插值。更重要的是：无论视觉精度如何，
 * 播放监测都会逐点补算时间窗内的每个采样点，掉帧不会跳过短暂失败。
 */
export type Precision = "live" | "exact";

export interface PrecisionConfig {
  label: string;
  description: string;
  /** 两次视觉光路重算之间的最小间隔（毫秒）。 */
  traceIntervalMs: number;
  /** 目标帧率，仅用于掉帧统计与展示。 */
  targetFps: number;
}

export const precisionPresets: Record<Precision, PrecisionConfig> = {
  live: {
    label: "流畅预览",
    description:
      "按屏幕刷新播放，光路最多每 50ms 重算一次；掉帧只影响画面，不影响逐点测量。",
    traceIntervalMs: 50,
    targetFps: 60,
  },
  exact: {
    label: "严谨校验",
    description: "时间只落在采样网格上，每个采样点都重新追迹，便于逐帧核对。",
    traceIntervalMs: 0,
    targetFps: 20,
  },
};

export interface DroppedFrameReport {
  /** 本次播放累计的视觉掉帧数。 */
  droppedVisual: number;
  /** 因掉帧而合并掉的视觉重算次数。 */
  skippedPreview: number;
  /** 严谨采样中跳过的采样点数；恒为 0，仅用于展示。 */
  skippedExactSamples: number;
}

/**
 * 按 wall-clock 解析播放时间：掉帧只会跳过画面，不会拖慢或跳过时间。
 */
export function playbackTime(
  originMs: number,
  nowMs: number,
  startTime: number,
  duration: number,
  rate = 1,
): { t: number; ended: boolean } {
  const elapsed = Math.max(0, nowMs - originMs) * rate;
  const t = startTime + elapsed;
  if (t >= duration) return { t: duration, ended: true };
  return { t, ended: false };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const s = Math.floor(total / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const milli = total % 1000;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}.${String(
    milli,
  ).padStart(3, "0")}`;
}
