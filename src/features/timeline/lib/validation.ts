export type ValidationLevel = "strike" | "warn";

export interface ValidationNote {
  level: ValidationLevel;
  code:
    | "window-empty"
    | "window-short"
    | "no-tracks"
    | "angle-unresolved"
    | "focal-zero"
    | "removed-device"
    | "never-met"
    | "gaps";
  text: string;
}

export interface SampleResult {
  t: number;
  ratio: number;
  rms: number;
  received: number;
  emitted: number;
  complete: boolean;
  /** 该采样点的插值提示（焦距钳制、方向未确认等）。 */
  issues: string[];
}

export interface Range {
  start: number;
  end: number;
}

export interface WindowCheck {
  window: Range;
  step: number;
  samples: SampleResult[];
  sampleTimes: number[];
  complete: boolean;
  /** 连续达标的闭区间；严谨性要求该区间覆盖整个时间窗。 */
  passes: Range[];
  failures: Range[];
  firstPass: number | null;
  firstFailure: number | null;
  /** 窗口内最差指标，用于显示「持续达标」的门槛余量。 */
  worst: { ratio: number; rms: number };
  notes: ValidationNote[];
}

/**
 * 把逐点结果折叠为连续区间。注意区间边界使用相邻采样点的时间，
 * 这样 pass/fail 的时间轴分布严格来自采样定义本身。
 */
export function summarizeRuns(
  samples: SampleResult[],
  window: Range,
): { passes: Range[]; failures: Range[] } {
  const passes: Range[] = [];
  const failures: Range[] = [];
  if (!samples.length) return { passes, failures };
  let runStart = samples[0].t;
  let runOk = samples[0].complete;
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    if (s.complete === runOk) continue;
    (runOk ? passes : failures).push({ start: runStart, end: s.t });
    runStart = s.t;
    runOk = s.complete;
  }
  (runOk ? passes : failures).push({
    start: runStart,
    end: window.end,
  });
  return { passes, failures };
}

export function validateWindow(input: {
  step: number;
  samples: SampleResult[];
  window: Range;
  hasTracks: boolean;
  issueKinds: string[];
}): WindowCheck {
  const { samples, window, step } = input;
  const { passes, failures } = summarizeRuns(samples, window);
  const notes: ValidationNote[] = [];
  if (!input.hasTracks)
    notes.push({
      level: "warn",
      code: "no-tracks",
      text: "时间轴没有关键帧，播放的是静态布局",
    });
  if (window.end - window.start < step)
    notes.push({
      level: "warn",
      code: "window-short",
      text: "时间窗短于采样步长，采样仅含端点",
    });
  if (input.issueKinds.includes("angle-direction"))
    notes.push({
      level: "strike",
      code: "angle-unresolved",
      text: "存在未确认旋转方向的角度关键帧，严谨校验不通过",
    });
  if (input.issueKinds.includes("focal-zero"))
    notes.push({
      level: "warn",
      code: "focal-zero",
      text: "焦距插值经过 0，已钳制到 ±1 mm 并在采样中标记",
    });
  if (input.issueKinds.includes("removed-device"))
    notes.push({
      level: "warn",
      code: "removed-device",
      text: "存在指向已删除器件的轨道，轨道保留但不生效",
    });
  const failed = samples.filter((s) => !s.complete);
  if (!samples.length)
    notes.push({
      level: "strike",
      code: "window-empty",
      text: "时间窗内没有采样点",
    });
  else if (failed.length)
    notes.push({
      level: "strike",
      code: "gaps",
      text: `${failed.length} / ${samples.length} 个采样点未达标，共 ${failures.length} 段失败`,
    });
  const complete =
    samples.length > 0 &&
    failed.length === 0 &&
    !notes.some((n) => n.level === "strike");
  return {
    window,
    step,
    samples,
    sampleTimes: samples.map((s) => s.t),
    complete,
    passes,
    failures,
    firstPass: passes[0]?.start ?? null,
    firstFailure: failed[0]?.t ?? null,
    worst: {
      ratio: samples.length ? Math.min(...samples.map((s) => s.ratio)) : 0,
      rms: samples.length
        ? Math.max(...samples.map((s) => (Number.isFinite(s.rms) ? s.rms : Infinity)))
        : Infinity,
    },
    notes,
  };
}

export type CsvMode = "samples" | "keyframes" | "both";

export interface CsvMeta {
  duration: number;
  missionId: string;
  missionName: string;
  criterion: string;
  timeline: {
    tracks: Record<string, Record<string, { t: number; value: number; direction?: string }[]>>;
  };
  labels: Record<string, string>;
}

function csvCell(v: string | number): string {
  return typeof v === "number" ? String(v) : `"${v.replaceAll('"', '""')}"`;
}

/** HTML 公式注入防护：以 = + - @ 开头的文本加前导单引号。 */
function safeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

/**
 * 导出。样本表的行就是 WindowCheck.samples，因此导出的 t 序列与
 * 逐帧测量使用的时间定义完全一致。
 */
export function toCsv(check: WindowCheck, meta: CsvMeta, mode: CsvMode = "samples"): string {
  const lines: string[] = [];
  lines.push("# LUMEN 时间轴导出");
  lines.push(
    `# mission=${meta.missionId} (${meta.missionName}) criterion=${meta.criterion}`,
  );
  lines.push(`# duration_ms=${meta.duration}`);
  lines.push(`# window=[${check.window.start},${check.window.end}] step_ms=${check.step}`);
  lines.push(
    "# sampling: t_k = start + k*step (k=0..n-1), plus t=end if end is off-grid",
  );
  lines.push(`# sample_count=${check.samples.length}`);
  if (mode !== "samples") {
    lines.push("");
    lines.push("kind,device_id,device_label,channel,t_ms,value,extra");
    for (const [id, track] of Object.entries(meta.timeline.tracks)) {
      for (const [channel, keys] of Object.entries(track)) {
        for (const k of keys)
          lines.push(
            [
              "keyframe",
              csvCell(safeCell(id)),
              csvCell(safeCell(meta.labels[id] ?? id)),
              csvCell(safeCell(channel)),
              k.t,
              k.value,
              k.direction ? csvCell(`direction=${k.direction}`) : "",
            ].join(","),
          );
      }
    }
  }
  if (mode !== "keyframes") {
    lines.push("");
    lines.push("t_ms,received_W,emitted_W,ratio,rms_mm,complete,issues");
    for (const s of check.samples)
      lines.push(
        [
          s.t,
          s.received.toFixed(6),
          s.emitted.toFixed(6),
          s.ratio.toFixed(6),
          Number.isFinite(s.rms) ? s.rms.toFixed(6) : "",
          s.complete ? 1 : 0,
          csvCell(s.issues.join("|")),
        ].join(","),
      );
  }
  return lines.join("\n") + "\n";
}
