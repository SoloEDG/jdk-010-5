import { test } from "node:test";
import assert from "node:assert/strict";
import type { Element, LabDocument } from "../src/shared/document";
import {
  angularDelta,
  documentAt,
  emptyTimeline,
  findAngleAmbiguities,
  interpolateFocal,
  moveKey,
  removeDeviceTracks,
  removeKey,
  sampleTimes,
  sampleTimesBetween,
  upsertKey,
  withAngleDirection,
  type TimelineDocument,
} from "../src/shared/timeline";
import { trace } from "../src/features/optics/lib/trace";
import { computeMetrics, criterionMet } from "../src/features/missions/lib/evaluate";
import { validateRange } from "../src/features/timeline/lib/sampling";
import { sampleFrame } from "../src/features/timeline/lib/sampling";
import { toCsv, validateWindow } from "../src/features/timeline/lib/validation";

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

function focusDoc(): LabDocument {
  return {
    version: 1,
    items: [
      item("src", "source", 140, 300, { size: 60 }),
      item("lens", "lens", 450, 300, { size: 240, focal: 120 }),
      item("screen", "screen", 570, 300, { size: 220 }),
    ],
    timeline: { ...emptyTimeline },
  };
}

test("采样时间定义：闭区间、网格间隔，终点必被包含", () => {
  assert.deepEqual(sampleTimes({ start: 2000, end: 6000 }, 100), [
    2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900, 3000, 3100,
    3200, 3300, 3400, 3500, 3600, 3700, 3800, 3900, 4000, 4100, 4200, 4300,
    4400, 4500, 4600, 4700, 4800, 4900, 5000, 5100, 5200, 5300, 5400, 5500,
    5600, 5700, 5800, 5900, 6000,
  ]);
  // 非网格终点：追加 end，不产生浮点时间。
  assert.deepEqual(sampleTimes({ start: 2010, end: 2050 }, 100), [2010, 2050]);
  assert.deepEqual(sampleTimes({ start: 0, end: 25 }, 25), [0, 25]);
  // 标量与导出共用同一函数：导出的 t 就是这里的时间。
  assert.equal(sampleTimes({ start: 1500, end: 6500 }, 25).every(Number.isInteger), true);
});

test("监测与严谨校验共用同一网格：逐点补算不会漏掉短暂失败", () => {
  const window = { start: 2000, end: 6500 };
  const step = 25;
  assert.deepEqual(sampleTimesBetween(window, step, 1999, 2100), [2000, 2025, 2050, 2075, 2100]);
  // 从任意游标出发，多次分段补算拼起来与一次性采样完全一致。
  const all: number[] = [];
  let cursor = window.start - 1;
  for (const horizon of [2100, 2600, 2601, 4000, 6500]) {
    const chunk = sampleTimesBetween(window, step, cursor, horizon);
    all.push(...chunk);
    if (chunk.length) cursor = chunk[chunk.length - 1];
  }
  assert.deepEqual(all, sampleTimes(window, step));
});

test("角度跨越 ±180°：未选方向返回歧义；选择后给出连续转角", () => {
  const a = angularDelta(-170, 170, undefined);
  assert.equal(a.ambiguous, true);
  assert.equal(a.delta, -20); // 最短路径
  const ccw = angularDelta(-170, 170, "ccw");
  assert.equal(ccw.ambiguous, false);
  assert.equal(ccw.delta, 340);
  const cw = angularDelta(-170, 170, "cw");
  assert.equal(cw.ambiguous, false);
  assert.equal(cw.delta, -20);
  // 非接缝区间不应要求选择。
  assert.equal(angularDelta(10, 40, undefined).ambiguous, false);
});

test("角度插值跨接缝：未确认时报告 issue，确认后按所选方向连续旋转", () => {
  const doc = focusDoc();
  let timeline: TimelineDocument = {
    duration: 4000,
    tracks: {
      lens: {
        angle: [
          { t: 0, value: -170 },
          { t: 1000, value: 170 },
        ],
      },
    },
  };
  const unresolved = documentAt(doc, timeline, 500);
  assert.equal(unresolved.issues.some((i) => i.kind === "angle-direction"), true);
  const ambiguities = findAngleAmbiguities(timeline, doc);
  assert.equal(ambiguities.length, 1);

  timeline = withAngleDirection(
    timeline,
    ambiguities[0].channel,
    ambiguities[0].fromT,
    "ccw",
  );
  assert.equal(findAngleAmbiguities(timeline, doc).length, 0);
  const mid = documentAt(doc, timeline, 500);
  assert.equal(mid.issues.length, 0);
  // -170 + 340*0.5 = 0
  assert.ok(Math.abs(mid.doc.items[1].angle) < 1e-9);
  // 顺时针：-170 - 20*0.5 = -180
  const cwTimeline = withAngleDirection(
    { ...timeline, tracks: { lens: { angle: [{ t: 0, value: -170 }, { t: 1000, value: 170 }] } } },
    "lens:angle",
    0,
    "cw",
  );
  const cwMid = documentAt(doc, cwTimeline, 500);
  assert.ok(Math.abs(cwMid.doc.items[1].angle - -180) < 1e-9);
});

test("焦距插值经过 0：钳制到 ±1mm 并报告，不产生 NaN 或无限焦距", () => {
  // f=0.495 → raw=1（合法）；f=0.5 → raw=0，钳制到插值方向一侧。
  const r1 = interpolateFocal(100, -100, 0.5005);
  assert.equal(Math.abs(r1.value), 1);
  assert.equal(r1.issue, "focal-zero");
  const r2 = interpolateFocal(100, -100, 0.4995);
  assert.equal(Math.abs(r2.value), 1);
  assert.equal(r2.issue, "focal-zero");
  // 未跨零点时保持精确插值。
  const r3 = interpolateFocal(100, 200, 0.5);
  assert.equal(r3.value, 150);
  assert.equal(r3.issue, null);

  const doc = focusDoc();
  const timeline: TimelineDocument = {
    duration: 2000,
    tracks: { lens: { focal: [{ t: 0, value: 100 }, { t: 1000, value: -100 }] } },
  };
  const frame = documentAt(doc, timeline, 500);
  assert.equal(Math.abs(frame.doc.items[1].focal), 1);
  assert.equal(frame.issues.some((i) => i.kind === "focal-zero"), true);
  assert.ok(Number.isFinite(frame.doc.items[1].focal));
  // 追迹仍然可以完成。
  assert.ok(trace(frame.doc).segments.length > 0);
});

test("关键帧只作用于存在的器件；删除器件同时移除轨道", () => {
  const doc = focusDoc();
  const timeline: TimelineDocument = {
    duration: 1000,
    tracks: {
      lens: { x: [{ t: 0, value: 400 }, { t: 1000, value: 500 }] },
      ghost: { x: [{ t: 0, value: 10 }] },
    },
  };
  const frame = documentAt(doc, timeline, 500);
  assert.equal(frame.doc.items.find((e) => e.id === "lens")!.x, 450);
  assert.equal(
    frame.issues.some((i) => i.kind === "removed-device"),
    true,
  );
  assert.equal(frame.doc.items.length, doc.items.length);
  const removed = removeDeviceTracks(timeline, "lens");
  assert.equal(removed.removed, 2);
  assert.equal(removed.timeline.tracks.lens, undefined);
});

test("关键帧增删移：同一时间覆盖而非重复；拖动冲突不丢失数据", () => {
  let tl = upsertKey(emptyTimeline, "lens", "x", 1000, 400);
  tl = upsertKey(tl, "lens", "x", 1000.4, 420); // 量化到 1000ms，覆盖
  assert.equal(tl.tracks.lens!.x!.length, 1);
  assert.equal(tl.tracks.lens!.x![0].value, 420);
  tl = upsertKey(tl, "lens", "x", 2000, 500);
  tl = moveKey(tl, "lens", "x", 1000, 2000); // 目标已占用
  assert.equal(tl.tracks.lens!.x!.length, 2);
  assert.deepEqual(
    tl.tracks.lens!.x!.map((k) => k.t),
    [1000, 2000],
  );
  tl = removeKey(tl, "lens", "x", 2000);
  assert.equal(tl.tracks.lens!.x!.length, 1);
  tl = removeKey(tl, "lens", "x", 1000);
  assert.equal(tl.tracks.lens, undefined);
});

test("播放采样与严谨校验共用时间定义：短暂失败不被跳过", () => {
  const doc = focusDoc();
  // 屏幕在 1000-1100ms 间短暂移开，只失败约 100ms。
  const timeline: TimelineDocument = {
    duration: 4000,
    tracks: {
      screen: {
        x: [
          { t: 0, value: 570 },
          { t: 1000, value: 570 },
          { t: 1050, value: 950 },
          { t: 1100, value: 570 },
          { t: 4000, value: 570 },
        ],
      },
    },
  };
  const criterion = { kind: "focus" as const, minRatio: 0.5, maxRms: 30 };
  const check = validateRange(doc, timeline, criterion, { start: 0, end: 3000 }, 25);
  assert.equal(check.complete, false);
  assert.ok(check.failures.length >= 1);
  // 失败区间必须落在短暂干扰内。
  const failStart = check.firstFailure!;
  assert.ok(failStart >= 1000 && failStart <= 1100);

  // 每个采样点都来自 sampleTimes；导出的行数与采样点数一致。
  assert.deepEqual(
    check.sampleTimes,
    sampleTimes({ start: 0, end: 3000 }, 25),
  );
  const csv = toCsv(check, {
    duration: timeline.duration,
    missionId: "focus",
    missionName: "寻找焦点",
    criterion: "test",
    timeline,
    labels: {},
  });
  const rows = csv
    .split("\n")
    .filter((l) => /^\d/.test(l))
    .map((l) => Number(l.split(",")[0]));
  assert.deepEqual(rows, check.sampleTimes);
});

test("窄失败即使落在两次预览重算之间也会被监测到", () => {
  const doc = focusDoc();
  const criterion = { kind: "focus" as const, minRatio: 0.5, maxRms: 30 };
  const timeline: TimelineDocument = {
    duration: 2000,
    tracks: {
      screen: {
        x: [
          { t: 0, value: 570 },
          { t: 480, value: 570 },
          { t: 500, value: 950 },
          { t: 520, value: 570 },
          { t: 2000, value: 570 },
        ],
      },
    },
  };
  // 模拟「掉帧时一次补算跨过 20ms 窗口」：逐点采样仍能捕获。
  const times = sampleTimes({ start: 480, end: 560 }, 5);
  const results = times.map((t) => sampleFrame(doc, timeline, criterion, t));
  assert.ok(results.some((r) => !r.complete));
  // 而只采样两个端点会漏掉它——这正是必须逐点补算的原因。
  const endpoints = [480, 560].map((t) => sampleFrame(doc, timeline, criterion, t));
  assert.ok(endpoints.every((r) => r.complete));
});

test("时间窗持续达标需要整窗所有采样点都通过", () => {
  const doc = focusDoc();
  const criterion = { kind: "focus" as const, minRatio: 0.5, maxRms: 30 };
  const pass = validateRange(doc, { ...emptyTimeline }, criterion, { start: 0, end: 2000 }, 25);
  assert.equal(pass.complete, true);
  assert.equal(pass.failures.length, 0);

  const failTimeline: TimelineDocument = {
    duration: 2000,
    tracks: {
      screen: {
        x: [
          { t: 0, value: 570 },
          { t: 900, value: 570 },
          { t: 950, value: 950 },
          { t: 1100, value: 570 },
          { t: 2000, value: 570 },
        ],
      },
    },
  };
  const fail = validateRange(doc, failTimeline, criterion, { start: 0, end: 2000 }, 25);
  assert.equal(fail.complete, false);
  assert.ok(fail.failures[0].start >= 900 && fail.failures[0].start <= 1100);
  // 失败区间必须收敛在干扰段内，不能污染整窗。
  assert.ok(fail.failures[0].end <= 1200);
});

test("预览文档是派生值：原始布局不被写回", () => {
  const doc = focusDoc();
  const snapshot = JSON.stringify(doc);
  const timeline: TimelineDocument = {
    duration: 1000,
    tracks: { lens: { x: [{ t: 0, value: 200 }, { t: 1000, value: 800 }] } },
  };
  const frame = documentAt(doc, timeline, 500);
  assert.equal(frame.doc.items[1].x, 500);
  assert.equal(JSON.stringify(doc), snapshot);
  assert.equal(doc.timeline!.tracks.lens, undefined);
});

test("未设关键帧的参数沿用布局值；窗口外也保持端点值", () => {
  const doc = focusDoc();
  const timeline: TimelineDocument = {
    duration: 5000,
    tracks: { lens: { x: [{ t: 1000, value: 300 }, { t: 2000, value: 700 }] } },
  };
  assert.equal(documentAt(doc, timeline, 0).doc.items[1].x, 300);
  assert.equal(documentAt(doc, timeline, 5000).doc.items[1].x, 700);
  assert.equal(documentAt(doc, timeline, 1500).doc.items[1].y, 300);
  assert.equal(documentAt(doc, timeline, 1500).doc.items[1].focal, 120);
});

test("指标与判定：能量比与 RMS 均由真实追迹结果计算", () => {
  const doc = focusDoc();
  const result = trace(doc);
  const metrics = computeMetrics(doc, result);
  assert.ok(metrics.ratio > 0);
  assert.ok(Number.isFinite(metrics.rms));
  assert.equal(
    criterionMet({ kind: "energy", minRatio: 0.1 }, doc, metrics),
    true,
  );
  assert.equal(
    criterionMet({ kind: "energy", minRatio: 1.5 }, doc, metrics),
    false,
  );
});

test("校验摘要：空采样不会误判为达标", () => {
  const empty = validateWindow({
    step: 25,
    samples: [],
    window: { start: 1000, end: 1000 },
    hasTracks: false,
    issueKinds: [],
  });
  assert.equal(empty.complete, false);
  assert.ok(empty.notes.some((n) => n.code === "window-empty"));
});
