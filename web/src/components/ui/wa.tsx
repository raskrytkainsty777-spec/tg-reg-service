import type { CSSProperties, ReactNode } from "react";
import { Box, type BoxProps } from "@mantine/core";

import { SHADOW, WA, soft } from "../../theme";

// Рецепты эталона design/*.dc.html (v2): заголовок страницы со стикером,
// стикеры, KPI-карточки, инфо-блок. Цветное — тинтом с тёмным текстом,
// сплошные только чёрный и жёлтый (правило яркости спецификации)

/** Заливка плашки: жёлтый и чёрный — сплошные, цвета разделов — тинт */
const fill = (color: string) =>
  color.toUpperCase() === WA.yellow ? { bg: WA.yellow, fg: WA.ink } : soft(color);

/** Стикер: Unbounded 900, заливка цветом раздела, повёрнут */
export function Sticker({
  children,
  color = WA.ink,
  size = 18,
  rotate = -3,
  shadow,
  style,
}: {
  children: ReactNode;
  color?: string;
  /** 11–20px: у заголовка страницы 18, у заголовка блока 14 */
  size?: number;
  rotate?: number;
  /** Нейтральная тень (как у остатка автообзвона) */
  shadow?: boolean;
  style?: CSSProperties;
}) {
  const geometry =
    size >= 20
      ? { padding: "10px 18px", borderRadius: 14 }
      : size >= 18
        ? { padding: "8px 16px", borderRadius: 12 }
        : size >= 15
          ? { padding: "8px 14px", borderRadius: 12 }
          : size >= 13
            ? { padding: "6px 12px", borderRadius: 10 }
            : { padding: "4px 10px", borderRadius: 8 };

  return (
    <span
      className="wa-sticker"
      style={{
        ...geometry,
        fontSize: size,
        background: fill(color).bg,
        color: fill(color).fg,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        boxShadow: shadow ? SHADOW : undefined,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** H1 страницы: 64px/800, -0.045em, line-height 1 */
export function PageTitle({ children, size = 64 }: { children: ReactNode; size?: number }) {
  return (
    <Box
      component="h1"
      m={0}
      style={{
        // На телефоне 64px не влезают («Пользовател…» уезжало за край):
        // ужимаем по ширине экрана, длинное слово переносим
        fontSize: `min(${size}px, 11vw)`,
        overflowWrap: "break-word",
        minWidth: 0,
        fontWeight: 800,
        letterSpacing: "-0.045em",
        lineHeight: 1,
        color: WA.ink,
      }}
    >
      {children}
    </Box>
  );
}

/**
 * Шапка страницы: H1, стикер справа от него, кнопки — к правому краю,
 * подпись под заголовком 17–19px muted
 */
export function PageHeader({
  title,
  sticker,
  actions,
  subtitle,
  children,
  titleSize,
}: {
  title: ReactNode;
  sticker?: ReactNode;
  actions?: ReactNode;
  subtitle?: ReactNode;
  /** Что-то ещё в строке заголовка (сегмент-контрол и т. п.) */
  children?: ReactNode;
  titleSize?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <PageTitle size={titleSize}>{title}</PageTitle>
        {sticker}
        {children}
        {actions && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            {actions}
          </div>
        )}
      </div>
      {subtitle && (
        <div style={{ fontSize: 17, color: WA.muted, lineHeight: 1.45, maxWidth: 900 }}>{subtitle}</div>
      )}
    </div>
  );
}

/** H2 секции: 44px/800 */
export function SectionTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1 }}>
        {children}
      </div>
      {sub && <div style={{ fontSize: 16, color: WA.muted, marginTop: 8, lineHeight: 1.45 }}>{sub}</div>}
    </div>
  );
}

/** Заголовок карточки: 22–26px/800 */
export function CardTitle({ children, size = 26 }: { children: ReactNode; size?: number }) {
  return (
    <div style={{ fontSize: size, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
      {children}
    </div>
  );
}

/** Лейбл KPI / заголовок колонки: UPPERCASE 12–14px/800, muted */
export function Label({
  children,
  size = 14,
  color = WA.muted,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
}) {
  return (
    <div
      style={{
        fontSize: size,
        fontWeight: 800,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        color,
      }}
    >
      {children}
    </div>
  );
}

/**
 * KPI-карточка: рамка 3px, белая. color — вариант «акцент» (одна на ряд): тинт
 * цвета раздела с тёмным текстом. Ровная, без поворота и тени — повёрнутыми
 * бывают только стикеры-ярлыки. Размеры — классы wa-kpi* в theme.css:
 * обычная 18/22, радиус 22, число до 46px; compact 16/20, радиус 20, до 42px;
 * на телефоне обе 12/14, радиус 18, число 27px
 */
export function KpiCard({
  label,
  value,
  note,
  color,
  compact,
  valueColor,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  color?: string;
  /** Поменьше: отступы 16px 20px, число clamp(30px,2.6vw,42px) */
  compact?: boolean;
  valueColor?: string;
}) {
  const tone = color ? fill(color) : null;
  const fg = tone ? tone.fg : WA.ink;

  return (
    <div
      className={compact ? "wa-kpi wa-kpi-compact" : "wa-kpi"}
      style={{
        // У тинта рамка прозрачная — подпись и число стоят ровно с соседями
        border: `3px solid ${tone ? "transparent" : WA.ink}`,
        background: tone ? tone.bg : WA.paper,
        color: fg,
      }}
    >
      <div className="wa-kpi-label" style={{ color: tone ? fg : WA.muted }}>
        {label}
      </div>
      <div className="wa-kpi-value" style={{ color: valueColor }}>
        {value}
      </div>
      {note && (
        <div
          className="wa-kpi-note"
          style={{ color: tone ? fg : WA.muted, fontWeight: tone ? 600 : undefined }}
        >
          {note}
        </div>
      )}
    </div>
  );
}

/**
 * Ряд KPI-карточек одной высоты: auto-fit, minmax(min,1fr), gap 16.
 * На телефоне — две колонки, непарная последняя карточка — на всю строку
 */
export function KpiGrid({ children, min = 200 }: { children: ReactNode; min?: number }) {
  return (
    <div className="wa-kpi-grid" style={{ "--wa-kpi-min": `${min}px` } as CSSProperties}>
      {children}
    </div>
  );
}

/**
 * Маленький KPI в шапке карточки (задача обзвона, сегмент): рамка 3px,
 * radius 18, число 24px, ровный. color — тинтом
 */
export function KpiChip({
  label,
  value,
  color,
}: {
  label: ReactNode;
  value: ReactNode;
  color?: string;
}) {
  const tone = color ? fill(color) : null;
  const fg = tone ? tone.fg : WA.ink;

  return (
    <div
      style={{
        border: `3px solid ${tone ? "transparent" : WA.ink}`,
        background: tone ? tone.bg : WA.paper,
        color: fg,
        borderRadius: 18,
        padding: "10px 16px",
      }}
    >
      <Label size={12} color={color ? fg : WA.muted}>
        {label}
      </Label>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

/** Инфо-блок: #FBF1CC, radius 18, padding 16px 22px, без рамки */
export function InfoBlock({ children, ...props }: { children: ReactNode } & BoxProps) {
  return (
    <Box
      {...props}
      style={{
        background: WA.yellowSoft,
        borderRadius: 18,
        padding: "16px 22px",
        fontSize: 16,
        lineHeight: 1.5,
        display: "flex",
        gap: 14,
      }}
    >
      <b style={{ flexShrink: 0 }}>i</b>
      <div style={{ minWidth: 0 }}>{children}</div>
    </Box>
  );
}

/** Нейтральная плашка-пилюля (Сделано · 1 549, баланс…) */
export function Chip({
  children,
  color,
  outline,
  size = 14,
}: {
  children: ReactNode;
  /** Цвет раздела — тинтом (жёлтый — сплошной); без него — #F3F3F0 */
  color?: string;
  outline?: boolean;
  size?: number;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        borderRadius: 999,
        padding: outline ? "5px 14px" : "8px 14px",
        border: outline ? `3px solid ${WA.ink}` : undefined,
        background: outline ? undefined : color ? fill(color).bg : WA.chip,
        color: color ? fill(color).fg : WA.ink,
        fontSize: size,
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Карточка-контейнер: рамка 3px, radius 26, белая */
export function Panel({
  children,
  padding = "26px 30px",
  gap = 18,
  style,
}: {
  children: ReactNode;
  padding?: CSSProperties["padding"];
  gap?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        border: `3px solid ${WA.ink}`,
        borderRadius: 26,
        background: WA.paper,
        padding,
        display: "flex",
        flexDirection: "column",
        gap,
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Рамка 3px вокруг таблицы со скроллом по горизонтали */
export function TableFrame({
  children,
  minWidth,
}: {
  children: ReactNode;
  minWidth?: number;
}) {
  return (
    <div style={{ border: `3px solid ${WA.ink}`, borderRadius: 26, overflow: "auto", background: WA.paper }}>
      <div style={{ minWidth }}>{children}</div>
    </div>
  );
}
