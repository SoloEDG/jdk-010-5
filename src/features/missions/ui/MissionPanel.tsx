import { Check, ArrowUpRight, Target, Timer, TriangleAlert } from "lucide-react";
import { missions } from "../model/presets";
import type { MissionCriterion } from "../lib/evaluate";

export interface EvaluationView {
  progress: number;
  ratio: number;
  rms: number;
  /** 严谨校验：整窗所有采样点都达标。 */
  sustained: boolean;
}

export interface MonitorSummary {
  checked: number;
  total: number;
  progress: number;
  failures: { start: number; end: number }[];
  complete: boolean;
  sustained: boolean;
  stale: boolean;
  contiguous: boolean;
  firstFailure: number | null;
}

export function MissionPanel({
  mission,
  evaluation,
  window: timeWindow,
  monitor,
  playing,
  hasTracks,
  ambiguities,
  onChoose,
}: {
  mission: (typeof missions)[number];
  evaluation: EvaluationView;
  window: { start: number; end: number };
  monitor: MonitorSummary;
  playing: boolean;
  hasTracks: boolean;
  ambiguities: number;
  onChoose: (id: string) => void;
}) {
  const criterion: MissionCriterion = mission.criterion;
  const target = criterion.minRatio;
  return (
    <section className="mission-panel">
      <div className="section-title">
        实验任务 <Target size={15} />
      </div>
      <div className="mission-tabs">
        {missions.map((m, i) => (
          <button
            key={m.id}
            className={m.id === mission.id ? "active" : ""}
            onClick={() => onChoose(m.id)}
          >
            0{i + 1}
          </button>
        ))}
      </div>
      <span className="tag">{mission.tag}</span>
      <h2>
        {mission.name}
        <ArrowUpRight size={19} />
      </h2>
      <p>{mission.description}</p>

      <div className="mission-condition">
        {evaluation.sustained && !playing ? (
          <Check size={15} />
        ) : (
          <span className="circle" />
        )}
        <span>{mission.condition}</span>
      </div>

      <div className="mission-window">
        <Timer size={12} />
        时间窗 {timeWindow.start}–{timeWindow.end} ms
        <em>需整窗持续达标</em>
      </div>

      <div className="progress-track">
        <i style={{ width: `${evaluation.progress * 100}%` }} />
      </div>

      <div className="mission-metrics">
        <span>
          接收能量比 <b>{(evaluation.ratio * 100).toFixed(1)}%</b>
          <small>目标 ≥ {Math.round(target * 100)}%</small>
        </span>
        <span>
          光斑 RMS <b>{Number.isFinite(evaluation.rms) ? evaluation.rms.toFixed(2) : "—"}</b>
          <small>
            {criterion.kind === "focus"
              ? `目标 ≤ ${criterion.maxRms} mm`
              : "实时"}
          </small>
        </span>
      </div>

      <div
        className={`mission-sustained ${monitor.sustained ? "ok" : ""}`}
        aria-live="polite"
      >
        {monitor.sustained ? (
          <>
            <Check size={13} />
            播放监测：{monitor.checked}/{monitor.total} 采样点全部达标
          </>
        ) : monitor.failures.length ? (
          <>
            <TriangleAlert size={13} />
            播放监测：{monitor.failures.length} 段失败（首个{" "}
            {monitor.firstFailure} ms）
          </>
        ) : (
          <>
            <Timer size={13} />
            播放监测：{monitor.checked}/{monitor.total} 采样点
            {monitor.stale && " · 时间轴已修改，正在重新累计"}
            {!monitor.contiguous && " · 覆盖不连续，需完整播放一次"}
            {!hasTracks && " · 无关键帧，静态布局"}
          </>
        )}
      </div>

      {ambiguities > 0 && (
        <small className="mission-warning">
          {ambiguities} 处角度跨越 ±180°，需先选择旋转方向
        </small>
      )}

      <small className={evaluation.sustained ? "success" : "muted"}>
        {evaluation.sustained
          ? "实验完成 · 时间窗内持续达标"
          : playing
            ? "播放中 · 正在逐采样点测量"
            : "探索中 · 调整器件或关键帧观察变化"}
      </small>
      <button className="reset-mission" onClick={() => onChoose(mission.id)}>
        重置本次实验 ↗
      </button>
    </section>
  );
}
