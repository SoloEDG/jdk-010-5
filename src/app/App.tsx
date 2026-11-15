import { useMemo, useState } from "react";
import {
  Sun,
  Undo2,
  Redo2,
  Save,
  Grid2X2,
  MousePointer2,
  Move,
  Info,
  FlaskConical,
} from "lucide-react";
import { CatalogPanel, Inspector, createElement } from "../features/catalog";
import { Bench, ObjectList, useDocument } from "../features/bench";
import { useOptics, RayLayer, OpticsControls } from "../features/optics";
import { useDetector, DetectorPanel } from "../features/detector";
import { initialDocument, useMission, MissionPanel } from "../features/missions";
import {
  computeMetrics,
  evaluationProgress,
} from "../features/missions/lib/evaluate";
import { trace } from "../features/optics/lib/trace";
import {
  documentAt,
  emptyTimeline,
  findAngleAmbiguities,
  moveKey,
  quantizeTime,
  removeKey,
  upsertKey,
  withAngleDirection,
  type AnimatableKey,
  type AngleAmbiguity,
} from "../shared/timeline";
import { TimelineEditor } from "../features/timeline/ui/TimelineEditor";
import { TransportBar } from "../features/timeline/ui/TransportBar";
import { ValidationPanel } from "../features/timeline/ui/ValidationPanel";
import { AngleDialog } from "../features/timeline/ui/AngleDialog";
import { useTimelinePlayback } from "../features/timeline/model/useTimelinePlayback";
import { toCsv } from "../features/timeline/lib/validation";
import { validateRange } from "../features/timeline/lib/sampling";
import { useWindowCheck } from "../features/timeline/model/useWindowCheck";
import type { Precision } from "../features/timeline/lib/playback";
import { downloadText } from "../features/timeline/lib/download";

export function App() {
  const state = useDocument(initialDocument);
  const timeline = state.doc.timeline ?? emptyTimeline;
  const mission = useMission();

  const [grid, setGrid] = useState(true);
  const [help, setHelp] = useState(false);
  const [notice, setNotice] = useState("");
  const [precision, setPrecision] = useState<Precision>("live");
  const [sampleStep, setSampleStep] = useState(25);
  const [windowStart, setWindowStart] = useState(
    mission.mission.window.start,
  );
  const [windowEnd, setWindowEnd] = useState(mission.mission.window.end);
  const [anglePrompt, setAnglePrompt] = useState<AngleAmbiguity[] | null>(null);
  const [pendingPlay, setPendingPlay] = useState(false);

  // 必须保持引用稳定：时间窗对象是校验/播放 effect 的依赖。
  const timeWindow = useMemo(
    () => ({ start: windowStart, end: windowEnd }),
    [windowStart, windowEnd],
  );
  const playback = useTimelinePlayback({
    base: state.doc,
    timeline,
    criterion: mission.mission.criterion,
    precision,
    // 监测步长始终是严谨采样步长：视觉精度不影响测量精度。
    sampleStep,
    window: timeWindow,
  });

  // 预览文档只用于绘制与测量；编辑态布局始终是 state.doc。
  const displayDoc = playback.preview?.doc ?? state.doc;
  // 画面上实际渲染的帧时间（流畅预览时可能略滞后于播放头）。
  const renderedFrameTime = playback.preview?.t ?? 0;
  const displayResult = useMemo(() => trace(displayDoc), [displayDoc]);
  const optics = useOptics(displayResult);
  const detector = useDetector(displayDoc, displayResult);
  /**
   * 编辑面板始终显示**布局值**：播放产生的预览值绝不进入编辑器，
   * 这样暂停/停止后不需要任何「回滚」，也不会让用户误以为布局被改写。
   */
  const inspectorElement = state.doc.items.find((e) => e.id === state.selected);
  const playing = playback.status === "playing";

  const liveMetrics = useMemo(
    () => computeMetrics(displayDoc, displayResult),
    [displayDoc, displayResult],
  );

  const ambiguities = useMemo(
    () => findAngleAmbiguities(timeline, state.doc),
    [timeline, state.doc],
  );

  /** 当前播放时间下的参数值（含插值），用于「就地打帧」的默认值。 */
  const interpolatedAtTime = useMemo(
    () => documentAt(state.doc, timeline, playback.currentTime).doc,
    [state.doc, timeline, playback.currentTime],
  );

  /**
   * 严谨校验与播放监测、CSV 导出共用 validateRange（内部只调用
   * sampleTimes），所以面板、逐帧测量与导出的时间序列完全同源。
   * 大时间窗分块计算，不阻塞预览。
   */
  const validation = useWindowCheck({
    doc: state.doc,
    timeline,
    criterion: mission.mission.criterion,
    window: timeWindow,
    step: sampleStep,
  });
  const check = validation.check;

  const timelineKeys = useMemo(
    () =>
      Object.values(timeline.tracks).reduce(
        (n, track) =>
          n + Object.values(track).reduce((m, k) => m + (k?.length ?? 0), 0),
        0,
      ),
    [timeline],
  );

  function guardPlay(fn: () => void) {
    if (ambiguities.length) {
      setPendingPlay(true);
      setAnglePrompt(ambiguities);
      return;
    }
    fn();
  }

  function addKey(id: string, key: AnimatableKey, value: number) {
    const t = quantizeTime(playback.currentTime);
    state.editTimeline(
      (tl) => upsertKey(tl, id, key, t, value),
      `添加 ${key} 关键帧 @${t}ms`,
    );
  }

  function setDuration(duration: number) {
    state.editTimeline(
      (tl) => ({ ...tl, duration }),
      "调整时间轴总时长",
      "duration-drag",
    );
    state.endCoalesce();
    setWindowEnd((end) => Math.min(end, duration));
    setWindowStart((start) => Math.min(start, duration));
  }

  function deleteKey(id: string, key: AnimatableKey, t: number) {
    state.editTimeline((tl) => removeKey(tl, id, key, t), `删除 ${key} 关键帧`);
  }

  /**
   * 关键帧拖动。中间移动共用同一个 coalesce 键，因此整个手势只产生
   * 一条撤销记录；松手时结束合并。
   */
  function dragKey(
    id: string,
    key: AnimatableKey,
    fromT: number,
    toT: number,
    commit: boolean,
  ) {
    if (fromT !== toT)
      state.editTimeline(
        (tl) => moveKey(tl, id, key, fromT, toT),
        "移动关键帧",
        "drag-key",
      );
    if (commit) state.endCoalesce();
  }

  function resolveAngle(a: AngleAmbiguity, direction: "cw" | "ccw") {
    state.editTimeline(
      (tl) => withAngleDirection(tl, a.channel, a.fromT, direction),
      `角度关键帧选择${direction === "ccw" ? "逆时针" : "顺时针"}`,
    );
  }

  function confirmAngles() {
    setAnglePrompt(null);
    if (pendingPlay) {
      setPendingPlay(false);
      playback.play(playback.status === "paused" ? playback.currentTime : 0);
    }
  }

  function exportCsv() {
    // 导出时用当前状态重新采样，避免拿到延迟校验的旧结果。
    const fresh = validateRange(
      state.doc,
      timeline,
      mission.mission.criterion,
      timeWindow,
      sampleStep,
    );
    const labels: Record<string, string> = {};
    const counts: Record<string, number> = {};
    for (const item of state.doc.items) {
      counts[item.kind] = (counts[item.kind] ?? 0) + 1;
      labels[item.id] = `${item.kind}-${counts[item.kind]}`;
    }
    const csv = toCsv(fresh, {
      duration: timeline.duration,
      missionId: mission.mission.id,
      missionName: mission.mission.name,
      criterion: mission.mission.condition,
      timeline,
      labels,
    });
    downloadText(
      `lumen-timeline-${mission.mission.id}-${fresh.window.start}-${fresh.window.end}-${sampleStep}ms.csv`,
      csv,
      "text/csv;charset=utf-8",
    );
    setNotice(
      `已导出 ${fresh.samples.length} 个采样点（步长 ${sampleStep}ms，时间窗 ${fresh.window.start}–${fresh.window.end}）`,
    );
  }

  return (
    <div className="app-shell">
      <header>
        <a className="brand" href="./">
          <span className="brand-mark">
            <Sun size={23} />
          </span>
          LUMEN
          <span className="brand-divider" />
          <small>光学实验室</small>
        </a>
        <div className="document-title">
          未命名实验 <span>本地工作区</span>
        </div>
        <div className="header-actions">
          <button
            title={state.canUndo ? `撤销：${state.undoLabel}` : "撤销"}
            disabled={!state.canUndo}
            onClick={state.undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            title={state.canRedo ? `重做：${state.redoLabel}` : "重做"}
            disabled={!state.canRedo}
            onClick={state.redo}
          >
            <Redo2 size={17} />
          </button>
          <i />
          <button
            className="save-button"
            onClick={() => {
              try {
                state.save();
                setNotice("实验与时间轴已保存到此浏览器");
              } catch {
                setNotice("保存失败，浏览器存储空间不足");
              }
            }}
          >
            <Save size={15} />
            {state.saved ? "已保存" : "保存实验"}
          </button>
        </div>
      </header>

      <div className="workspace-heading">
        <div>
          <span className="eyebrow">THE OPTICS PLAYGROUND</span>
          <h1>
            让光的路径，清晰可见<span>。</span>
          </h1>
        </div>
        <p>
          <i />
          二维几何光学 · 可回放时间轴
        </p>
      </div>

      <main>
        <aside className="left-sidebar">
          <CatalogPanel
            onAdd={(kind) => {
              if (state.doc.items.length >= 80) {
                setNotice("场景最多容纳 80 个器件");
                return;
              }
              if (playing) {
                setNotice("播放中不能增删器件；请先暂停或停止");
                return;
              }
              const e = createElement(kind, state.doc.items.length);
              state.replace(
                { ...state.doc, items: [...state.doc.items, e] },
                "添加器件",
              );
              state.setSelected(e.id);
            }}
          />
          <ObjectList
            doc={state.doc}
            selected={state.selected}
            onSelect={state.setSelected}
          />
        </aside>

        <div className="center">
          <section className="canvas-panel">
            <div className="canvas-toolbar">
              <div className="canvas-label">
                <FlaskConical size={15} />
                实验台
                <span>{playing ? "PLAY" : "LIVE"}</span>
              </div>
              <div className="canvas-tools">
                <OpticsControls
                  visible={optics.visible}
                  normals={optics.normals}
                  onVisible={() => optics.setVisible(!optics.visible)}
                  onNormals={() => optics.setNormals(!optics.normals)}
                />
                <button
                  className={grid ? "enabled" : ""}
                  title="切换网格"
                  onClick={() => setGrid(!grid)}
                >
                  <Grid2X2 size={15} />
                </button>
              </div>
            </div>
            <div className="canvas-container">
              <Bench
                doc={displayDoc}
                selected={state.selected}
                onSelect={state.setSelected}
                onUpdate={(id, patch) => {
                  if (playing) {
                    setNotice("播放中只重算预览，不写回布局；请先暂停");
                    return;
                  }
                  state.update(id, patch);
                }}
                grid={grid}
                readOnly={playing}
              >
                <RayLayer
                  doc={displayDoc}
                  result={displayResult}
                  visible={optics.visible}
                  normals={optics.normals}
                />
              </Bench>
              {playback.status !== "idle" && (
                <div className="preview-badge">
                  <i />
                  预览帧 {Math.round(renderedFrameTime)} ms · 布局未修改
                </div>
              )}
              <div className="canvas-badge">
                <MousePointer2 size={13} />
                选择与拖动
              </div>
              <div className="scale">
                ━━━━ <span>100 mm</span>
              </div>
            </div>
            <div className="canvas-footer">
              <span>
                <Move size={12} />
                拖动移动器件 <i />
                方向键微调
              </span>
              <span>
                {displayResult.segments.length} 段光路 ·{" "}
                {state.doc.items.length} 个器件 · {timelineKeys} 个关键帧
              </span>
            </div>
          </section>

          <section className="timeline-panel">
            <TransportBar
              playing={playing}
              paused={playback.status === "paused"}
              currentTime={playback.currentTime}
              duration={playback.total}
              precision={precision}
              drops={playback.drops}
              monitor={playback.monitor}
              onPlay={() =>
                guardPlay(() => {
                  // 停在末尾再次播放时从头开始，而不是立刻结束。
                  const atEnd =
                    playback.currentTime >= playback.total - 1;
                  playback.play(
                    playback.status === "paused" && !atEnd
                      ? playback.currentTime
                      : 0,
                  );
                })
              }
              onPause={playback.pause}
              onStop={playback.stop}
              onStep={(dir) => {
                playback.pause();
                playback.step(dir);
              }}
              onSeek={(t) => {
                playback.pause();
                playback.seek(t);
              }}
              onPrecision={setPrecision}
            />
            <TimelineEditor
              doc={state.doc}
              timeline={timeline}
              selected={state.selected}
              currentTime={playback.currentTime}
              window={timeWindow}
              onCurrentTime={(t) => {
                playback.pause();
                playback.seek(t);
              }}
              onSelectDevice={state.setSelected}
              onAddKey={addKey}
              onRemoveKey={deleteKey}
              onMoveKey={dragKey}
              onResolveAngle={resolveAngle}
              onDuration={setDuration}
              valueAt={(id, key) => {
                const element = interpolatedAtTime.items.find(
                  (e) => e.id === id,
                );
                return element ? Number(element[key]) : 0;
              }}
            />
          </section>

          <DetectorPanel
            {...detector}
            onChoose={detector.setChosen}
            onResolution={detector.setResolution}
          />
        </div>

        <aside className="right-sidebar">
          <Inspector
            element={inspectorElement}
            readOnly={playing}
            previewing={playback.status !== "idle"}
            onUpdate={(p) => {
              if (playing) {
                setNotice("播放中不允许修改布局；请暂停或停止");
                return;
              }
              if (inspectorElement) state.update(inspectorElement.id, p);
            }}
            onRemove={() => {
              if (!inspectorElement) return;
              if (playing) {
                setNotice("播放中不能删除器件；请先暂停或停止");
                return;
              }
              const count = Object.values(
                timeline.tracks[inspectorElement.id] ?? {},
              ).reduce((n, k) => n + (k?.length ?? 0), 0);
              state.remove(inspectorElement.id);
              setNotice(
                count
                  ? `已删除器件及其 ${count} 个关键帧（可撤销）`
                  : "已删除器件",
              );
            }}
          />
          <MissionPanel
            mission={mission.mission}
            evaluation={{
              // 进度条与数值都跟随当前显示帧（播放时为预览帧）。
              progress: evaluationProgress(
                mission.mission.criterion,
                liveMetrics,
              ),
              ratio: liveMetrics.ratio,
              rms: liveMetrics.rms,
              // 验收只看严谨校验：整窗每个采样点都必须达标。
              sustained: check.complete && !validation.pending,
            }}
            window={timeWindow}
            monitor={playback.monitor}
            playing={playing}
            hasTracks={timelineKeys > 0}
            ambiguities={ambiguities.length}
            onChoose={(id) => {
              playback.stop();
              const next = mission.choose(id);
              state.replace(next, "切换实验任务");
              state.setSelected(null);
              const nextMission = mission.missions.find((m) => m.id === id);
              if (nextMission) {
                setWindowStart(nextMission.window.start);
                setWindowEnd(nextMission.window.end);
              }
            }}
          />
          <ValidationPanel
            check={check}
            step={sampleStep}
            start={windowStart}
            end={windowEnd}
            duration={timeline.duration}
            onStep={setSampleStep}
            onStart={(v) =>
              setWindowStart(Math.max(0, Math.min(windowEnd, Math.round(v))))
            }
            onEnd={(v) =>
              setWindowEnd(
                Math.max(
                  windowStart,
                  Math.min(timeline.duration, Math.round(v)),
                ),
              )
            }
            onExport={exportCsv}
            pending={validation.pending}
            progress={validation.progress}
            onSeek={(t) => {
              playback.pause();
              playback.seek(t);
            }}
          />
        </aside>
      </main>

      <footer>
        <span>
          <i />
          {playing
            ? `播放中 · 逐采样点监测 ${playback.monitor.checked}/${playback.monitor.total}`
            : playback.status === "paused"
              ? "已暂停 · 布局保持编辑态"
              : "光路计算已更新"}
          {displayResult.truncated > 0 ? " · 部分光线达到追迹上限" : ""}
        </span>
        <span>{notice || "所有实验数据保存在你的浏览器中"}</span>
        <button onClick={() => setHelp(!help)}>
          <Info size={13} />
          使用指南
        </button>
      </footer>

      {anglePrompt && (
        <AngleDialog
          ambiguities={anglePrompt}
          doc={state.doc}
          onResolve={resolveAngle}
          onClose={confirmAngles}
          pendingPlay={pendingPlay}
        />
      )}

      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section className="help-modal" onClick={(e) => e.stopPropagation()}>
            <span className="eyebrow">QUICK START</span>
            <h2>把光路变成可回放的实验</h2>
            <p>1. 点击左侧器件添加到实验台，选择器件后调整参数。</p>
            <p>
              2. 在参数时间轴上为 X/Y 位置、角度、焦距或光源功率添加关键帧；
              播放时重新计算光路与接收屏信号。
            </p>
            <p>
              3. 「流畅预览」按刷新率播放，「严谨校验」按固定毫秒采样；
              掉帧不会跳过任何采样点。
            </p>
            <p>
              4. 设置任务时间窗，只有整窗所有采样点都达标才算持续达标；
              可导出与测量同源的采样 CSV。
            </p>
            <p className="muted">
              角度跨越 ±180° 时必须选择旋转方向；焦距经过 0 会被钳制到
              ±1 mm 并明确标记。播放中的编辑只影响预览，停止后回到原布局。
            </p>
            <button className="save-button" onClick={() => setHelp(false)}>
              开始探索
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
