// Attack rules: see attack-rules.ts for how they work.

import type { AttackRule, Resume } from "./attack-rules";

export const rulesMisc = (): AttackRule[] => [];

export const resumesMisc = (): Record<string, Resume> => ({});
