import type { WindowCheck } from "../lib/validation";

/**
 * 严谨校验面板：时间窗 + 采样步长 + 逐点结果。这里的每一个数都来自
 * validateRange，与导出 CSV 的采样时间定义完全一致。
 */
export function ValidationPanel({
  check,
  step,
  start,
  end,
  onStep,
  onStart,
  onEnd,
  onExport,
  onSeek,
  duration,
  pending = false,
  progress = 1,
}: {
  check: WindowCheck;
  step: number;
  start: number;
  end: number;
  onStep: (step: number) => void;
  onStart: (v: number) => void;
  onEnd: (v: number) => void;
  onExport: () => void;
  /** 点击失败区间时把播放头定位到该采样点。 */
  onSeek: (t: number) => void;
  duration: number;
  /** 输入变化后严谨校验仍在补算。 */
  pending?: boolean;
  /** 分块校验进度 0..1。 */
  progress?: number;
}) {
  const failed = check.samples.filter((s) => !s.complete).length;
  return (
    <section className="validation-panel">
      <div className="validation-head">
        <div>
          严谨校验
          <span className="validation-badge">
            {pending
              ? `补算中 ${Math.round(progress * 100)}%`
              : check.complete
                ? "整窗达标"
                : "存在失败"}
          </span>
        </div>
      </div>

      {pending && (
        <div className="validation-progress" aria-hidden>
          <i style={{ width: `${Math.max(3, progress * 100)}%` }} />
        </div>
      )}

      <div className="validation-controls">
        <label>
          时间窗
          <input
            type="number"
            aria-label="时间窗起点"
            min={0}
            max={duration}
            step={50}
            value={start}
            onChange={(e) => onStart(Number(e.target.value))}
          />
          <span>→</span>
          <input
            type="number"
            aria-label="时间窗终点"
            min={check.window.start}
            step={50}
            value={end}
            onChange={(e) => onEnd(Number(e.target.value))}
          />
          <small>ms</small>
        </label>
        <label>
          采样步长
          <select
            aria-label="采样步长"
            value={step}
            onChange={(e) => onStep(Number(e.target.value))}
          >
            <option value="10">10 ms</option>
            <option value="25">25 ms</option>
            <option value="50">50 ms</option>
            <option value="100">100 ms</option>
          </select>
        </label>
      </div>

      <div className="validation-summary">
        <div>
          <small>采样点</small>
          <strong>{check.samples.length}</strong>
        </div>
        <div>
          <small>未达标</small>
          <strong className={failed ? "bad" : ""}>{failed}</strong>
        </div>
        <div>
          <small>失败区间</small>
          <strong className={check.failures.length ? "bad" : ""}>
            {check.failures.length}
          </strong>
        </div>
        <div>
          <small>首个失败</small>
          <strong>
            {check.firstFailure === null ? "—" : `${check.firstFailure} ms`}
          </strong>
        </div>
      </div>

      <div className="validation-runs" aria-label="达标区间">
        {check.failures.length === 0 && check.samples.length > 0 && (
          <div className="validation-bar all-pass">
            整窗 {check.window.start}–{check.window.end} ms 持续达标
          </div>
        )}
        {check.failures.slice(0, 4).map((f, i) => (
          <button
            className="validation-bar fail"
            key={i}
            title="定位到该失败区间起点"
            onClick={() => onSeek(f.start)}
          >
            失败 {f.start}–{f.end} ms
          </button>
        ))}
        {check.failures.length > 4 && (
          <div className="validation-bar fail">
            另 {check.failures.length - 4} 段失败，见导出 CSV
          </div>
        )}
      </div>
      <div className="validation-worst">
        <span>
          最差能量比 <b>{(check.worst.ratio * 100).toFixed(1)}%</b>
        </span>
        <span>
          最差 RMS{" "}
          <b>{Number.isFinite(check.worst.rms) ? check.worst.rms.toFixed(2) : "—"} mm</b>
        </span>
      </div>

      {check.notes.length > 0 && (
        <ul className="validation-notes">
          {check.notes.map((n) => (
            <li key={n.code + n.text} className={n.level}>
              {n.text}
            </li>
          ))}
        </ul>
      )}

      <button className="validation-export" onClick={onExport}>
        导出采样 CSV
      </button>
    </section>
  );
}
