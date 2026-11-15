import { Trash2, SlidersHorizontal } from "lucide-react";
import { labels, type Element } from "../../../shared/document";
import { parameters } from "../lib/parameters";

function playingLabel(readOnly: boolean, previewing: boolean) {
  if (readOnly) return "播放中 · 只读";
  if (previewing) return "预览中 · 布局未改";
  return "已选中";
}
export function Inspector({
  element,
  onUpdate,
  onRemove,
  readOnly = false,
  previewing = false,
}: {
  element?: Element;
  onUpdate: (patch: Partial<Element>) => void;
  onRemove: () => void;
  /** 播放中禁止修改布局。 */
  readOnly?: boolean;
  /** 播放或暂停时提示当前画布为预览态。 */
  previewing?: boolean;
}) {
  if (!element)
    return (
      <section className="inspector">
        <div className="section-title">
          器件属性 <SlidersHorizontal size={15} />
        </div>
        <p className="empty">
          选择实验台上的器件
          <br />
          查看并调整光学参数
        </p>
      </section>
    );
  return (
    <section className="inspector">
      <div className="section-title">
        器件属性 <SlidersHorizontal size={15} />
      </div>
      <div className="selected-name">
        <i />
        {labels[element.kind]}
        <span>{playingLabel(readOnly, previewing)}</span>
      </div>
      {previewing && (
        <p className="inspector-note">
          {readOnly
            ? "播放中参数已锁定；这里显示布局值，画布显示当前预览帧。"
            : "已暂停：这里仍是布局值，继续播放不会写入布局。"}
        </p>
      )}
      <div className="coordinates">
        {(["x", "y"] as const).map((key) => (
          <label key={key}>
            {key.toUpperCase()}
            <input
              aria-label={key + " 坐标"}
              type="number"
              disabled={readOnly}
              min="20"
              max={key === "x" ? 980 : 580}
              value={Math.round(element[key])}
              onChange={(e) =>
                onUpdate({
                  [key]: Math.max(
                    20,
                    Math.min(key === "x" ? 980 : 580, Number(e.target.value)),
                  ),
                })
              }
            />
            <small>mm</small>
          </label>
        ))}
      </div>
      {parameters(element).map((p) => (
        <label className="parameter" key={p.key}>
          <span>
            {p.label}
            <b>
              {Number(element[p.key]).toFixed(p.step < 1 ? 2 : 0)}{" "}
              <small>{p.unit}</small>
            </b>
          </span>
          <input
            aria-label={p.label}
            type="range"
            disabled={readOnly}
            min={p.min}
            max={p.max}
            step={p.step}
            value={Number(element[p.key])}
            onChange={(e) =>
              onUpdate({
                [p.key]:
                  p.key === "focal" && Number(e.target.value) === 0
                    ? 10
                    : Number(e.target.value),
              })
            }
          />
          <div className="range-label">
            <span>{p.min}</span>
            <span>{p.max}</span>
          </div>
        </label>
      ))}
      <button className="delete" onClick={onRemove} disabled={readOnly}>
        <Trash2 size={14} />
        移除器件
      </button>
    </section>
  );
}
