import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LabDocument } from "../../../shared/document";
import type { MissionCriterion } from "../../missions/lib/evaluate";
import {
  documentAt,
  findAngleAmbiguities,
  quantizeTime,
  sampleCount,
  stepSampleTime,
  timelineHasKeys,
  type TimelineDocument,
  type Window,
} from "../../../shared/timeline";
import {
  advanceCoverage,
  createCoverage,
  invalidateForSeek,
  sampleEvaluator,
  summarizeCoverage,
  type CoverageSummary,
  type MonitorCoverage,
  type MonitorSample,
} from "../lib/monitor";
import type { Range } from "../lib/validation";
import {
  playbackTime,
  precisionPresets,
  type DroppedFrameReport,
  type Precision,
} from "../lib/playback";

export type PlaybackStatus = "idle" | "playing" | "paused";

export interface PreviewState {
  t: number;
  doc: LabDocument;
  issues: ReturnType<typeof documentAt>["issues"];
}

export type { MonitorSample };

export interface MonitorState {
  checked: number;
  total: number;
  progress: number;
  failures: Range[];
  complete: boolean;
  last: MonitorSample | null;
  /** 播放中一修改时间轴，旧覆盖即作废并重新开始。 */
  stale: boolean;
  /** 采样覆盖是否从时间窗起点连续推进（跳转会造成空洞）。 */
  contiguous: boolean;
  /** 覆盖完整且没有失败采样点。 */
  sustained: boolean;
  firstFailure: number | null;
}

export interface TimelinePlaybackOptions {
  base: LabDocument;
  timeline: TimelineDocument;
  criterion: MissionCriterion;
  precision: Precision;
  sampleStep: number;
  window: Window;
  /** 播放器总时长，默认时间轴时长。 */
  endAt?: number;
}

function emptyMonitor(total: number): MonitorState {
  return {
    checked: 0,
    total,
    progress: 0,
    failures: [],
    complete: false,
    last: null,
    stale: false,
    contiguous: true,
    sustained: false,
    firstFailure: null,
  };
}

/**
 * 不晚于 t 的最后一个采样网格点。用算术计算而非构造数组：与
 * sampleTimes 是同一网格（start + k*step，末点固定为 end）。
 */
function latestSampleAt(window: Window, step: number, t: number): number {
  const start = quantizeTime(window.start);
  const end = quantizeTime(window.end);
  const dt = Math.max(1, Math.round(step));
  if (t <= start) return start;
  if (t >= end) return end;
  return start + Math.floor((quantizeTime(t) - start) / dt) * dt;
}

/**
 * 播放引擎。
 *
 * 1. 时间轴只产生「预览文档」（documentAt 的派生结果），绝不写回布局；
 * 2. 视觉动画按 wall-clock 推进，掉帧只影响画面，不影响时间解释；
 * 3. 无论视觉是否掉帧，监测器都会把 (上次游标, 当前时间] 内**所有**采样
 *    网格点逐点追迹，短暂的失败不可能被跳帧掩盖；
 * 4. 播放中编辑关键帧立即作用于预览，同时把监测标记为不连续；
 * 5. 停止回到编辑态并清空预览，暂停保留位置但布局不变。
 */
export function useTimelinePlayback({
  base,
  timeline,
  criterion,
  precision,
  sampleStep,
  window: timeWindow,
  endAt,
}: TimelinePlaybackOptions) {
  const config = precisionPresets[precision];
  const step = Math.max(1, Math.round(sampleStep));
  const total = Math.max(
    1,
    Math.min(timeline.duration, endAt ?? timeline.duration),
  );
  const totalSamples = useMemo(
    () => sampleCount(timeWindow, step),
    [timeWindow, step],
  );

  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [monitor, setMonitor] = useState<MonitorState>(() =>
    emptyMonitor(totalSamples),
  );
  const [drops, setDrops] = useState<DroppedFrameReport>({
    droppedVisual: 0,
    skippedPreview: 0,
    skippedExactSamples: 0,
  });

  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const timeRef = useRef(0);
  // 监测覆盖：从窗口起点连续逐点累积的采样结果。
  const coverageRef = useRef<MonitorCoverage>(createCoverage(timeWindow));
  const lastFrameRef = useRef(0);
  const lastTraceRef = useRef(0);
  const statusRef = useRef<PlaybackStatus>("idle");

  const liveRef = useRef({
    base,
    timeline,
    criterion,
    precision,
    step,
    timeWindow,
    total,
    totalSamples,
    config,
  });
  liveRef.current = {
    base,
    timeline,
    criterion,
    precision,
    step,
    timeWindow,
    total,
    totalSamples,
    config,
  };

  /** 当前文档的逐点评估器；播放中编辑会即时更新。 */
  const evaluateRef = useRef(sampleEvaluator(base, timeline, criterion));
  evaluateRef.current = sampleEvaluator(base, timeline, criterion);

  const setTime = useCallback((t: number) => {
    timeRef.current = t;
    setCurrentTime(t);
  }, []);

  const setStatusBoth = useCallback((s: PlaybackStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  /** 由当前（最新的）布局 + 时间轴在 t 处派生的预览文档。 */
  const previewFor = useCallback((t: number): PreviewState => {
    const { base: b, timeline: tl } = liveRef.current;
    const frame = documentAt(b, tl, t);
    return { t: frame.t, doc: frame.doc, issues: frame.issues };
  }, []);

  const publishMonitor = useCallback(() => {
    const { timeWindow: w, step: s, totalSamples: expected } = liveRef.current;
    const summary: CoverageSummary = summarizeCoverage(
      coverageRef.current,
      w,
      s,
      expected,
    );
    setMonitor((m) => ({
      ...m,
      checked: summary.checked,
      total: expected,
      progress: expected ? Math.min(1, summary.checked / expected) : 0,
      failures: summary.failures,
      complete: summary.complete,
      last: summary.last,
      stale: m.stale && summary.checked === 0,
      contiguous: coverageRef.current.contiguous,
      // 时间轴刚被修改时，旧覆盖不再代表新动画：结论暂时作废。
      sustained: summary.sustained && !m.stale,
      firstFailure: summary.firstFailure,
    }));
  }, []);

  /**
   * 逐点补算 (游标, upTo] 内的全部网格采样点。
   * 掉帧只意味着这一次补算跨过更多点，绝不意味着跳过它们。
   */
  const catchUp = useCallback((upTo: number): number => {
    const { timeWindow: w, step: s } = liveRef.current;
    return advanceCoverage(
      coverageRef.current,
      w,
      s,
      upTo,
      evaluateRef.current,
    );
  }, []);

  const cancel = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const resetMonitor = useCallback((stale = false) => {
    coverageRef.current = createCoverage(liveRef.current.timeWindow);
    setMonitor({ ...emptyMonitor(liveRef.current.totalSamples), stale });
  }, []);

  const stop = useCallback(() => {
    cancel();
    setStatusBoth("idle");
    setTime(0);
    setPreview(null);
    resetMonitor();
    setDrops({ droppedVisual: 0, skippedPreview: 0, skippedExactSamples: 0 });
  }, [cancel, resetMonitor, setStatusBoth, setTime]);

  const pause = useCallback(() => {
    cancel();
    setStatusBoth("paused");
    setPreview(previewFor(timeRef.current));
    publishMonitor();
  }, [cancel, previewFor, publishMonitor, setStatusBoth]);

  const play = useCallback(
    (from?: number) => {
      cancel();
      const start = Math.max(
        0,
        Math.min(liveRef.current.total, from ?? timeRef.current),
      );
      // 回放或从窗口起点重新播放：从头建立连续覆盖。
      if (
        coverageRef.current.cursor >=
          liveRef.current.timeWindow.end - 0.5 ||
        start <= liveRef.current.timeWindow.start
      )
        resetMonitor();
      const origin = performance.now();
      startRef.current = origin;
      lastFrameRef.current = origin;
      lastTraceRef.current = 0;
      setTime(start);
      setStatusBoth("playing");
      setPreview(previewFor(start));
      setDrops({ droppedVisual: 0, skippedPreview: 0, skippedExactSamples: 0 });

      const tick = () => {
        const live = liveRef.current;
        const now = performance.now();
        const frameGap = now - lastFrameRef.current;
        lastFrameRef.current = now;
        const budget = 1000 / live.config.targetFps;
        if (frameGap > budget * 2)
          setDrops((d) => ({
            ...d,
            droppedVisual:
              d.droppedVisual + Math.max(1, Math.round(frameGap / budget) - 1),
          }));

        const { t, ended } = playbackTime(
          startRef.current,
          now,
          start,
          live.total,
        );

        if (catchUp(t) > 0) publishMonitor();

        /**
         * 严谨播放：时间窗内只显示采样网格点，绝不出现「看起来测了但没测」
         * 的中间时刻；窗口外仍显示真实推进的时间，避免播放头卡住。
         */
        let shown: number;
        if (
          live.precision === "exact" &&
          t >= live.timeWindow.start &&
          t <= live.timeWindow.end
        ) {
          shown = latestSampleAt(live.timeWindow, live.step, t);
        } else {
          shown = Math.round(t);
        }
        setTime(shown);

        const wantsTrace =
          live.precision === "exact" ||
          now - lastTraceRef.current >= live.config.traceIntervalMs;
        if (wantsTrace) {
          lastTraceRef.current = now;
          setPreview(previewFor(shown));
        } else {
          setDrops((d) => ({ ...d, skippedPreview: d.skippedPreview + 1 }));
        }

        if (ended) {
          catchUp(live.timeWindow.end);
          publishMonitor();
          setTime(live.total);
          setPreview(previewFor(live.total));
          setStatusBoth("paused");
          rafRef.current = null;
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [
      cancel,
      catchUp,
      previewFor,
      publishMonitor,
      resetMonitor,
      setStatusBoth,
      setTime,
    ],
  );

  /**
   * 定位时间。监测覆盖只从时间窗起点连续向前累积，因此跳到游标前方会
   * 产生空洞：此时重置监测并从目标点重新开始，绝不留下「看似完整」的
   * 结论。目标点之前的覆盖会被丢弃，界面通过 pending 状态表达。
   */
  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(liveRef.current.total, Math.round(t)));
      const { timeWindow: w, step: s } = liveRef.current;
      if (
        clamped !== coverageRef.current.cursor &&
        clamped !== coverageRef.current.cursor + s
      ) {
        // 跳转会跳过中间的采样点：覆盖必须重建，绝不留「看似完整」的结论。
        invalidateForSeek(coverageRef.current, w, s, clamped);
        setMonitor(emptyMonitor(liveRef.current.totalSamples));
      }
      setTime(clamped);
      setPreview(previewFor(clamped));
    },
    [previewFor, setTime],
  );

  /** 暂停中切换任务/撤销等导致布局变化：预览跟随新的布局重算。 */
  useEffect(() => {
    if (status !== "paused") return;
    setPreview(previewFor(timeRef.current));
    // 仅布局变化时同步，避免每次渲染都重新追迹。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const stepOnce = useCallback(
    (direction: 1 | -1) => {
      const live = liveRef.current;
      const next = stepSampleTime(
        live.timeWindow,
        live.step,
        timeRef.current,
        direction,
      );
      setTime(next);
      setPreview(previewFor(next));
      if (next !== coverageRef.current.cursor + live.step) {
        // 跨过网格点会形成空洞：标记覆盖不连续，结论不成立。
        coverageRef.current.contiguous = false;
      }
      if (next === coverageRef.current.cursor + live.step) {
        coverageRef.current.samples.set(
          next,
          evaluateRef.current(next),
        );
        coverageRef.current.cursor = next;
      }
      publishMonitor();
      return next;
    },
    [previewFor, publishMonitor, setTime],
  );

  /**
   * 布局或关键帧变化（包括播放中的编辑与撤销）：此前的监测结果已不代表
   * 新时间轴，必须整体作废。播放继续时 catchUp 会从时间窗起点重新逐点追迹
   * 到当前播放头，因此编辑后仍能得到可靠的「持续达标」结论。
   */
  const signature = JSON.stringify({ items: base.items, timeline });
  const signatureRef = useRef(signature);
  useEffect(() => {
    if (signatureRef.current === signature) return;
    signatureRef.current = signature;
    /*
     * 时间轴/布局变化：旧采样不代表新动画，立即清空而不是继续累积，
     * 避免把两个版本的采样混在一起。播放中由下一次 catchUp 从窗口起点
     * 逐点重建；暂停时在这里重建一次预览与监测。
     */
    resetMonitor(true);
    if (statusRef.current === "paused") {
      setPreview(previewFor(timeRef.current));
      const { timeWindow: w, step: s } = liveRef.current;
      advanceCoverage(
        coverageRef.current,
        w,
        s,
        timeRef.current,
        evaluateRef.current,
      );
      publishMonitor();
      // 暂停时重建的覆盖仍是连续且完整的，清除 stale 标记。
      setMonitor((m) => ({ ...m, stale: false }));
    }
  }, [signature, resetMonitor, previewFor, publishMonitor]);

  // 时间窗/步长变化：旧监测无效。
  useEffect(() => {
    resetMonitor();
  }, [resetMonitor, timeWindow.start, timeWindow.end, step]);

  useEffect(() => cancel, [cancel]);

  const ambiguityCount = useMemo(
    () => findAngleAmbiguities(timeline, base).length,
    [timeline, base],
  );

  return {
    status,
    currentTime,
    preview,
    monitor,
    total,
    totalSamples,
    ambiguityCount,
    hasKeys: timelineHasKeys(timeline),
    drops,
    precision,
    play,
    pause,
    stop,
    seek,
    step: stepOnce,
    isPlaying: status === "playing",
  };
}
