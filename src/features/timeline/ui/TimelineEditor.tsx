import { useEffect, useRef, useState } from "react";
import type { LabDocument } from "../../../shared/document";
import { labels } from "../../../shared/document";
import {
  ANIMATABLE,
  keyLabel,
  keyUnit,
  findAngleAmbiguities,
  quantizeTime,
  snapTime,
  sortedKeys,
  type AnimatableKey,
  type Keyframe,
  type AngleAmbiguity,
  type TimelineDocument,
  type Window,
} from "../../../shared/timeline";

/** 时间带左右留白，避免端点关键帧被裁切。 */
const INSET = 10;

interface DragState {
  id: string;
  key: AnimatableKey;
  /** 手势开始时关键帧的时间，仅用于高亮与取消。 */
  originT: number;
  /** 关键帧当前的时间（随每次移动更新）。 */
  currentT: number;
  /** 指针位置对应的目标时间。 */
  toT: number;
}

/**
 * 参数时间轴编辑器。
 * - 刻度区显示任务时间窗，点击可定位播放头；
 * - 每个通道显示关键帧与「在当前时间添加」的数值输入；
 * - 拖动关键帧只更新预览，松开鼠标提交一次事务（撤销按手势）；
 * - 双击关键帧删除。
 */
export function TimelineEditor({
  doc,
  timeline,
  selected,
  currentTime,
  window: timeWindow,
  onCurrentTime,
  onSelectDevice,
  onAddKey,
  onRemoveKey,
  onMoveKey,
  onResolveAngle,
  onDuration,
  valueAt,
}: {
  doc: LabDocument;
  timeline: TimelineDocument;
  selected: string | null;
  currentTime: number;
  window: Window;
  onCurrentTime: (t: number) => void;
  onSelectDevice: (id: string) => void;
  onAddKey: (id: string, key: AnimatableKey, value: number) => void;
  onRemoveKey: (id: string, key: AnimatableKey, t: number) => void;
  onMoveKey: (
    id: string,
    key: AnimatableKey,
    fromT: number,
    toT: number,
    commit: boolean,
  ) => void;
  onResolveAngle: (ambiguity: AngleAmbiguity, direction: "cw" | "ccw") => void;
  onDuration: (duration: number) => void;
  /**
   * 当前时间的参数值（含插值）。新关键帧默认捕获这个值，因此播放中
   * 「就地打帧」不会让光路跳变。
   */
  valueAt: (id: string, key: AnimatableKey) => number;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  // 时间刻度、播放头、关键帧都相对于同一条「时间带」，保证三者的
  // 毫秒 ↔ 像素换算完全一致。
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  /** 键盘微调后关键的 t 变了，DOM 节点会重建；这里把焦点找回来。 */
  const [focusTarget, setFocusTarget] = useState<{
    channel: string;
    t: number;
  } | null>(null);

  useEffect(() => {
    if (!focusTarget) return;
    const selector = `.timeline-key[data-channel="${CSS.escape(
      focusTarget.channel,
    )}"][data-t="${focusTarget.t}"]`;
    const el = railRef.current?.querySelector<HTMLElement>(selector);
    el?.focus();
    setFocusTarget(null);
  }, [focusTarget]);
  const duration = timeline.duration;
  const device = doc.items.find((e) => e.id === selected);
  const channels = device ? ANIMATABLE[device.kind] : [];
  const ambiguities = findAngleAmbiguities(timeline, doc).filter(
    (a) => a.device === selected,
  );

  useEffect(() => {
    if (!drag) setDraft({});
  }, [drag, selected]);

  /**
   * 时间 → 水平位置。左右各留 INSET 像素，使首尾关键帧与播放头完整可见；
   * 刻度、播放头、关键帧、点击定位全部使用这一个换算。
   */
  function percent(t: number): string {
    const ratio = Math.min(1, Math.max(0, t / duration));
    return `${ratio * 100}%`;
  }

  function timeFromEvent(ev: React.PointerEvent): number {
    const el = laneRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const usable = Math.max(1, rect.width - INSET * 2);
    const ratio = (ev.clientX - rect.left - INSET) / usable;
    return snapTime(Math.max(0, Math.min(1, ratio)) * duration, 10);
  }

  function currentValue(id: string, key: AnimatableKey): number {
    return valueAt(id, key);
  }

  return (
    <section className="timeline-editor" aria-label="参数时间轴">
      <div className="timeline-head">
        <div className="timeline-title">
          参数时间轴
          <label className="timeline-duration">
            总时长
            <input
              type="number"
              aria-label="时间轴总时长"
              min={1}
              max={120}
              step={0.5}
              value={duration / 1000}
              onChange={(e) => {
                const s = Number(e.target.value);
                if (!Number.isFinite(s)) return;
                onDuration(
                  Math.max(1000, Math.min(120000, Math.round(s * 1000))),
                );
              }}
            />
            s
          </label>
        </div>
        <div className="timeline-hint">
          {device
            ? `轨道：${labels[device.kind]} · 拖动关键帧改时间，双击删除`
            : "选择器件后可为其位置、角度、焦距或光源功率设置关键帧"}
        </div>
      </div>

      <div
        className="timeline-rail"
        ref={railRef}
        onPointerMove={(ev) => {
          if (!drag) return;
          const next = timeFromEvent(ev);
          if (next === drag.toT) return;
          // 从关键帧当前所在时间出发，避免多次移动用同一个旧起点。
          onMoveKey(drag.id, drag.key, drag.currentT, next, false);
          setDrag({ ...drag, currentT: next, toT: next });
        }}
        onPointerUp={() => {
          if (!drag) return;
          // 提交手势：结束历史合并，形成一个撤销步骤。
          onMoveKey(drag.id, drag.key, drag.currentT, drag.currentT, true);
          setDrag(null);
        }}
        onPointerCancel={() => {
          if (!drag) return;
          onMoveKey(drag.id, drag.key, drag.currentT, drag.originT, true);
          setDrag(null);
        }}
      >
        <button
          className="timeline-track-hit"
          aria-label="时间刻度"
          onPointerDown={(ev) => onCurrentTime(timeFromEvent(ev))}
        />
        <div className="timeline-lane" ref={laneRef}>
          <span
            className="timeline-window-band"
            aria-hidden
            style={{
              left: percent(timeWindow.start),
              width: percent(timeWindow.end - timeWindow.start),
            }}
            title={`任务时间窗 ${timeWindow.start}–${timeWindow.end} ms`}
          />
          {[0, 0.25, 0.5, 0.75, 1].map((r) => (
            <span
              key={r}
              className="timeline-tick"
              style={{ left: `${r * 100}%` }}
            >
              {((duration * r) / 1000).toFixed(1)}s
            </span>
          ))}
          <div
            className="timeline-playhead"
            style={{ left: percent(currentTime) }}
            aria-hidden
          >
            <i />
          </div>
        </div>

        {device && (
          <div className="timeline-channels" role="list">
            {channels.map((ch) => {
              const track = timeline.tracks[device.id];
              const keys = sortedKeys(track?.[ch.key] ?? []);
              const draftKey = device.id + ":" + ch.key;
              return (
                <div className="timeline-channel" key={ch.key} role="listitem">
                  <span className="timeline-channel-label">
                    {keyLabel(ch.key)}
                    <em>{keyUnit(ch.key)}</em>
                  </span>
                  <div className="timeline-channel-rail">
                    {keys.map((k) => {
                      const t =
                        drag && drag.originT === k.t ? drag.toT : k.t;
                      return (
                        <button
                          key={k.t}
                          className={
                            "timeline-key" + (k.direction ? " directed" : "")
                          }
                          style={{ left: percent(t) }}
                          title={`${keyLabel(ch.key)} ${k.value}${keyUnit(
                            ch.key,
                          )} · ${k.t}ms${
                            k.direction === "ccw"
                              ? " · 逆时针"
                              : k.direction === "cw"
                                ? " · 顺时针"
                                : ""
                          }`}
                          aria-label={`${keyLabel(ch.key)}关键帧 ${k.value}，${t} 毫秒`}
                          data-channel={device.id + ":" + ch.key}
                          data-t={k.t}
                          onPointerDown={(ev) => {
                            if (ev.button !== 0) return;
                            ev.stopPropagation();
                            // 捕获在稳定的时间轴容器上：关键帧按钮会因
                            // 时间变化而重挂载，指针事件不能依赖它。
                            railRef.current?.setPointerCapture(ev.pointerId);
                            setDrag({
                              id: device.id,
                              key: ch.key,
                              originT: k.t,
                              currentT: k.t,
                              toT: k.t,
                            });
                          }}
                          onDoubleClick={() =>
                            onRemoveKey(device.id, ch.key, k.t)
                          }
                          onKeyDown={(ev) => {
                            if (ev.key === "Delete" || ev.key === "Backspace") {
                              ev.preventDefault();
                              onRemoveKey(device.id, ch.key, k.t);
                              return;
                            }
                            if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
                              ev.preventDefault();
                              const delta =
                                (ev.key === "ArrowRight" ? 1 : -1) *
                                (ev.shiftKey ? 100 : 10);
                              const next = Math.max(
                                0,
                                Math.min(duration, k.t + delta),
                              );
                              if (next === k.t) return;
                              onMoveKey(device.id, ch.key, k.t, next, true);
                              setFocusTarget({
                                channel: device.id + ":" + ch.key,
                                t: next,
                              });
                            }
                          }}
                        >
                          <i />
                        </button>
                      );
                    })}
                    <div className="timeline-add">
                      <input
                        aria-label={`${keyLabel(ch.key)}关键帧数值`}
                        type="number"
                        step={ch.key === "power" ? 0.1 : 1}
                        value={
                          draft[draftKey] ??
                          String(
                            Math.round(currentValue(device.id, ch.key) * 100) /
                              100,
                          )
                        }
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [draftKey]: e.target.value,
                          }))
                        }
                        onClick={(ev) => ev.stopPropagation()}
                      />
                      <button
                        title={`在 ${quantizeTime(currentTime)} ms 添加关键帧`}
                        onClick={() => {
                          const raw = Number(
                            draft[draftKey] ?? currentValue(device.id, ch.key),
                          );
                          if (!Number.isFinite(raw)) return;
                          const clamped =
                            ch.key === "angle"
                              ? Math.max(-180, Math.min(180, raw))
                              : ch.key === "focal"
                                ? raw === 0
                                  ? 1
                                  : Math.max(-300, Math.min(400, raw))
                                : ch.key === "power"
                                  ? Math.max(0.1, Math.min(3, raw))
                                  : Math.max(0, raw);
                          onAddKey(device.id, ch.key, clamped);
                          setDraft((d) => ({ ...d, [draftKey]: "" }));
                        }}
                      >
                        + 关键帧
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!device && <TrackOverview
          doc={doc}
          timeline={timeline}
          currentTime={currentTime}
          percent={percent}
          onSelectDevice={onSelectDevice}
        />}
      </div>

      {ambiguities.length > 0 && (
        <div className="angle-conflicts" role="alert">
          <strong>角度跨越 ±180°：请选择旋转方向</strong>
          {ambiguities.map((a) => (
            <div className="angle-conflict" key={a.fromT + ":" + a.toT}>
              <span>
                {a.fromT}→{a.toT} ms：{a.fromValue}° → {a.toValue}°
              </span>
              <button onClick={() => onResolveAngle(a, "ccw")}>
                逆时针 {Math.abs(a.ccwDelta)}°
              </button>
              <button onClick={() => onResolveAngle(a, "cw")}>
                顺时针 {Math.abs(a.cwDelta)}°
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 未选中器件时的轨道总览：列出所有已有键的器件及其关键帧分布。
 * 这样时间轴在编辑态不会显示成空白，也便于一眼看出哪台器件被动画化。
 */
function TrackOverview({
  doc,
  timeline,
  currentTime,
  percent,
  onSelectDevice,
}: {
  doc: LabDocument;
  timeline: TimelineDocument;
  currentTime: number;
  percent: (t: number) => string;
  onSelectDevice: (id: string) => void;
}) {
  const rows = doc.items
    .map((item) => {
      const track = timeline.tracks[item.id];
      if (!track) return null;
      const entries = (
        Object.entries(track) as [AnimatableKey, Keyframe[] | undefined][]
      ).filter((e): e is [AnimatableKey, Keyframe[]] => !!e[1]);
      const keys = entries.flatMap(([, list]) => list);
      if (!keys.length) return null;
      return { item, entries, keys };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (!rows.length)
    return (
      <div className="timeline-empty">
        <button
          className="timeline-pick"
          onClick={() => {
            const first = doc.items[0];
            if (first) onSelectDevice(first.id);
          }}
        >
          选择第一个器件开始制作动画
        </button>
      </div>
    );

  return (
    <div className="timeline-overview">
      <p className="timeline-overview-hint">
        已有 {rows.length} 个器件带有关键帧 · 点击行编辑对应轨道
      </p>
      {rows.map(({ item, entries, keys }) => {
        const labelsText = entries
          .map(([key, list]) => `${keyLabel(key)}×${list?.length ?? 0}`)
          .join(" · ");
        return (
          <button
            key={item.id}
            className="timeline-overview-row"
            onClick={() => onSelectDevice(item.id)}
          >
            <span className="timeline-channel-label">
              {labels[item.kind]}
              <em>{keys.length} 键</em>
            </span>
            <span className="timeline-channel-rail">
              {keys.map((k) => (
                <i
                  key={k.t}
                  className="overview-key"
                  style={{ left: percent(k.t) }}
                  title={`${k.t} ms`}
                />
              ))}
              <i
                className="overview-playhead"
                style={{ left: percent(currentTime) }}
              />
            </span>
            <span className="timeline-overview-meta">{labelsText}</span>
          </button>
        );
      })}
    </div>
  );
}
