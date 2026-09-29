// Attack rules: see attack-rules.ts for how they work.

import type { AttackRule, Resume } from "./attack-rules";

export const rulesEffects = (): AttackRule[] => [];

export const resumesEffects = (): Record<string, Resume> => ({});
