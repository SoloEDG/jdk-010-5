import { useEffect, useMemo, useRef, useState } from "react";
import type { LabDocument } from "../../../shared/document";
import type { MissionCriterion } from "../../missions/lib/evaluate";
import {
  sampleTimes,
  timelineHasKeys,
  type TimelineDocument,
  type Window,
} from "../../../shared/timeline";
import { sampleFrame } from "../lib/sampling";
import {
  validateWindow,
  type SampleResult,
  type WindowCheck,
} from "../lib/validation";

/** 采样点少于该值时同步完成，避免面板闪烁。 */
const SYNC_LIMIT = 600;
/** 每个动画帧最多追迹的采样点数（约 5–8ms 的工作量）。 */
const CHUNK = 120;

export interface ValidationInputs {
  doc: LabDocument;
  timeline: TimelineDocument;
  criterion: MissionCriterion;
  window: Window;
  step: number;
}

export interface WindowCheckState {
  check: WindowCheck;
  /** 结论仍在本轮输入上补算；此时的 complete 不可用于验收。 */
  pending: boolean;
  progress: number;
}

interface Completed {
  key: string;
  check: WindowCheck;
  progress: number;
}

function emptyCheck(
  timeline: TimelineDocument,
  window: Window,
  step: number,
): WindowCheck {
  return validateWindow({
    step,
    samples: [],
    window,
    hasTracks: timelineHasKeys(timeline),
    issueKinds: [],
  });
}

/**
 * 时间窗严谨校验。
 *
 * 统一走 sampleTimes → sampleFrame → validateWindow，因此与导出、播放监测
 * 完全同源。小窗口同步完成；大窗口按动画帧逐块计算，块间让出主线程，
 * 界面不卡顿且**不跳过任何采样点**。输入变化时旧任务立即取消，避免把
 * 上一次布局的结论当作当前结论。
 */
export function useWindowCheck(inputs: ValidationInputs): WindowCheckState {
  const { doc, timeline, criterion, window: timeWindow, step } = inputs;
  const [completed, setCompleted] = useState<Completed | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const key = useMemo(
    () =>
      JSON.stringify({
        d: doc.items,
        t: timeline,
        c: criterion,
        w: timeWindow,
        s: step,
      }),
    [doc.items, timeline, criterion, timeWindow, step],
  );

  useEffect(() => {
    cancelRef.current?.();
    let cancelled = false;
    const times = sampleTimes(timeWindow, step);
    const samples: SampleResult[] = [];
    const issueKinds = new Set<string>();
    let frame = 0;

    const publish = (progress: number) => {
      if (cancelled) return;
      setCompleted({
        key,
        progress,
        check: validateWindow({
          step,
          samples: samples.slice(),
          window: timeWindow,
          hasTracks: timelineHasKeys(timeline),
          issueKinds: [...issueKinds],
        }),
      });
    };

    const push = (t: number) => {
      const point = sampleFrame(doc, timeline, criterion, t);
      for (const issue of point.issues)
        issueKinds.add(issue.slice(0, issue.indexOf(":")));
      samples.push({
        t: point.t,
        ratio: point.ratio,
        rms: point.rms,
        received: point.received,
        emitted: point.emitted,
        complete: point.complete,
        issues: point.issues,
      });
    };

    if (times.length <= SYNC_LIMIT) {
      for (const t of times) push(t);
      publish(1);
      return () => {
        cancelled = true;
      };
    }

    let index = 0;
    const runChunk = () => {
      if (cancelled) return;
      const end = Math.min(times.length, index + CHUNK);
      for (; index < end; index++) push(times[index]);
      publish(index / times.length);
      if (index < times.length) frame = requestAnimationFrame(runChunk);
    };
    frame = requestAnimationFrame(runChunk);

    const cancel = () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
    cancelRef.current = cancel;
    return cancel;
  }, [doc, timeline, criterion, step, timeWindow, key]);

  const fresh = completed?.key === key;
  if (fresh && completed)
    return {
      check: completed.check,
      pending: completed.progress < 1,
      progress: completed.progress,
    };
  // 输入刚变化：先返回空结论并标记 pending，避免把上一布局的结论
  // 当成当前结论展示。
  return {
    check: emptyCheck(timeline, timeWindow, step),
    pending: true,
    progress: 0,
  };
}
