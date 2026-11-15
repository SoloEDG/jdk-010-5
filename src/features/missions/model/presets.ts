import type { Element, LabDocument } from "../../../shared/document";

const e = (
  id: string,
  kind: Element["kind"],
  x: number,
  y: number,
  patch: Partial<Element> = {},
): Element => ({
  id,
  kind,
  x,
  y,
  angle: kind === "source" ? 0 : 90,
  size: 180,
  power: 1,
  rays: 9,
  spread: 0,
  wavelength: 550,
  focal: 180,
  index: 1.52,
  ...patch,
});

export interface Mission {
  id: string;
  name: string;
  tag: string;
  description: string;
  condition: string;
  criterion:
    | { kind: "focus"; minRatio: number; maxRms: number }
    | { kind: "energy"; minRatio: number }
    | { kind: "prism-energy"; minRatio: number };
  doc: LabDocument;
  /** 默认时间窗（毫秒），任务要求在该窗口内持续达标。 */
  window: { start: number; end: number };
}

export const missions: Mission[] = [
  {
    id: "focus",
    name: "寻找焦点",
    tag: "透镜成像",
    description: "移动接收屏，使平行光经凸透镜后汇聚成一个清晰光斑。",
    condition: "接收 ≥ 80% 光能，RMS 半径 ≤ 3 mm",
    criterion: { kind: "focus", minRatio: 0.8, maxRms: 3 },
    // 默认窗口整个覆盖演示动画：中段对焦、5350ms 短暂失焦、随后恢复，
    // 因此初始校验必然判定「未持续达标」，正好演示短暂失败不会被跳过。
    window: { start: 2000, end: 6500 },
    doc: {
      version: 1,
      items: [
        e("source", "source", 140, 300, { size: 120 }),
        e("lens", "lens", 450, 300, { size: 240, focal: 180 }),
        e("screen", "screen", 790, 300, { size: 230 }),
      ],
      // 示例演示：接收屏从布局位置滑入焦点、保持，再短暂失焦并恢复。
      // 首帧值与布局一致，播放不会跳变；播放只产生预览，不写回布局。
      timeline: {
        duration: 8000,
        tracks: {
          screen: {
            x: [
              { t: 0, value: 790 },
              { t: 1400, value: 630 },
              { t: 5200, value: 630 },
              { t: 5350, value: 900 },
              { t: 5600, value: 630 },
              { t: 8000, value: 630 },
            ],
          },
        },
      },
    },
  },
  {
    id: "reflection",
    name: "转折的光",
    tag: "镜面反射",
    description: "调整镜面方向，把光束转向上方的接收屏。",
    condition: "接收屏捕获 ≥ 80% 光源能量",
    criterion: { kind: "energy", minRatio: 0.8 },
    window: { start: 1500, end: 7000 },
    doc: {
      version: 1,
      items: [
        e("source", "source", 150, 370, { size: 60 }),
        e("mirror", "mirror", 500, 370, { angle: -35 }),
        e("screen", "screen", 500, 100, { angle: 0, size: 200 }),
      ],
    },
  },
  {
    id: "refraction",
    name: "穿过玻璃",
    tag: "棱镜折射",
    description: "移动接收屏，捕获穿过三棱镜的折射光束。",
    condition: "经过棱镜后，接收 ≥ 60% 光源能量",
    criterion: { kind: "prism-energy", minRatio: 0.6 },
    window: { start: 2000, end: 6500 },
    doc: {
      version: 1,
      items: [
        e("source", "source", 130, 280, { size: 45 }),
        e("prism", "prism", 490, 300, { angle: -90, size: 170 }),
        e("screen", "screen", 800, 300, { size: 200 }),
      ],
    },
  },
];

export const initialDocument = missions[0].doc;
