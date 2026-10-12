// Общие мелочи оформления по эталону

/** Число и слово в нужной форме: 1 агент, 2 агента, 5 агентов */
export const plural = (count: number, [one, few, many]: [string, string, string]) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

/** Выпадающий фильтр-пилюля: «Бот: все ▾» — 15px/700, рамка 3px, radius 999 */
export const PILL_SELECT = {
  input: { fontSize: 15, fontWeight: 700, paddingInlineStart: 20 },
};

/** Класс фильтра-пилюли: подсказка тёмная и жирная, как выбранное значение */
export const PILL_CLASSES = { input: "wa-pill-select" };
