import type { TimelineDocument } from "./timeline";

export type Kind = "source" | "mirror" | "lens" | "prism" | "screen";
export interface Point {
  x: number;
  y: number;
}
export interface Element extends Point {
  id: string;
  kind: Kind;
  angle: number;
  size: number;
  power: number;
  rays: number;
  spread: number;
  wavelength: number;
  focal: number;
  index: number;
}
export interface LabDocument {
  version: 1;
  items: Element[];
  /**
   * 参数时间轴。与布局放在同一文档中，这样撤销/重做/保存会一起恢复，
   * 但播放时由 documentAt 派生预览文档，**绝不**回写这里。
   */
  timeline?: TimelineDocument;
}
export interface Segment {
  from: Point;
  to: Point;
  power: number;
  wavelength: number;
  source: string;
}
export interface ScreenHit {
  screen: string;
  position: number;
  power: number;
  wavelength: number;
  source: string;
}
export interface TraceResult {
  segments: Segment[];
  hits: ScreenHit[];
  truncated: number;
}
export const labels: Record<Kind, string> = {
  source: "光源",
  mirror: "平面镜",
  lens: "凸透镜",
  prism: "三棱镜",
  screen: "接收屏",
};
