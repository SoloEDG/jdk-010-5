import type { Element, Kind, LabDocument } from "./document";

/**
 * 可被时间轴驱动的器件参数。键与 Element 字段一一对应，避免预览层与布局层
 * 使用两套命名。
 */
export type AnimatableKey = "x" | "y" | "angle" | "focal" | "power";

export const ANIMATABLE: Record<
  Kind,
  { key: AnimatableKey; label: string; unit: string }[]
> = {
  source: [
    { key: "x", label: "X 位置", unit: "mm" },
    { key: "y", label: "Y 位置", unit: "mm" },
    { key: "angle", label: "光源角度", unit: "°" },
    { key: "power", label: "光源功率", unit: "W" },
  ],
  mirror: [
    { key: "x", label: "X 位置", unit: "mm" },
    { key: "y", label: "Y 位置", unit: "mm" },
    { key: "angle", label: "旋转角度", unit: "°" },
  ],
  lens: [
    { key: "x", label: "X 位置", unit: "mm" },
    { key: "y", label: "Y 位置", unit: "mm" },
    { key: "angle", label: "旋转角度", unit: "°" },
    { key: "focal", label: "焦距", unit: "mm" },
  ],
  prism: [
    { key: "x", label: "X 位置", unit: "mm" },
    { key: "y", label: "Y 位置", unit: "mm" },
    { key: "angle", label: "旋转角度", unit: "°" },
  ],
  screen: [
    { key: "x", label: "X 位置", unit: "mm" },
    { key: "y", label: "Y 位置", unit: "mm" },
    { key: "angle", label: "旋转角度", unit: "°" },
  ],
};

export function keyLabel(key: AnimatableKey): string {
  switch (key) {
    case "x":
      return "X 位置";
    case "y":
      return "Y 位置";
    case "angle":
      return "旋转角度";
    case "focal":
      return "焦距";
    case "power":
      return "光源功率";
  }
}

export function keyUnit(key: AnimatableKey): string {
  if (key === "angle") return "°";
  if (key === "power") return "W";
  return "mm";
}

export type RotationDirection = "shortest" | "cw" | "ccw";

export interface Keyframe {
  /** 绝对时间，整数毫秒。所有播放、测量与导出共用这一时间定义。 */
  t: number;
  value: number;
  /**
   * 仅角度使用：从本关键帧走向下一关键帧时的旋转方向。
   * 缺省表示最短路径；跨越 ±180° 的区间必须显式确认。
   */
  direction?: RotationDirection;
}

export type Track = Partial<Record<AnimatableKey, Keyframe[]>>;
export type TrackMap = Record<string, Track>;

export type ChannelId = `${string}:${AnimatableKey}`;

export function channelId(id: string, key: AnimatableKey): ChannelId {
  return `${id}:${key}`;
}

export function splitChannel(channel: ChannelId): [string, AnimatableKey] {
  const at = channel.lastIndexOf(":");
  return [channel.slice(0, at), channel.slice(at + 1) as AnimatableKey];
}

export interface TimelineDocument {
  /** 总时长（毫秒）。 */
  duration: number;
  tracks: TrackMap;
}

export const emptyTimeline: TimelineDocument = { duration: 8000, tracks: {} };

export const MIN_DURATION = 1000;
export const MAX_DURATION = 120000;
export const MAX_KEYFRAMES_PER_TRACK = 200;
export const MIN_FOCAL = 1;

export function timelineHasKeys(timeline: TimelineDocument): boolean {
  return Object.values(timeline.tracks).some((track) =>
    Object.values(track).some((keys) => keys && keys.length > 0),
  );
}

/** 时间量化：所有播放、逐帧测量、导出共用的唯一定义。 */
export function quantizeTime(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.round(t);
}

/** 仅用于拖动交互的网格吸附，绝不用于判定或导出。 */
export function snapTime(t: number, step = 50): number {
  return Math.max(0, Math.round(t / step) * step);
}

export function sortedKeys<T extends { t: number }>(keys: T[]): T[] {
  return [...keys].sort((a, b) => a.t - b.t);
}

/** 时间窗闭区间，单位毫秒。 */
export interface Window {
  start: number;
  end: number;
}

export function clampWindow(w: Window, duration: number): Window {
  const start = Math.max(0, Math.min(duration, Math.round(w.start)));
  const end = Math.max(start, Math.min(duration, Math.round(w.end)));
  return { start, end };
}

/**
 * 采样时间定义 —— 逐帧测量、严谨校验、导出的时间序列、严谨播放全部调用
 * 这一个函数。返回闭区间 [start, end] 内步长 step 毫秒的全部整数毫秒
 * 时间点；若 end 不在网格上，则追加 end，保证终点被测量。
 */
export function sampleTimes(window: Window, step: number): number[] {
  const start = quantizeTime(window.start);
  const end = quantizeTime(window.end);
  const dt = Math.max(1, Math.round(step));
  if (end < start) return [];
  const out: number[] = [];
  for (let t = start; t < end; t += dt) out.push(t);
  out.push(end);
  return out;
}

export function sampleCount(window: Window, step: number): number {
  return sampleTimes(window, step).length;
}

/**
 * 网格上严格晚于 cursor 的下一个采样时间。从 window.start - 1 开始反复调用，
 * 得到的序列与 sampleTimes(window, step) 完全一致 —— 播放监测用它逐点
 * 补算，绝不因为掉帧而跳过任何点。
 */
export function nextSampleTime(
  cursor: number,
  window: Window,
  step: number,
): number | null {
  const start = quantizeTime(window.start);
  const end = quantizeTime(window.end);
  const dt = Math.max(1, Math.round(step));
  if (cursor >= end) return null;
  if (cursor < start) return start;
  const next = cursor + dt;
  return next >= end ? end : next;
}

/** (after, upTo] 内的全部采样网格点，与 sampleTimes 同一定义。 */
export function sampleTimesBetween(
  window: Window,
  step: number,
  after: number,
  upTo: number,
): number[] {
  const out: number[] = [];
  let cursor = after;
  for (;;) {
    const next = nextSampleTime(cursor, window, step);
    if (next === null || next > upTo) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

export function stepSampleTime(
  window: Window,
  step: number,
  current: number,
  direction: 1 | -1,
): number {
  const times = sampleTimes(window, step);
  if (!times.length) return quantizeTime(current);
  if (direction === 1)
    return times.find((t) => t > current) ?? times[times.length - 1];
  const before = times.filter((t) => t < current);
  return before.length ? before[before.length - 1] : times[0];
}

export interface InterpolationIssue {
  channel: ChannelId;
  t: number;
  kind: "focal-zero" | "removed-device" | "angle-direction";
  message: string;
}

function normalizeAngle(v: number): number {
  return ((((v + 180) % 360) + 360) % 360) - 180;
}

/** 判断一对角度是否落在 ±180° 接缝两侧。 */
export function crossesSeam(from: number, to: number): boolean {
  const a = normalizeAngle(from);
  const b = normalizeAngle(to);
  return (
    Math.abs(a) > 150 && Math.abs(b) > 150 && Math.sign(a) !== Math.sign(b)
  );
}

/**
 * 角度差值。跨接缝且未选择方向时返回 ambiguous，调用方采用最短路径并
 * 明确报告，不会悄悄翻转。
 */
export function angularDelta(
  from: number,
  to: number,
  direction: RotationDirection | undefined,
): { delta: number; ambiguous: boolean } {
  const a = normalizeAngle(from);
  const b = normalizeAngle(to);
  let shortest = b - a;
  if (shortest > 180) shortest -= 360;
  if (shortest < -180) shortest += 360;
  if (!crossesSeam(a, b)) return { delta: shortest, ambiguous: false };
  if (!direction || direction === "shortest")
    return { delta: shortest, ambiguous: true };
  let delta = b - a; // (-360, 360)
  if (direction === "ccw") {
    if (delta <= 0) delta += 360;
  } else if (delta >= 0) delta -= 360;
  return { delta, ambiguous: false };
}

export function interpolateAngle(
  from: number,
  to: number,
  f: number,
  direction: RotationDirection | undefined,
): number {
  const { delta } = angularDelta(from, to, direction);
  return normalizeAngle(from + delta * f);
}

/**
 * 焦距插值。焦距 0 在薄透镜模型中退化，不能参与追迹：
 *  - |f| < 1mm 的结果钳制到 ±1mm，符号取插值方向一侧；
 *  - 不产生 NaN、不跳过时间点；
 *  - 每个被钳制的采样点都会在 issue 中报告。
 */
export function interpolateFocal(
  from: number,
  to: number,
  f: number,
): { value: number; issue: "focal-zero" | null } {
  const raw = from + (to - from) * f;
  if (Math.abs(raw) >= MIN_FOCAL) return { value: raw, issue: null };
  const sign =
    raw !== 0 ? Math.sign(raw) : Math.sign(to - from) || Math.sign(from) || 1;
  return { value: sign * MIN_FOCAL, issue: "focal-zero" };
}

export interface SampledFrame {
  t: number;
  doc: LabDocument;
  issues: InterpolationIssue[];
}

/**
 * 将时间轴应用到布局，返回**派生**预览文档。调用方绝不能把它写回布局；
 * 布局只由编辑操作或撤销/重做改变。
 *
 * - 未设关键帧的参数沿用布局值；
 * - 关键帧按器件 id 作用，已删除器件的轨道保留但不生效；
 * - 每个采样点的插值提示都随结果返回。
 */
export function documentAt(
  base: LabDocument,
  timeline: TimelineDocument,
  t: number,
): SampledFrame {
  const time = quantizeTime(t);
  const byId = new Set(base.items.map((e) => e.id));
  const issues: InterpolationIssue[] = [];
  const items = base.items.map((item) => {
    const track = timeline.tracks[item.id];
    if (!track) return item;
    const next: Element = { ...item };
    for (const key of Object.keys(track) as AnimatableKey[]) {
      const keys = track[key];
      if (!keys?.length) continue;
      const result = interpolateChannel(key, keys, time);
      if (result.value === null) continue;
      if (result.issue === "focal-zero")
        issues.push({
          channel: channelId(item.id, key),
          t: time,
          kind: "focal-zero",
          message: `焦距插值接近 0（${time} ms），按最近合法焦距 ±1 mm 处理`,
        });
      if (result.issue === "angle-direction")
        issues.push({
          channel: channelId(item.id, key),
          t: time,
          kind: "angle-direction",
          message: `角度跨越 ±180°（${time} ms）且未确认旋转方向，暂按最短路径`,
        });
      (next as unknown as Record<string, number>)[key] = result.value;
    }
    return next;
  });
  for (const [id, track] of Object.entries(timeline.tracks)) {
    if (byId.has(id)) continue;
    if (!track || !Object.values(track).some((k) => k && k.length)) continue;
    issues.push({
      channel: `${id}:x`,
      t: time,
      kind: "removed-device",
      message: "时间轴轨道引用的器件已不存在，该轨道不会生效",
    });
  }
  return { t: time, doc: { ...base, items }, issues: dedupeIssues(issues) };
}

function dedupeIssues(issues: InterpolationIssue[]): InterpolationIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = i.kind + i.channel;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type ChannelResult = {
  value: number | null;
  issue: InterpolationIssue["kind"] | null;
};

function interpolateChannel(
  key: AnimatableKey,
  keys: Keyframe[],
  t: number,
): ChannelResult {
  const sorted = sortedKeys(keys);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (t <= first.t) return endpoint(key, first.value);
  if (t >= last.t) return endpoint(key, last.value);
  let i = 0;
  while (i + 1 < sorted.length && sorted[i + 1].t <= t) i++;
  const a = sorted[i];
  const b = sorted[i + 1];
  const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
  if (key === "angle") {
    const direction = a.direction ?? b.direction;
    const { delta, ambiguous } = angularDelta(a.value, b.value, direction);
    return {
      value: normalizeAngle(a.value + delta * f),
      issue: ambiguous ? "angle-direction" : null,
    };
  }
  if (key === "focal") {
    const r = interpolateFocal(a.value, b.value, f);
    return { value: r.value, issue: r.issue };
  }
  return { value: a.value + (b.value - a.value) * f, issue: null };
}

function endpoint(key: AnimatableKey, value: number): ChannelResult {
  if (key === "focal" && Math.abs(value) < MIN_FOCAL)
    return {
      value: (Math.sign(value) || 1) * MIN_FOCAL,
      issue: "focal-zero",
    };
  return { value, issue: null };
}

export interface AngleAmbiguity {
  channel: ChannelId;
  device: string;
  fromValue: number;
  toValue: number;
  fromT: number;
  toT: number;
  /** 选择逆时针/顺时针时的实际转角（度）。 */
  ccwDelta: number;
  cwDelta: number;
}

/** 所有跨 ±180° 且尚未确认方向的角对，播放前必须逐项确认。 */
export function findAngleAmbiguities(
  timeline: TimelineDocument,
  doc: LabDocument,
): AngleAmbiguity[] {
  const devices = new Map(doc.items.map((e) => [e.id, e]));
  const out: AngleAmbiguity[] = [];
  for (const [id, track] of Object.entries(timeline.tracks)) {
    if (!devices.has(id)) continue;
    const keys = track.angle;
    if (!keys || keys.length < 2) continue;
    const sorted = sortedKeys(keys);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (a.direction) continue;
      if (!crossesSeam(a.value, b.value)) continue;
      out.push({
        channel: channelId(id, "angle"),
        device: id,
        fromValue: a.value,
        toValue: b.value,
        fromT: a.t,
        toT: b.t,
        ccwDelta: angularDelta(a.value, b.value, "ccw").delta,
        cwDelta: angularDelta(a.value, b.value, "cw").delta,
      });
    }
  }
  return out;
}

/** 确认旋转方向，写回区间左关键帧。 */
export function withAngleDirection(
  timeline: TimelineDocument,
  channel: ChannelId,
  fromT: number,
  direction: "cw" | "ccw",
): TimelineDocument {
  const [id] = splitChannel(channel);
  const track = timeline.tracks[id];
  if (!track?.angle) return timeline;
  return {
    ...timeline,
    tracks: {
      ...timeline.tracks,
      [id]: {
        ...track,
        angle: track.angle.map((k) =>
          k.t === fromT ? { ...k, direction } : k,
        ),
      },
    },
  };
}

export function trackedChannels(
  timeline: TimelineDocument,
  deviceId: string,
): number {
  const track = timeline.tracks[deviceId];
  if (!track) return 0;
  return Object.values(track).reduce((n, k) => n + (k?.length ?? 0), 0);
}

/**
 * 删除器件时同时删除其轨道 —— 这是明确的删除结果：撤销会一并恢复两者。
 * 绝不会留下指向已删除器件的轨道来「复活」器件。
 */
export function removeDeviceTracks(
  timeline: TimelineDocument,
  deviceId: string,
): { timeline: TimelineDocument; removed: number } {
  const removed = trackedChannels(timeline, deviceId);
  if (!timeline.tracks[deviceId]) return { timeline, removed: 0 };
  const tracks = { ...timeline.tracks };
  delete tracks[deviceId];
  return { timeline: { ...timeline, tracks }, removed };
}

export function upsertKey(
  timeline: TimelineDocument,
  id: string,
  key: AnimatableKey,
  t: number,
  value: number,
): TimelineDocument {
  const time = quantizeTime(t);
  const track = timeline.tracks[id] ?? {};
  const keys = sortedKeys(track[key] ?? []);
  const existing = keys.findIndex((k) => k.t === time);
  if (existing >= 0) {
    keys[existing] = { ...keys[existing], value };
  } else {
    if (keys.length >= MAX_KEYFRAMES_PER_TRACK) return timeline;
    keys.push({ t: time, value });
    keys.sort((a, b) => a.t - b.t);
  }
  return {
    ...timeline,
    tracks: { ...timeline.tracks, [id]: { ...track, [key]: keys } },
  };
}

export function removeKey(
  timeline: TimelineDocument,
  id: string,
  key: AnimatableKey,
  t: number,
): TimelineDocument {
  const track = timeline.tracks[id];
  const keys = track?.[key];
  if (!keys) return timeline;
  const time = quantizeTime(t);
  const next = keys.filter((k) => k.t !== time);
  const nextTrack: Track = { ...track, [key]: next };
  const tracks = { ...timeline.tracks, [id]: nextTrack };
  if (!Object.values(nextTrack).some((x) => x && x.length))
    delete tracks[id];
  return { ...timeline, tracks };
}

export function moveKey(
  timeline: TimelineDocument,
  id: string,
  key: AnimatableKey,
  fromT: number,
  toT: number,
): TimelineDocument {
  const from = quantizeTime(fromT);
  const to = quantizeTime(toT);
  if (from === to) return timeline;
  const track = timeline.tracks[id];
  const keys = track?.[key];
  if (!keys) return timeline;
  const moving = keys.find((k) => k.t === from);
  if (!moving) return timeline;
  const rest = keys.filter((k) => k.t !== from);
  if (rest.some((k) => k.t === to)) return timeline;
  const next = sortedKeys([...rest, { ...moving, t: to }]);
  return {
    ...timeline,
    tracks: { ...timeline.tracks, [id]: { ...track, [key]: next } },
  };
}
