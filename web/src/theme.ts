import {
  createTheme,
  rem,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type MantineTheme,
  type VariantColorsResolver,
} from "@mantine/core";

// Фирменный стиль WALEAD v2 (мягкая палитра) — источник правды
// design/WALEAD-DESIGN-SPEC.md и эталоны design/*.dc.html. Здесь только значения
// оттуда: палитра с тинтами, Onest/Unbounded, рамки 3px, пилюли, строки таблиц
// по 68px. Правило яркости: сплошной цвет — только иконки W, главная (чёрная или
// жёлтая) кнопка и мелкие индикаторы; статусы, бейджи, KPI-акценты и цветные
// кнопки — тинт с тёмным текстом того же цвета. Геометрия — в theme.css

/** Палитра спецификации v2 (§1) и значения, которые эталоны пишут инлайн */
export const WA = {
  ink: "#1F1F1E",
  /** Карточки, таблицы, сайдбар */
  paper: "#FFFFFF",
  /** Фон страницы */
  page: "#FAFAF7",
  muted: "#66665F",
  faint: "#8A8A85",
  disabled: "#B5B5B0",
  line: "#ECECE8",
  chip: "#F3F3F0",
  chip2: "#F1F1EE",
  /** Фон строки таблицы под курсором */
  hover: "#FAFAF7",
  /** Бледная рамка: неактивные стрелки, «⋯», пунктир */
  border: "#D8D8D3",
  green: "#3BA862",
  greenTint: "#E3F3E8",
  greenText: "#1E6B3A",
  orange: "#E2683D",
  orangeTint: "#FBE6DD",
  orangeText: "#A13F17",
  purple: "#6E5DD8",
  purpleTint: "#ECE9FB",
  purpleText: "#4636A8",
  yellow: "#F0C93E",
  yellowTint: "#FBF1CC",
  yellowText: "#7A5D00",
  /** Жёлтый для линий и точек на белом — меню, рамки поставщиков */
  yellowLine: "#E6B800",
  /** Инфо-блок */
  yellowSoft: "#FBF1CC",
} as const;

export const FONT = "Onest, sans-serif";
export const FONT_STICKER = "Unbounded, sans-serif";

/** Нейтральная тень — единственная разрешённая */
export const SHADOW = "0 18px 40px rgba(0,0,0,.06)";

/** Цвет сервиса (= цвет раздела): агенты, ферма, автообзвон, перехват лидов */
export const SERVICE_COLORS = {
  agents: "brand",
  farm: "brandOrange",
  calls: "brandPurple",
  leads: "brandYellow",
} as const;

export type ServiceKey = keyof typeof SERVICE_COLORS;

export const SERVICE_HEX: Record<ServiceKey, string> = {
  agents: WA.green,
  farm: WA.orange,
  calls: WA.purple,
  leads: WA.yellow,
};

/** Сам цвет сервиса — для инлайн-стилей и графиков */
export const serviceColor = (service: ServiceKey) => SERVICE_HEX[service];

/** Текст на заливке цветом: на жёлтом — тёмный, на остальных — белый */
export const onColor = (hex: string) =>
  hex.toUpperCase() === WA.yellow ? WA.ink : WA.paper;

/** Цвет + «22» — 13% непрозрачности: подложка неактивной иконки меню */
export const tint = (hex: string) => `${hex}22`;

/**
 * Мягкая плашка цвета: тинт-фон и тёмный текст того же цвета (§1 «Правило
 * яркости»). Чёрный — #1F1F1E с белым, неизвестный цвет — серый chip
 */
export const soft = (hex: string): { bg: string; fg: string } => {
  switch (hex.toUpperCase()) {
    case WA.green:
      return { bg: WA.greenTint, fg: WA.greenText };
    case WA.orange:
      return { bg: WA.orangeTint, fg: WA.orangeText };
    case WA.purple:
      return { bg: WA.purpleTint, fg: WA.purpleText };
    case WA.yellow:
    case WA.yellowLine:
      return { bg: WA.yellowTint, fg: WA.yellowText };
    case WA.ink:
      return { bg: WA.ink, fg: WA.paper };
    default:
      return { bg: WA.chip, fg: WA.ink };
  }
};

// ─── Палитры Mantine ────────────────────────────────────────────────────────
// Любой color="…" в коде сводится к одному из тонов спецификации: красный —
// это ошибка (оранжевый), синий — нейтральный чёрный, бирюзовый — успех (зелёный)

type Tone = "ink" | "gray" | "green" | "orange" | "purple" | "yellow";

const TONE_HEX: Record<Tone, string> = {
  ink: WA.ink,
  gray: WA.faint,
  green: WA.green,
  orange: WA.orange,
  purple: WA.purple,
  yellow: WA.yellow,
};

/** Тинт и текст на нём для цветных тонов */
const TONE_SOFT: Record<Tone, { bg: string; fg: string }> = {
  ink: { bg: WA.chip, fg: WA.ink },
  gray: { bg: WA.chip2, fg: WA.muted },
  green: { bg: WA.greenTint, fg: WA.greenText },
  orange: { bg: WA.orangeTint, fg: WA.orangeText },
  purple: { bg: WA.purpleTint, fg: WA.purpleText },
  yellow: { bg: WA.yellowTint, fg: WA.yellowText },
};

const TONES: Record<string, Tone> = {
  dark: "ink",
  black: "ink",
  blue: "ink",
  cyan: "ink",
  indigo: "ink",
  gray: "gray",
  green: "green",
  teal: "green",
  lime: "green",
  brand: "green",
  red: "orange",
  orange: "orange",
  pink: "orange",
  brandOrange: "orange",
  violet: "purple",
  grape: "purple",
  brandPurple: "purple",
  yellow: "yellow",
  brandYellow: "yellow",
  gck: "yellow",
};

/** Тон по значению color: имя палитры (с оттенком или без) или hex */
const toneOf = (color: string | undefined): Tone | null => {
  if (!color) return "ink";
  if (color === "white") return null;
  const name = color.split(".")[0];
  if (TONES[name]) return TONES[name];

  const hex = color.toUpperCase();
  const found = (Object.keys(TONE_HEX) as Tone[]).find(
    (tone) => TONE_HEX[tone].toUpperCase() === hex
  );
  return found ?? null;
};

/**
 * Оттенки палитры: 0–1 — тинт, 2 — тинт, 3–6 — сам цвет, 7–9 — тёмный текст
 * на тинте. Так c="green.8" в коде — тёмно-зелёный текст спецификации
 */
const tuple = (hex: string, tintHex: string, text: string): MantineColorsTuple => [
  tintHex,
  tintHex,
  tintHex,
  hex,
  hex,
  hex,
  hex,
  text,
  text,
  text,
];

const green = tuple(WA.green, WA.greenTint, WA.greenText);
const orange = tuple(WA.orange, WA.orangeTint, WA.orangeText);
const purple = tuple(WA.purple, WA.purpleTint, WA.purpleText);
const yellow = tuple(WA.yellow, WA.yellowTint, WA.yellowText);
const gray: MantineColorsTuple = [
  WA.hover,
  WA.chip,
  WA.line,
  WA.border,
  WA.border,
  WA.disabled,
  WA.faint,
  WA.muted,
  WA.muted,
  WA.ink,
];
const dark: MantineColorsTuple = [
  WA.line,
  WA.border,
  WA.faint,
  WA.faint,
  WA.muted,
  WA.muted,
  WA.ink,
  WA.ink,
  WA.ink,
  WA.ink,
];
const ink: MantineColorsTuple = [
  WA.chip,
  WA.chip,
  WA.line,
  WA.ink,
  WA.ink,
  WA.ink,
  WA.ink,
  WA.ink,
  WA.ink,
  WA.ink,
];

// ─── Цвета вариантов ────────────────────────────────────────────────────────

const border = (width: number, color: string) => `${rem(width)} solid ${color}`;

/**
 * Общие цвета вариантов (иконки, алерты, ThemeIcon): цветные — тинт с тёмным
 * текстом, чёрный — сплошной, жёлтый — сплошной с тёмным текстом
 */
const variantColorResolver: VariantColorsResolver = ({ color, variant }) => {
  const tone = toneOf(color);
  const hex = tone ? TONE_HEX[tone] : (color ?? WA.ink);
  const softTone = tone ? TONE_SOFT[tone] : { bg: WA.chip, fg: WA.ink };

  if (variant === "filled") {
    if (tone === "ink") return { background: WA.ink, hover: WA.ink, color: WA.paper, border: border(1, "transparent") };
    if (tone === "yellow") return { background: WA.yellow, hover: WA.yellow, color: WA.ink, border: border(1, "transparent") };
    if (!tone) return { background: hex, hover: hex, color: onColor(hex), border: border(1, "transparent") };
    return { background: softTone.bg, hover: softTone.bg, color: softTone.fg, border: border(1, "transparent") };
  }

  if (variant === "light") {
    return { background: softTone.bg, hover: softTone.bg, color: softTone.fg, border: border(1, "transparent") };
  }

  if (variant === "outline") {
    const line = tone === "gray" ? WA.ink : tone === "yellow" ? WA.yellowLine : hex;
    return {
      background: "transparent",
      hover: softTone.bg,
      color: tone === "yellow" || tone === "gray" ? WA.ink : hex,
      border: border(3, line),
    };
  }

  if (variant === "subtle" || variant === "transparent") {
    return {
      background: "transparent",
      hover: variant === "subtle" ? WA.chip : "transparent",
      color: tone === "gray" ? WA.muted : tone === "yellow" ? WA.ink : hex,
      border: border(1, "transparent"),
    };
  }

  if (variant === "white") {
    return {
      background: WA.paper,
      hover: WA.hover,
      color: tone === "yellow" ? WA.ink : hex,
      border: border(1, "transparent"),
    };
  }

  // default, gradient и прочее — белая пилюля с тёмной рамкой
  return { background: WA.paper, hover: WA.chip, color: WA.ink, border: border(3, WA.ink) };
};

/**
 * Кнопки по эталону v2: главная — чёрная (#1F1F1E) или жёлтая сплошной заливкой,
 * кнопки цвета раздела — тинт с тёмным текстом (+ Новая задача, + Создать задачу),
 * outline — рамка 3px (чёрная или цветом раздела). «light» в коде встречается
 * чаще всего — это та же outline-кнопка. Под курсором outline чернеет (эталон)
 */
const buttonColors = (variant: string, color: string | undefined) => {
  const tone = toneOf(color);
  const hex = tone ? TONE_HEX[tone] : (color ?? WA.ink);
  const softTone = tone ? TONE_SOFT[tone] : { bg: WA.chip, fg: WA.ink };

  switch (variant) {
    case "filled":
    case "gradient":
      if (tone === "ink" || !tone)
        return { bg: WA.ink, hover: WA.ink, color: WA.paper, hoverColor: WA.paper, bd: border(3, "transparent") };
      if (tone === "yellow")
        return { bg: WA.yellow, hover: WA.ink, color: WA.ink, hoverColor: WA.yellow, bd: border(3, "transparent") };
      if (tone === "gray")
        return { bg: WA.chip, hover: WA.line, color: WA.ink, hoverColor: WA.ink, bd: border(3, "transparent") };
      return { bg: softTone.bg, hover: softTone.bg, color: softTone.fg, hoverColor: softTone.fg, bd: border(3, "transparent") };
    case "light":
    case "outline":
    case "default":
      if (variant !== "default" && tone === "yellow")
        return { bg: WA.yellow, hover: WA.ink, color: WA.ink, hoverColor: WA.yellow, bd: border(3, "transparent") };
      if (variant === "default" || tone === "ink" || tone === "gray")
        return { bg: WA.paper, hover: WA.ink, color: WA.ink, hoverColor: WA.paper, bd: border(3, WA.ink) };
      return { bg: WA.paper, hover: softTone.bg, color: hex, hoverColor: softTone.fg, bd: border(3, hex) };
    case "white":
      return { bg: WA.paper, hover: WA.hover, color: tone === "yellow" ? WA.ink : hex, hoverColor: tone === "yellow" ? WA.ink : hex, bd: border(3, "transparent") };
    default:
      // subtle, transparent: текстовая кнопка
      return {
        bg: "transparent",
        hover: variant === "transparent" ? "transparent" : WA.chip,
        color: tone === "gray" ? WA.muted : tone === "yellow" || tone === "ink" ? WA.ink : hex,
        hoverColor: tone === "gray" ? WA.ink : tone === "yellow" || tone === "ink" ? WA.ink : hex,
        bd: border(3, "transparent"),
      };
  }
};

/** Кегль кнопок: 15–16px/800 у обычных, 13–14px у маленьких */
const BUTTON_FZ: Record<string, string> = {
  xs: rem(14),
  sm: rem(15),
  md: rem(16),
  lg: rem(16),
  xl: rem(17),
  "compact-xs": rem(13),
  "compact-sm": rem(13),
  "compact-md": rem(14),
  "compact-lg": rem(15),
  "compact-xl": rem(16),
};

/**
 * Статус-пилюля v2: тинт и тёмный текст того же цвета; жёлтая (ПАУЗА, ★ ДА,
 * На проверке) — сплошная с тёмным текстом; серая — chip-2
 */
const badgeColors = (variant: string, color: string | undefined) => {
  const tone = toneOf(color);
  const hex = tone ? TONE_HEX[tone] : (color ?? WA.ink);
  const softTone = tone ? TONE_SOFT[tone] : { bg: WA.chip, fg: WA.ink };

  switch (variant) {
    case "outline":
      return {
        bg: "transparent",
        color: tone === "gray" ? WA.muted : WA.ink,
        bd: border(2, tone === "gray" ? WA.border : tone === "yellow" ? WA.yellowLine : hex),
      };
    case "dot":
    case "default":
      return { bg: WA.paper, color: WA.muted, bd: border(2, WA.border) };
    case "white":
      return { bg: WA.paper, color: softTone.fg, bd: border(0, "transparent") };
    case "transparent":
      return { bg: "transparent", color: softTone.fg, bd: border(0, "transparent") };
    default:
      if (tone === "ink" || (!tone && hex))
        return tone === "ink"
          ? { bg: WA.ink, color: WA.paper, bd: border(0, "transparent") }
          : { bg: hex, color: onColor(hex), bd: border(0, "transparent") };
      if (tone === "yellow" && variant === "filled")
        return { bg: WA.yellow, color: WA.ink, bd: border(0, "transparent") };
      return { bg: softTone.bg, color: softTone.fg, bd: border(0, "transparent") };
  }
};

/** Пилюли: 11–12px/800, отступы 5px 10px */
const BADGE_SIZE: Record<string, { fz: number; py: number; px: number }> = {
  xs: { fz: 10, py: 3, px: 7 },
  sm: { fz: 11, py: 4, px: 9 },
  md: { fz: 12, py: 5, px: 10 },
  lg: { fz: 13, py: 6, px: 12 },
  xl: { fz: 15, py: 8, px: 16 },
};

/** Круглые иконки-кнопки: сплошная заливка цветом — мелкий индикатор (▶) */
const iconColors = (variant: string, color: string | undefined) => {
  const tone = toneOf(color);
  const hex = tone ? TONE_HEX[tone] : (color ?? WA.ink);
  const solid = tone === "gray" || tone === "yellow" ? WA.ink : hex;
  const softTone = tone ? TONE_SOFT[tone] : { bg: WA.chip, fg: WA.ink };

  switch (variant) {
    case "filled":
      if (tone === "gray") return { bg: WA.chip, hover: WA.line, color: WA.ink, bd: border(3, "transparent") };
      return { bg: hex, hover: hex, color: onColor(hex), bd: border(3, "transparent") };
    case "light":
    case "outline":
    case "default":
      return {
        bg: WA.paper,
        hover: variant === "default" || tone === "gray" || tone === "ink" ? WA.chip : softTone.bg,
        color: solid,
        bd: border(3, variant === "default" ? WA.ink : solid),
      };
    case "white":
      return { bg: WA.paper, hover: WA.hover, color: solid, bd: border(3, "transparent") };
    default:
      return {
        bg: "transparent",
        hover: variant === "transparent" ? "transparent" : WA.chip,
        color: tone === "gray" ? WA.muted : solid,
        bd: border(3, "transparent"),
      };
  }
};

const ICON_SIZE: Record<string, number> = { xs: 26, sm: 32, md: 38, lg: 44, xl: 52 };

const px = (size: unknown, table: Record<string, number>, fallback: string) =>
  typeof size === "number" ? rem(size) : rem(table[(size as string) ?? fallback] ?? table[fallback]);

export const theme = createTheme({
  fontFamily: FONT,
  fontFamilyMonospace: "ui-monospace, Menlo, Consolas, monospace",
  colors: {
    brand: green,
    brandPurple: purple,
    brandOrange: orange,
    brandYellow: yellow,
    green,
    teal: green,
    lime: green,
    red: orange,
    orange,
    pink: orange,
    violet: purple,
    grape: purple,
    yellow,
    gray,
    dark,
    blue: ink,
    cyan: ink,
    indigo: ink,
  },
  primaryColor: "dark",
  primaryShade: 6,
  autoContrast: false,
  black: WA.ink,
  white: WA.paper,
  variantColorResolver,
  defaultRadius: "md",
  radius: {
    xs: rem(8),
    sm: rem(10),
    md: rem(14),
    lg: rem(18),
    xl: rem(26),
  },
  spacing: {
    xs: rem(10),
    sm: rem(14),
    md: rem(18),
    lg: rem(28),
    xl: rem(36),
  },
  fontSizes: {
    xs: rem(13),
    sm: rem(14),
    md: rem(16),
    lg: rem(18),
    xl: rem(20),
  },
  // В эталоне у текста межстрочный «normal» — кроме абзацев, где он задан явно
  lineHeights: { xs: "normal", sm: "normal", md: "normal", lg: "normal", xl: "normal" },
  headings: {
    fontFamily: FONT,
    fontWeight: "800",
    sizes: {
      h1: { fontSize: rem(64), lineHeight: "1", fontWeight: "800" },
      h2: { fontSize: rem(44), lineHeight: "1", fontWeight: "800" },
      h3: { fontSize: rem(26), lineHeight: "1.15", fontWeight: "800" },
      h4: { fontSize: rem(22), lineHeight: "1.2", fontWeight: "800" },
      h5: { fontSize: rem(18), lineHeight: "1.3", fontWeight: "800" },
      h6: { fontSize: rem(15), lineHeight: "1.35", fontWeight: "800" },
    },
  },
  components: {
    Button: {
      defaultProps: { radius: 999, color: "dark" },
      vars: (_theme: MantineTheme, props: { variant?: string; color?: string; size?: string }) => {
        const colors = buttonColors(props.variant ?? "filled", props.color);
        return {
          root: {
            "--button-fz": BUTTON_FZ[props.size ?? "sm"] ?? BUTTON_FZ.sm,
            "--button-bg": colors.bg,
            "--button-hover": colors.hover,
            "--button-color": colors.color,
            "--button-hover-color": colors.hoverColor,
            "--button-bd": colors.bd,
          },
        };
      },
    },
    ActionIcon: {
      defaultProps: { radius: 999, color: "dark", size: "md" },
      vars: (_theme: MantineTheme, props: { variant?: string; color?: string; size?: unknown }) => {
        const colors = iconColors(props.variant ?? "filled", props.color);
        const size = px(props.size, ICON_SIZE, "md");
        return {
          root: {
            "--ai-size": size,
            "--ai-bg": colors.bg,
            "--ai-hover": colors.hover,
            "--ai-color": colors.color,
            "--ai-hover-color": colors.color,
            "--ai-bd": colors.bd,
          },
        };
      },
    },
    Badge: {
      defaultProps: { radius: 999 },
      vars: (
        _theme: MantineTheme,
        props: { variant?: string; color?: string; size?: string; circle?: boolean }
      ) => {
        const colors = badgeColors(props.variant ?? "filled", props.color);
        const size = BADGE_SIZE[props.size ?? "md"] ?? BADGE_SIZE.md;
        const bd = props.variant === "outline" || props.variant === "dot" || props.variant === "default" ? 2 : 0;
        // Кружок-индикатор — сплошной цвет (мелкий индикатор), геометрия Mantine
        if (props.circle) {
          const tone = toneOf(props.color);
          const hex = tone ? TONE_HEX[tone] : (props.color ?? WA.ink);
          return { root: { "--badge-bg": hex, "--badge-color": onColor(hex), "--badge-bd": border(0, "transparent") } };
        }
        return {
          root: {
            "--badge-bg": colors.bg,
            "--badge-color": colors.color,
            "--badge-bd": colors.bd,
            "--badge-fz": rem(size.fz),
            "--badge-height": "auto",
            "--badge-lh": "1.25",
            "--badge-padding-x": rem(size.px - bd),
            "--badge-padding-y": rem(size.py - bd),
          },
        };
      },
    },
    ThemeIcon: { defaultProps: { radius: 999 } },
    Card: { defaultProps: { radius: "xl", padding: 26 } },
    Paper: { defaultProps: { radius: "xl" } },
    Modal: {
      defaultProps: {
        radius: 30,
        padding: 34,
        overlayProps: { backgroundOpacity: 0.55, color: WA.ink },
      },
    },
    Drawer: {
      defaultProps: { padding: 30, overlayProps: { backgroundOpacity: 0.55, color: WA.ink } },
    },
    SegmentedControl: {
      defaultProps: { radius: 999, color: "dark" },
      // Кегль пунктов: 15px (у маленьких 13px, у крупных вкладок 16px)
      vars: (_theme: MantineTheme, props: { size?: string }) => ({
        root: {
          "--sc-font-size": rem(
            props.size === "xs" ? 13 : props.size === "lg" || props.size === "xl" ? 16 : 15
          ),
        },
      }),
    },
    Tabs: { defaultProps: { color: "dark", radius: 999 } },
    Pagination: { defaultProps: { radius: 999, color: "dark" } },
    Tooltip: { defaultProps: { radius: 10, color: "dark" } },
    Loader: { defaultProps: { color: "dark" } },
    Checkbox: { defaultProps: { color: "dark", radius: 7 } },
    Radio: { defaultProps: { color: "dark" } },
    Switch: { defaultProps: { color: "green" } },
    Divider: { defaultProps: { color: WA.line, size: 2 } },
    Progress: { defaultProps: { radius: 999 } },
    Alert: { defaultProps: { radius: 18, color: "yellow" } },
    Notification: { defaultProps: { radius: 18 } },
    Anchor: { defaultProps: { c: "dark" } },
    Menu: { defaultProps: { radius: 14 } },
    Popover: { defaultProps: { radius: 14 } },
  },
});

/** Переменные Mantine под палитру: текст, подписи, рамки, ошибки — оранжевым */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    "--wa-ink": WA.ink,
    "--wa-page": WA.page,
    "--wa-muted": WA.muted,
    "--wa-faint": WA.faint,
    "--wa-disabled": WA.disabled,
    "--wa-line": WA.line,
    "--wa-chip": WA.chip,
    "--wa-chip-2": WA.chip2,
    "--wa-hover": WA.hover,
    "--wa-border": WA.border,
    "--wa-green": WA.green,
    "--wa-orange": WA.orange,
    "--wa-purple": WA.purple,
    "--wa-yellow": WA.yellow,
    "--wa-yellow-line": WA.yellowLine,
    "--wa-yellow-soft": WA.yellowSoft,
    "--wa-font-sticker": FONT_STICKER,
  },
  light: {
    "--mantine-color-body": WA.paper,
    "--mantine-color-text": WA.ink,
    "--mantine-color-dimmed": WA.muted,
    "--mantine-color-placeholder": WA.faint,
    "--mantine-color-anchor": WA.ink,
    "--mantine-color-error": WA.orange,
    "--mantine-color-default": WA.paper,
    "--mantine-color-default-hover": WA.chip,
    "--mantine-color-default-color": WA.ink,
    "--mantine-color-default-border": WA.ink,
    "--mantine-color-disabled": WA.chip2,
    "--mantine-color-disabled-color": WA.disabled,
    "--mantine-color-disabled-border": WA.border,
  },
  dark: {},
});
