/**
 * AI difficulty (0..1) -> skill per AI car. Skill = share of the available grip
 * the AI's speed plan uses. The best AI gets the top skill; the rest of the field
 * is spread a little below it so the cars don't all run in a train.
 */
export const DIFFICULTY = {
  minTopSkill: 0.76, // difficulty 0
  maxTopSkill: 1.0, // difficulty 1
  fieldSpread: 0.06, // gap between the best and worst AI
  default: 0.7,
};

export function skillsFor(difficulty: number, count: number): number[] {
  const d = Math.max(0, Math.min(1, difficulty));
  const top = DIFFICULTY.minTopSkill + (DIFFICULTY.maxTopSkill - DIFFICULTY.minTopSkill) * d;
  return Array.from({ length: count }, (_, k) => top - (DIFFICULTY.fieldSpread * k) / Math.max(1, count - 1));
}
