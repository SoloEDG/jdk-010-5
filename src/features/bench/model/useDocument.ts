import { useCallback, useRef, useState } from "react";
import type { LabDocument, Element } from "../../../shared/document";
import { patchDocument, removeDevice } from "../../../shared/commands";
import {
  emptyTimeline,
  type AnimatableKey,
  type TimelineDocument,
} from "../../../shared/timeline";
import { loadDocument, saveDocument } from "../lib/storage";

export interface HistoryState {
  doc: LabDocument;
  label: string;
}

const HISTORY_LIMIT = 80;

/**
 * 文档与历史。撤销/重做同时覆盖布局与时间轴：
 * - 关键帧的增删改移都是普通事务；
 * - 拖动关键帧时用 coalesce 键合并为一步；
 * - 播放预览值永远不会经过这里（预览是派生数据）。
 */
export function useDocument(initial: LabDocument) {
  const [doc, setDoc] = useState(() => normalize(loadDocument() ?? initial));
  const [selected, setSelected] = useState<string | null>(null);
  const [past, setPast] = useState<HistoryState[]>([]);
  const [future, setFuture] = useState<HistoryState[]>([]);
  const [saved, setSaved] = useState(false);
  const coalesceRef = useRef<string | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  const commit = useCallback(
    (next: LabDocument, label: string, coalesce?: string) => {
      const current = docRef.current;
      if (coalesce && coalesce === coalesceRef.current) {
        // 连续拖动：只更新当前状态，不新增历史条目。
        docRef.current = next;
        setDoc(next);
        return;
      }
      coalesceRef.current = coalesce ?? null;
      setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), { doc: current, label }]);
      setFuture([]);
      docRef.current = next;
      setDoc(next);
      setSaved(false);
    },
    [],
  );

  const replace = useCallback(
    (next: LabDocument, label = "替换文档") => commit(next, label),
    [commit],
  );

  const update = useCallback(
    (id: string, patch: Partial<Element>, label = "调整器件参数") =>
      commit(patchDocument(docRef.current, id, patch), label),
    [commit],
  );

  const setTimeline = useCallback(
    (next: TimelineDocument, label = "编辑关键帧", coalesce?: string) =>
      commit({ ...docRef.current, timeline: next }, label, coalesce),
    [commit],
  );

  const editTimeline = useCallback(
    (
      fn: (timeline: TimelineDocument) => TimelineDocument,
      label: string,
      coalesce?: string,
    ) => setTimeline(fn(docRef.current.timeline ?? emptyTimeline), label, coalesce),
    [setTimeline],
  );

  const remove = useCallback(
    (id: string) => {
      const { doc: next, removedKeys } = removeDevice(docRef.current, id);
      commit(
        next,
        removedKeys ? `删除器件及 ${removedKeys} 个关键帧` : "删除器件",
      );
      setSelected((s) => (s === id ? null : s));
    },
    [commit],
  );

  const undo = useCallback(() => {
    coalesceRef.current = null;
    setPast((p) => {
      const prev = p[p.length - 1];
      if (!prev) return p;
      setFuture((f) => [{ doc: docRef.current, label: prev.label }, ...f].slice(0, HISTORY_LIMIT));
      docRef.current = prev.doc;
      setDoc(prev.doc);
      setSaved(false);
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    coalesceRef.current = null;
    setFuture((f) => {
      const next = f[0];
      if (!next) return f;
      setPast((p) => [...p, { doc: docRef.current, label: next.label }]);
      docRef.current = next.doc;
      setDoc(next.doc);
      setSaved(false);
      return f.slice(1);
    });
  }, []);

  const endCoalesce = useCallback(() => {
    coalesceRef.current = null;
  }, []);

  return {
    doc,
    selected,
    setSelected,
    saved,
    replace,
    update,
    remove,
    setTimeline,
    editTimeline,
    endCoalesce,
    save: () => {
      saveDocument(docRef.current);
      setSaved(true);
    },
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    undoLabel: past[past.length - 1]?.label ?? "",
    redoLabel: future[0]?.label ?? "",
  };
}

export function normalize(doc: LabDocument): LabDocument {
  const items = doc.items.map((e) => ({
    ...e,
    focal: Math.abs(e.focal) < 1 ? (Math.sign(e.focal) || 1) : e.focal,
  }));
  const timeline = doc.timeline
    ? {
        duration: Math.max(1000, Math.min(120000, Math.round(doc.timeline.duration))),
        tracks: doc.timeline.tracks,
      }
    : emptyTimeline;
  return { ...doc, items, timeline };
}

export type TimelineEdit = (
  key: AnimatableKey,
  t: number,
  value: number,
) => void;
