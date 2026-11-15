import type { LabDocument, TraceResult } from "../../../shared/document";

export interface Metrics {
  /** 接收能量 / 光源总功率 */
  ratio: number;
  /** 光斑 RMS 半径（mm） */
  rms: number;
  received: number;
  emitted: number;
  centroid: number;
}

export type MissionCriterion =
  | { kind: "focus"; minRatio: number; maxRms: number }
  | { kind: "energy"; minRatio: number }
  | { kind: "prism-energy"; minRatio: number };

export function computeMetrics(
  doc: LabDocument,
  result: TraceResult,
): Metrics {
  const emitted = doc.items
    .filter((e) => e.kind === "source")
    .reduce((s, e) => s + e.power, 0);
  const hits = result.hits;
  const received = hits.reduce((s, h) => s + h.power, 0);
  const centroid = received
    ? hits.reduce((s, h) => s + h.position * h.power, 0) / received
    : 0;
  const rms = received
    ? Math.sqrt(
        hits.reduce((s, h) => s + (h.position - centroid) ** 2 * h.power, 0) /
          received,
      )
    : Infinity;
  return {
    ratio: emitted ? received / emitted : 0,
    rms,
    received,
    emitted,
    centroid,
  };
}

export function criterionMet(
  criterion: MissionCriterion,
  doc: LabDocument,
  metrics: Metrics,
): boolean {
  if (criterion.kind === "focus")
    return metrics.ratio >= criterion.minRatio && metrics.rms <= criterion.maxRms;
  if (criterion.kind === "prism-energy")
    return (
      metrics.ratio >= criterion.minRatio &&
      doc.items.some((e) => e.kind === "prism")
    );
  return metrics.ratio >= criterion.minRatio;
}

export function evaluationProgress(
  criterion: MissionCriterion,
  metrics: Metrics,
): number {
  const target =
    criterion.kind === "focus"
      ? Math.max(criterion.minRatio, 0.001)
      : criterion.minRatio;
  const energyPart = metrics.ratio / target;
  const focusPart =
    criterion.kind === "focus"
      ? (criterion.maxRms + 0.001) / Math.max(metrics.rms, 0.001)
      : 1;
  return Math.max(0, Math.min(1, Math.min(energyPart, focusPart)));
}
