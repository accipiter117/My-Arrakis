// js/victoryWatch.js
//
// Who is close to winning, from public information only (board positions,
// alliances, the turn), using the victory rules' own checks so the warning
// can never disagree with the actual result. Bene Gesserit's Prediction is
// secret and is never included here.
//
// Levels: 'critical' = wins at the end of this turn unless something
// changes; 'warning' = one step away; 'info' = a special condition to know.

import { strongholdIdsFrom, strongholdsOccupiedBy, checkFremenSpecialVictory } from './victoryEngine.js';

export function assessVictoryWatch(state, territoriesData) {
  const ids = strongholdIdsFrom(territoriesData);
  const v = state.rulesConfig.victoryVariants;
  const name = id => territoriesData.territories[id]?.name ?? id;
  const items = [];

  // Groups: each alliance, and each unallied faction.
  const groups = [];
  const seen = new Set();
  for (const a of state.alliances ?? []) { groups.push(a.factions.slice()); a.factions.forEach(f => seen.add(f)); }
  for (const f of Object.keys(state.factions)) if (!seen.has(f)) groups.push([f]);

  for (const group of groups) {
    const held = [...new Set(group.flatMap(f => strongholdsOccupiedBy(state, f, ids)))];
    const needed = group.length > 1 ? v.allianceStrongholdCount : v.soloStrongholdCount;
    if (held.length >= needed) {
      items.push({ level: 'critical', factions: group, held, deciding: held,
        headline: `hold ${held.length} of the ${needed} strongholds they need: they win at the end of this turn`,
        detail: `Take any one of these from them to stop it: ${held.map(name).join(', ')}.` });
    } else if (held.length === needed - 1) {
      const open = ids.filter(t => !held.includes(t));
      items.push({ level: 'warning', factions: group, held, deciding: open,
        headline: `one stronghold from victory (${held.length} of ${needed})`,
        detail: `They hold ${held.map(name).join(', ')}. Taking any of ${open.map(name).join(', ')} wins it for them.` });
    }
  }

  // The Fremen special victory, from two turns before the end.
  if (state.factions.fremen && state.meta.turn >= v.maxTurns - 2) {
    const winners = checkFremenSpecialVictory(state);
    if (winners) {
      items.push({ level: state.meta.turn >= v.maxTurns ? 'critical' : 'warning', factions: winners, held: [], deciding: ['sietchTabr', 'habbanyaSietch', 'tueksSietch'],
        headline: state.meta.turn >= v.maxTurns ? 'win the Fremen special victory at the end of this turn' : `are on course for the Fremen special victory on turn ${v.maxTurns}`,
        detail: 'It needs Sietch Tabr and Habbanya Sietch held by the Fremen (or empty), and no Harkonnen, Atreides or Emperor troops in Tuek’s Sietch. One Harkonnen, Atreides or Emperor troop in Tuek’s Sietch, or anyone else in either sietch, blocks it.' });
    }
  }

  // The Guild special victory: the default ending.
  if (state.factions.guild && state.meta.turn >= v.maxTurns - 1) {
    const ally = (state.alliances ?? []).find(a => a.factions.includes('guild'))?.factions ?? ['guild'];
    items.push({ level: 'info', factions: ally, held: [], deciding: [],
      headline: `win if nobody else has won by the end of turn ${v.maxTurns}`,
      detail: 'The Spacing Guild special victory, shared with the Guild’s ally. Someone has to actually win to stop it.' });
  }

  const order = { critical: 0, warning: 1, info: 2 };
  return items.sort((a, b) => order[a.level] - order[b.level]);
}
