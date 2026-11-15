import { test } from "node:test";
import assert from "node:assert/strict";
import type { Element, LabDocument } from "../src/shared/document";
import type { TimelineDocument } from "../src/shared/timeline";
import {
  advanceCoverage,
  createCoverage,
  invalidateForSeek,
  sampleEvaluator,
  summarizeCoverage,
} from "../src/features/timeline/lib/monitor";

const item = (
  id: string,
  kind: Element["kind"],
  x: number,
  y: number,
  patch: Partial<Element> = {},
): Element => ({
  id,
  kind,
  x,
  y,
  angle: kind === "source" ? 0 : 90,
  size: 180,
  power: 1,
  rays: 9,
  spread: 0,
  wavelength: 550,
  focal: 180,
  index: 1.52,
  ...patch,
});

function scene(): { doc: LabDocument; timeline: TimelineDocument; criterion: { kind: "focus"; minRatio: number; maxRms: number } } {
  const doc: LabDocument = {
    version: 1,
    items: [
      item("src", "source", 140, 300, { size: 60 }),
      item("lens", "lens", 450, 300, { size: 240, focal: 120 }),
      item("screen", "screen", 630, 300, { size: 220 }),
    ],
  };
  // 1000–1050ms 短暂偏离焦点（30ms 窗口）。
  const timeline: TimelineDocument = {
    duration: 2000,
    tracks: {
      screen: {
        x: [
          { t: 0, value: 630 },
          { t: 1000, value: 630 },
          { t: 1030, value: 900 },
          { t: 1060, value: 630 },
          { t: 2000, value: 630 },
        ],
      },
    },
  };
  return { doc, timeline, criterion: { kind: "focus", minRatio: 0.5, maxRms: 30 } };
}

test("掉帧式大跨度补算仍逐点追迹，短暂失败不会被掩盖", () => {
  const { doc, timeline, criterion } = scene();
  const evaluate = sampleEvaluator(doc, timeline, criterion);
  const window = { start: 0, end: 2000 };
  const coverage = createCoverage(window);
  // 模拟一整秒没有刷新：一次补算跨过 45 个网格点，其中包含 30ms 的失败段。
  const added = advanceCoverage(coverage, window, 25, 1100, evaluate);
  assert.equal(added, 45);
  const summary = summarizeCoverage(coverage, window, 25, 81);
  assert.ok(summary.failures.length >= 1);
  // 失败从 1005 或 1010 附近开始，绝不会因为「一次补算」而被跳过。
  assert.ok(summary.firstFailure! >= 1000 && summary.firstFailure! <= 1025);
  assert.equal(summary.complete, false);
  assert.equal(summary.sustained, false);
});

test("覆盖完整且无失败才判定整窗持续达标", () => {
  const { doc, timeline, criterion } = scene();
  const evaluate = sampleEvaluator(doc, timeline, criterion);
  const window = { start: 0, end: 2000 };
  const clean: TimelineDocument = {
    duration: 2000,
    tracks: {
      screen: { x: [{ t: 0, value: 630 }, { t: 2000, value: 630 }] },
    },
  };
  const coverage = createCoverage(window);
  advanceCoverage(coverage, window, 25, 2000, sampleEvaluator(doc, clean, criterion));
  const summary = summarizeCoverage(coverage, window, 25, 81);
  assert.equal(summary.checked, 81);
  assert.equal(summary.failures.length, 0);
  assert.equal(summary.sustained, true);
  // 同一场景若中途失败，则不能持续达标。
  const failing = createCoverage(window);
  advanceCoverage(failing, window, 25, 2000, evaluate);
  assert.equal(summarizeCoverage(failing, window, 25, 81).sustained, false);
});

test("跳转导致空洞：重新累积而不是伪造完整结论", () => {
  const { doc, timeline, criterion } = scene();
  const evaluate = sampleEvaluator(doc, timeline, criterion);
  const window = { start: 0, end: 2000 };
  const coverage = createCoverage(window);
  advanceCoverage(coverage, window, 25, 2000, evaluate);
  assert.equal(summarizeCoverage(coverage, window, 25, 81).complete, true);
  invalidateForSeek(coverage, window, 25, 1500);
  assert.equal(coverage.cursor, 1475);
  const partial = summarizeCoverage(coverage, window, 25, 81);
  assert.equal(partial.checked, 0);
  assert.equal(partial.sustained, false);
  advanceCoverage(coverage, window, 25, 2000, evaluate);
  const resumed = summarizeCoverage(coverage, window, 25, 81);
  assert.equal(resumed.checked, 21);
  assert.equal(resumed.complete, false);
});
