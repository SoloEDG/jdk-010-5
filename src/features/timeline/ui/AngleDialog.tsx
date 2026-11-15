import type { LabDocument } from "../../../shared/document";
import type { AngleAmbiguity } from "../../../shared/timeline";

/**
 * 角度跨越 ±180° 的方向选择。必须显式选择后才能开始播放，
 * 选择结果写回区间左关键帧的 direction 字段（可撤销）。
 */
export function AngleDialog({
  ambiguities,
  doc,
  onResolve,
  onClose,
  pendingPlay,
}: {
  ambiguities: AngleAmbiguity[];
  doc: LabDocument;
  onResolve: (a: AngleAmbiguity, direction: "cw" | "ccw") => void;
  onClose: () => void;
  /** 本次弹窗是在点击播放时触发的；全部解决后自动开始播放。 */
  pendingPlay: boolean;
}) {
  const name = (id: string) => {
    const index = doc.items.findIndex((e) => e.id === id);
    return index >= 0 ? `器件 ${index + 1}` : "已删除器件";
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="help-modal angle-modal"
        role="dialog"
        aria-modal="true"
        aria-label="选择旋转方向"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="eyebrow">ANGLE SEAM</span>
        <h2>角度跨越 ±180°</h2>
        <p>
          以下角度关键帧位于 ±180° 接缝两侧。请选择旋转方向，避免播放时出现
          意料之外的翻转。未解决前严谨校验不会通过。
        </p>
        {ambiguities.map((a) => (
          <div className="angle-choice" key={a.channel + a.fromT + a.toT}>
            <strong>
              {name(a.device)} · {a.fromT}→{a.toT} ms
            </strong>
            <small>
              {a.fromValue}° → {a.toValue}°
            </small>
            <div>
              <button onClick={() => onResolve(a, "ccw")}>
                逆时针 {Math.abs(a.ccwDelta)}°
                <small>角度增大</small>
              </button>
              <button onClick={() => onResolve(a, "cw")}>
                顺时针 {Math.abs(a.cwDelta)}°
                <small>角度减小</small>
              </button>
            </div>
          </div>
        ))}
        <button className="save-button" onClick={onClose}>
          {pendingPlay ? "完成并播放" : "完成"}
        </button>
      </section>
    </div>
  );
}
