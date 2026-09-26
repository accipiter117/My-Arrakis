// js/ai/difficulty.js
//
// Difficulty levels (brief section 29, AI plan step 8). Harder levels make
// BETTER DECISIONS; no level ever gets extra spice, forces, cards or a look
// at hidden information.
//
//   Easy:   the Basic AI. Legal, simple play; never allies; fights by rules
//           of thumb; no threat assessment.
//   Normal: the Strategic AI (denies the leader, closes out wins, allies and
//           betrays) but fights battles by rules of thumb.
//   Hard:   Normal plus the battle brain (+51% wins head to head).

import { createBasicAI } from './basicAI.js';
import { createStrategicAI } from './strategicAI.js';

export const DIFFICULTIES = {
  easy: { name: 'Easy', describe: 'Plays legally but simply, never allies.' },
  normal: { name: 'Normal', describe: 'Stops leaders, grabs wins, makes and breaks alliances.' },
  hard: { name: 'Hard', describe: 'Normal, plus calculates every battle against what you might hold.' }
};

export function createAI(level, options) {
  if (level === 'easy') return { ...createBasicAI(options), name: 'Easy AI' };
  if (level === 'normal') return { ...createStrategicAI({ ...options, battleBrain: false }), name: 'Normal AI' };
  return { ...createStrategicAI(options), name: 'Hard AI' };
}
