import {
  Pause,
  Play,
  Rewind,
  SkipForward,
  Square,
  Gauge,
  CircleSlash,
  CheckCircle2,
} from "lucide-react";
import {
  formatClock,
  type DroppedFrameReport,
  type Precision,
} from "../lib/playback";

export interface TransportMonitor {
  checked: number;
  total: number;
  sustained: boolean;
  failures: unknown[];
  complete: boolean;
  contiguous: boolean;
}

/**
 * 播放控制条。两种精度协作而非互斥：
 * - 流畅预览按刷新率播放，允许合并一次预览重算；
 * - 严谨校验只展示采样网格上的时间，逐点追迹；
 * - 无论哪种，暂停/停止后布局保持编辑态。
 */
export function TransportBar({
  playing,
  paused,
  currentTime,
  duration,
  precision,
  drops,
  monitor,
  onPlay,
  onPause,
  onStop,
  onStep,
  onSeek,
  onPrecision,
}: {
  playing: boolean;
  paused: boolean;
  currentTime: number;
  duration: number;
  precision: Precision;
  drops: DroppedFrameReport;
  monitor: TransportMonitor;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onStep: (dir: 1 | -1) => void;
  onSeek: (t: number) => void;
  onPrecision: (p: Precision) => void;
}) {
  return (
    <div className="transport">
      <div className="transport-buttons">
        <button title="回到开头（停止）" onClick={onStop}>
          <Rewind size={15} />
        </button>
        {playing ? (
          <button className="transport-main" title="暂停" onClick={onPause}>
            <Pause size={16} />
          </button>
        ) : (
          <button
            className="transport-main"
            title={paused ? "继续播放" : "播放"}
            onClick={onPlay}
          >
            <Play size={16} />
          </button>
        )}
        <button title="下一个采样点" onClick={() => onStep(1)}>
          <SkipForward size={15} />
        </button>
        <button title="停止并回到编辑态" onClick={onStop}>
          <Square size={13} />
        </button>
      </div>

      <div className="transport-time" aria-label="播放时间">
        <strong>{formatClock(currentTime)}</strong>
        <small>/ {formatClock(duration)}</small>
      </div>

      <label className="transport-scrub">
        <span className="sr-only">播放位置</span>
        <input
          type="range"
          aria-label="播放位置"
          min={0}
          max={duration}
          step={1}
          value={Math.min(duration, Math.round(currentTime))}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
      </label>

      <div className="transport-precision" role="group" aria-label="播放精度">
        <button
          className={precision === "live" ? "active" : ""}
          onClick={() => onPrecision("live")}
          title="按屏幕刷新播放，光路重算可合并"
        >
          <Gauge size={13} />
          流畅预览
        </button>
        <button
          className={precision === "exact" ? "active" : ""}
          onClick={() => onPrecision("exact")}
          title="按固定采样步长逐点追迹，不跳过任何采样点"
        >
          <CheckCircle2 size={13} />
          严谨校验
        </button>
      </div>

      <div className="transport-status">
        {playing ? (
          <span className="transport-live">
            <i />
            {precision === "live" ? "实时播放" : "逐点追迹"}
          </span>
        ) : paused ? (
          <span className="transport-paused">已暂停 · 布局未修改</span>
        ) : (
          <span className="transport-idle">编辑态</span>
        )}
        <span className="transport-monitor">
          监测 {monitor.checked}/{monitor.total}
          {monitor.sustained
            ? " · 整窗达标"
            : monitor.failures.length
              ? " · 有失败"
              : monitor.complete && !monitor.contiguous
                ? " · 覆盖不连续"
                : " · 累计中"}
        </span>
        {drops.droppedVisual > 0 && (
          <span className="transport-drops">
            <CircleSlash size={11} />
            视觉掉帧 {drops.droppedVisual}
            {precision === "exact" ? " · 采样点无跳过" : " · 预览重算已合并"}
          </span>
        )}
      </div>
    </div>
  );
}
