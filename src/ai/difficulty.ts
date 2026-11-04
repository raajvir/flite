/**
 * AI difficulty (0..1) -> skill per AI car. Skill = share of the available grip
 * the AI's speed plan uses. The best AI gets the top skill; the rest of the field
 * is spread a little below it so the cars don't all run in a train.
 */
export const DIFFICULTY = {
  minTopSkill: 0.76, // difficulty 0
  maxTopSkill: 1.0, // difficulty 1 (= using all the grip the car has)
  fieldSpread: 0.06, // gap between the best and worst AI
  default: 1.0,
  max: 1.5,
  /** Above 100%: AI cars get a performance edge. At 150%: +15% grip, +10% power. */
  bonusGripPerUnit: 0.3,
  bonusPowerPerUnit: 0.2,
};

/** Performance edge for AI cars above 100% difficulty (multipliers; 1 = none). */
export function aiBonus(difficulty: number): { grip: number; power: number } {
  const extra = Math.max(0, Math.min(DIFFICULTY.max, difficulty) - 1);
  return { grip: 1 + DIFFICULTY.bonusGripPerUnit * extra, power: 1 + DIFFICULTY.bonusPowerPerUnit * extra };
}

export function skillsFor(difficulty: number, count: number): number[] {
  const d = Math.max(0, Math.min(1, difficulty)); // above 1 the skill stays at 1; the car gets the edge
  const top = DIFFICULTY.minTopSkill + (DIFFICULTY.maxTopSkill - DIFFICULTY.minTopSkill) * d;
  return Array.from({ length: count }, (_, k) => top - (DIFFICULTY.fieldSpread * k) / Math.max(1, count - 1));
}
