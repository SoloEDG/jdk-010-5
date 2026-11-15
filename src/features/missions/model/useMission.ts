import { useState } from "react";
import { missions } from "./presets";

/**
 * 当前任务与切换。布局的即时指标由 App 从「当前显示帧」计算，
 * 严谨结论来自时间窗校验，因此这里只负责任务身份。
 */
export function useMission() {
  const [id, setId] = useState("focus");
  const mission = missions.find((m) => m.id === id) ?? missions[0];
  return {
    id,
    mission,
    missions,
    choose: (next: string) => {
      setId(next);
      return structuredClone(
        (missions.find((m) => m.id === next) ?? missions[0]).doc,
      );
    },
  };
}
