// Attack rules: see attack-rules.ts for how they work.

import type { AttackRule, Resume } from "./attack-rules";

export const rulesDamage = (): AttackRule[] => [];

export const resumesDamage = (): Record<string, Resume> => ({});
