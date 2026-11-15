import type { LabDocument } from "../../../shared/document";
import {
  computeMetrics,
  criterionMet,
  type MissionCriterion,
} from "../../missions/lib/evaluate";
import { trace } from "../../optics/lib/trace";
import {
  documentAt,
  sampleTimes,
  timelineHasKeys,
  type TimelineDocument,
  type Window,
} from "../../../shared/timeline";
import {
  validateWindow,
  type SampleResult,
  type WindowCheck,
} from "./validation";

export interface SampledPoint {
  t: number;
  doc: LabDocument;
  received: number;
  emitted: number;
  ratio: number;
  rms: number;
  complete: boolean;
  issues: string[];
}

export function sampleFrame(
  base: LabDocument,
  timeline: TimelineDocument,
  criterion: MissionCriterion,
  t: number,
): SampledPoint {
  const frame = documentAt(base, timeline, t);
  const result = trace(frame.doc);
  const metrics = computeMetrics(frame.doc, result);
  return {
    t: frame.t,
    doc: frame.doc,
    received: metrics.received,
    emitted: metrics.emitted,
    ratio: metrics.ratio,
    rms: metrics.rms,
    complete: criterionMet(criterion, frame.doc, metrics),
    issues: frame.issues.map((i) => `${i.kind}:${i.message}`),
  };
}

export function toSampleResult(point: SampledPoint): SampleResult {
  return {
    t: point.t,
    ratio: point.ratio,
    rms: point.rms,
    received: point.received,
    emitted: point.emitted,
    complete: point.complete,
    issues: point.issues,
  };
}

/** 某个采样步长下，整个时间窗的严谨校验。 */
export function validateRange(
  base: LabDocument,
  timeline: TimelineDocument,
  criterion: MissionCriterion,
  window: Window,
  step: number,
): WindowCheck {
  const times = sampleTimes(window, step);
  const samples: SampleResult[] = [];
  const issueKinds = new Set<string>();
  for (const t of times) {
    const point = sampleFrame(base, timeline, criterion, t);
    for (const issue of point.issues)
      issueKinds.add(issue.slice(0, issue.indexOf(":")));
    samples.push(toSampleResult(point));
  }
  return validateWindow({
    step: Math.max(1, Math.round(step)),
    samples,
    window,
    hasTracks: timelineHasKeys(timeline),
    issueKinds: [...issueKinds],
  });
}

/** 任务要求的时间窗内持续达标：先以任务步长严格采样，再检查每一段。 */
export function windowSustained(check: WindowCheck): boolean {
  return (
    check.complete &&
    check.failures.length === 0 &&
    Math.abs(check.window.end - check.window.start) > 0
  );
}
