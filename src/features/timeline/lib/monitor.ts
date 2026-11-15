import type { LabDocument } from "../../../shared/document";
import type { MissionCriterion } from "../../missions/lib/evaluate";
import {
  nextSampleTime,
  type TimelineDocument,
  type Window,
} from "../../../shared/timeline";
import { sampleFrame } from "./sampling";
import type { Range } from "./validation";

export interface MonitorSample {
  t: number;
  complete: boolean;
  ratio: number;
  rms: number;
  received: number;
  emitted: number;
  issues: string[];
}

export interface MonitorCoverage {
  /** 已追迹的采样点，按时间递增；键是时间。 */
  samples: Map<number, MonitorSample>;
  /** 已完成的最后一个网格时间；window.start - 1 表示尚未开始。 */
  cursor: number;
  /** 覆盖是否从时间窗起点连续推进。 */
  contiguous: boolean;
}

export function createCoverage(window: Window): MonitorCoverage {
  return {
    samples: new Map(),
    cursor: window.start - 1,
    contiguous: true,
  };
}

/**
 * 把监测覆盖推进到 upTo，**逐点**追迹期间跨越的每个网格采样点。
 *
 * 这是「掉帧不能跳过短暂失败」的实现核心：调用方只需要传入当前播放时间，
 * 无论中间隔了多少毫秒、丢了多少帧，这里都会按网格逐点调用 sampleFrame。
 * 返回本次新增的采样点数量（用于决定是否刷新界面）。
 */
export function advanceCoverage(
  coverage: MonitorCoverage,
  window: Window,
  step: number,
  upTo: number,
  evaluate: (t: number) => MonitorSample,
): number {
  let added = 0;
  for (;;) {
    const next = nextSampleTime(coverage.cursor, window, step);
    if (next === null || next > upTo) break;
    coverage.samples.set(next, evaluate(next));
    coverage.cursor = next;
    added++;
  }
  return added;
}

/** 用当前文档/准则追迹一个采样点的便捷工厂。 */
export function sampleEvaluator(
  doc: LabDocument,
  timeline: TimelineDocument,
  criterion: MissionCriterion,
): (t: number) => MonitorSample {
  return (t) => {
    const point = sampleFrame(doc, timeline, criterion, t);
    return {
      t: point.t,
      complete: point.complete,
      ratio: point.ratio,
      rms: point.rms,
      received: point.received,
      emitted: point.emitted,
      issues: point.issues,
    };
  };
}

export interface CoverageSummary {
  checked: number;
  failures: Range[];
  complete: boolean;
  sustained: boolean;
  firstFailure: number | null;
  last: MonitorSample | null;
}

/** 折叠覆盖结果；只有「完整 + 连续 + 无失败」才算整窗持续达标。 */
export function summarizeCoverage(
  coverage: MonitorCoverage,
  _window: Window,
  _step: number,
  expectedTotal: number,
): CoverageSummary {
  const samples = [...coverage.samples.values()].sort((a, b) => a.t - b.t);
  const failures: Range[] = [];
  let runStart: number | null = null;
  for (const s of samples) {
    if (!s.complete) {
      if (runStart === null) runStart = s.t;
    } else if (runStart !== null) {
      failures.push({ start: runStart, end: previousTime(samples, s.t) });
      runStart = null;
    }
  }
  if (runStart !== null)
    failures.push({ start: runStart, end: samples[samples.length - 1].t });
  const checked = samples.length;
  const complete = checked >= expectedTotal;
  return {
    checked,
    failures,
    complete,
    sustained: complete && failures.length === 0 && coverage.contiguous,
    firstFailure: failures[0]?.start ?? null,
    last: samples[samples.length - 1] ?? null,
  };
  function previousTime(list: MonitorSample[], t: number): number {
    let prev = t;
    for (const s of list) {
      if (s.t >= t) break;
      prev = s.t;
    }
    return prev;
  }
}

/** 跳转会造成覆盖空洞：重置到目标点之前，并从目标网格点重新开始。 */
export function invalidateForSeek(
  coverage: MonitorCoverage,
  window: Window,
  step: number,
  target: number,
): void {
  const clamped = Math.max(window.start, Math.min(window.end, target));
  const offset = Math.floor((clamped - window.start) / step) * step;
  coverage.samples.clear();
  // 游标停在目标网格点之前，播放推进时会把该点本身也补算进来。
  coverage.cursor = window.start + offset - step;
  coverage.contiguous = true;
}
