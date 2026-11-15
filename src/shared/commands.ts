import type { Element, Kind, LabDocument } from "./document";
import {
  documentAt,
  removeDeviceTracks,
  type TimelineDocument,
} from "./timeline";
export interface DocumentCommands {
  select: (id: string | null) => void;
  add: (kind: Kind) => void;
  update: (id: string, patch: Partial<Element>) => void;
  remove: (id: string) => void;
  replace: (doc: LabDocument) => void;
}
export function patchDocument(
  doc: LabDocument,
  id: string,
  patch: Partial<Element>,
): LabDocument {
  return {
    ...doc,
    items: doc.items.map((e) =>
      e.id === id ? { ...e, ...patch, id: e.id, kind: e.kind } : e,
    ),
  };
}

/**
 * 实时预览文档：由布局 + 时间轴在时间 t 采样得到。只用于渲染和测量，
 * 任何调用方都不得把它交回 replace/update 写进布局。
 */
export function previewDocument(
  layout: LabDocument,
  timeline: TimelineDocument,
  t: number,
): LabDocument {
  return documentAt(layout, timeline, t).doc;
}

/**
 * 删除器件：布局与时间轴轨道同时删除，作为单一撤销步骤。这样既不会出现
 * 「器件消失但轨道复活它」的悬空引用，也不会留下无法清理的孤儿关键帧。
 */
export function removeDevice(
  doc: LabDocument,
  id: string,
): { doc: LabDocument; removedKeys: number } {
  const { timeline, removed } = removeDeviceTracks(
    doc.timeline ?? { duration: 8000, tracks: {} },
    id,
  );
  return {
    doc: { ...doc, items: doc.items.filter((e) => e.id !== id), timeline },
    removedKeys: removed,
  };
}

