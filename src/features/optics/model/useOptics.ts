import { useState } from "react";
import type { TraceResult } from "../../../shared/document";

/**
 * 光路显示开关。追迹结果由调用方计算一次并传入，避免同一帧在画布、
 * 接收屏与任务面板里各算一遍。
 */
export function useOptics(result: TraceResult) {
  const [visible, setVisible] = useState(true);
  const [normals, setNormals] = useState(false);
  return { result, visible, setVisible, normals, setNormals };
}
