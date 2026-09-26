// ui/factionGuide.js
//
// A cheat sheet per faction: what makes them unique, how to press those
// advantages, and how to counter them. Written for the rules as they work
// in this game (advanced rules always on). Original text.

export const FACTION_GUIDE = {
  atreides: {
    title: 'House Atreides',
    tagline: 'Foresight. They know what is coming and pick their fights.',
    start: 'Arrakeen with 10 troops, 10 in reserve, 10 spice. Ornithopters from Arrakeen. 2 free revivals a turn.',
    powers: [
      'Battle Prescience: before each battle, see one part of the opponent’s plan (leader, weapon, defence or troops dialled). Works in an ally’s battles too.',
      'Spice foresight: sees where the next Spice Blow lands (or that a worm is coming) right after each Spice Blow.',
      'Auction foresight: sees every treachery card before bidding on it.',
      'Kwisatz Haderach: after losing 7 troops in battle, adds +2 to one battle each turn, and the leader it goes with can never turn traitor.'
    ],
    push: [
      'Ask for the element that changes your plan: their defence tells you which weapon gets through; their leader tells you whether your traitor fires.',
      'Bid hard on cards you know are strong, and let the worthless ones go cheap to others.',
      'Move onto foreseen spice before anyone else knows it is coming.',
      'Hold Arrakeen: it gives ornithopters (move 3) and is often the stronghold that decides the game.'
    ],
    ally: ['Prescience in the ally’s battles: they see one part of the opponent’s plan before fighting.'],
    counter: [
      'Vary your battle plans and carry both defence types, so a single revealed element doesn’t sink you.',
      'Atreides are thin on troops: sustained pressure on Arrakeen wears them down.',
      'Assume they know the next spice location: contest it rather than race them to it.'
    ]
  },
  harkonnen: {
    title: 'House Harkonnen',
    tagline: 'Treachery in bulk. Every battle is a lottery they rig.',
    start: 'Carthag with 10 troops, 10 in reserve, 10 spice. Ornithopters from Carthag. 2 free revivals a turn.',
    powers: [
      'Keeps all 4 traitor cards (everyone else keeps 1). Also usable in an ally’s battles.',
      'Draws a free bonus card with every treachery card bought; hand limit of 8.',
      'Captures a random leader from any faction it beats: kill it for 2 spice, or use it for one battle before it goes home.'
    ],
    push: [
      'Fight often: with four traitors, a fair share of battles are won before they start.',
      'Buy cards freely: each purchase is two cards, feeding bluffs and several battles.',
      'Keep strong captured leaders to fight with, but never against their original owner (they turn traitor).',
      'Use Carthag’s ornithopters to strike wherever their traitors’ owners are fighting.'
    ],
    ally: ['Harkonnen traitors work in the ally’s battles: if the opponent plays a leader Harkonnen holds as a traitor, it can be revealed for an outright win.'],
    counter: [
      'Lead with a Cheap Hero or a low-value leader against them: less to lose to a traitor, and nothing to capture.',
      'Avoid needless battles with Harkonnen; each one risks a traitor and a captured leader.',
      'If they capture one of your leaders, it stays loyal to you: face that leader with it on their side and it betrays them.'
    ]
  },
  emperor: {
    title: 'The Emperor',
    tagline: 'Wealth and the Sardaukar. Every bid you make pays them.',
    start: '20 troops in reserve including 5 Sardaukar, nothing on the board, 10 spice. 1 free revival a turn.',
    powers: [
      'Receives the spice other factions pay for treachery cards (the Emperor’s own purchases go to the bank).',
      'Sardaukar: 5 elite troops worth 2 each in battle (only 1 against the Fremen).',
      'At most one Sardaukar can be revived each turn.'
    ],
    push: [
      'Ship Sardaukar early to one stronghold and back them with spice: few forces can match them.',
      'Spend freely: the Emperor’s income comes from everyone else’s bidding.',
      'Push auction prices up to drain rivals, since their spending funds you.'
    ],
    ally: ['The Emperor can pay for up to 3 extra revivals for the ally each turn, beyond the normal limit.'],
    counter: [
      'Bid less, or let the Emperor overpay: every spice you pay at auction goes to them.',
      'Fight the Sardaukar with the Fremen, where they count as ordinary troops.',
      'The Emperor starts off the board: contest the first stronghold they ship into before they dig in.'
    ]
  },
  fremen: {
    title: 'The Fremen',
    tagline: 'The desert is theirs. They win by lasting.',
    start: '10 troops split as you choose between Sietch Tabr, False Wall South and False Wall West; 10 in reserve including 3 Fedaykin; 3 spice. 3 free revivals a turn.',
    powers: [
      'Move 2 territories (3 with ornithopters); ship free onto the Great Flat or within two territories of it.',
      'Worms never eat Fremen troops (or their ally’s); Fremen caught by a worm may ride it anywhere on the map.',
      'Fedaykin: 3 elite troops worth 2 each in battle.',
      'Fremen troops fight at full strength without spice: never pay to back them in battle.',
      'Control the storm: they secretly foresee the next Storm card.',
      'Special victory on the last turn: Sietch Tabr and Habbanya Sietch held by the Fremen (or empty), and no Harkonnen, Atreides or Emperor troops in Tuek’s Sietch.'
    ],
    push: [
      'Stay alive and unthreatening until the late game, then make the special victory come true.',
      'Keep both sietches clear of rivals, and keep an eye on who is in Tuek’s Sietch.',
      'Use free shipping and worm rides to appear where others can’t reach.',
      'Save Fedaykin for the battles that decide a sietch.'
    ],
    ally: ['Worms never eat the ally’s troops.', 'The ally revives 3 troops free each turn.', 'The ally shares the Fremen special victory.'],
    counter: [
      'On the last turns, one Harkonnen, Atreides or Emperor troop in Tuek’s Sietch blocks their special victory.',
      'Occupy a sietch late: any other faction in Sietch Tabr or Habbanya Sietch also blocks it.',
      'The Fremen are spice-poor: fight them on the auction and in battles that need spice.'
    ]
  },
  guild: {
    title: 'The Spacing Guild',
    tagline: 'Control of space. They profit from everyone’s movement.',
    start: 'Tuek’s Sietch with 5 troops, 15 in reserve, 5 spice. 1 free revival a turn.',
    powers: [
      'Ships at half price (rounded up); so does the Guild’s ally.',
      'May ship troops across the planet (territory to territory) or back to reserves (1 spice per 2 troops) instead of from reserves.',
      'May take its Shipment and Movement turn at any point in the order, for example last, after seeing everyone else move.',
      'Receives the spice other factions pay to ship.',
      'Special victory: if nobody has won by the end of the last turn, the Guild win, together with their ally.'
    ],
    push: [
      'Stay rich and patient: every shipment others make funds you.',
      'Deny whoever is closest to winning; a game with no winner is a Guild win.',
      'Make allies: your default victory is shared, which makes you an attractive partner late on.'
    ],
    ally: ['The ally ships at half price.', 'The ally shares the Guild’s “nobody won” victory at the end of the game.'],
    counter: [
      'Someone has to actually win: coordinate to push a real victory before the last turn.',
      'Ship less or move by land where you can: every shipment pays the Guild.',
      'If you are the Guild’s ally, you share their default win; breaking with them late gives it away.'
    ]
  },
  gesserit: {
    title: 'The Bene Gesserit',
    tagline: 'Hidden hands. They win through someone else.',
    start: '1 troop in the Polar Sink, 19 in reserve, 5 spice. Always receive 2 spice of charity. 1 free revival a turn.',
    powers: [
      'Secret Prediction: name a faction and a turn at the start. If that faction wins on that turn (even with Bene Gesserit as its ally), Bene Gesserit win alone instead. Doesn’t count for the Fremen or Guild special victories.',
      'The Voice: before a battle, command the opponent to play, or not to play, one kind of card. Works in an ally’s battles too.',
      'Spiritual Advisors: whenever another faction ships in from off-planet, place 1 troop in the Polar Sink for free.',
      'Any worthless card can be played as a Karama.',
      'Not yet in this version: advisors as peaceful, non-fighting troops.'
    ],
    push: [
      'Help your predicted faction win on exactly the predicted turn, and slow them down if they are early.',
      'Use the Voice on the card that decides the battle: forbid the defence your weapon needs to beat.',
      'Stay small and unthreatening; your strength is in other people’s battles.'
    ],
    ally: ['The Voice in the ally’s battles.', 'Careful: if the ally wins on the turn Bene Gesserit secretly predicted for them, Bene Gesserit win alone instead.'],
    counter: [
      'Their Prediction is secret: be wary of a faction that seems oddly helped along.',
      'Carry more than one kind of weapon and defence, so the Voice can’t strip your whole plan.',
      'They are rarely strong on the board: pressure their few troops early.'
    ]
  }
};

// True of every alliance.
export const ALLIANCE_BASICS = [
  'You win together with 4 strongholds between you.',
  'You can pledge spice to help pay for each other’s cards and shipments.',
  'You cannot move into each other’s territories (except the Polar Sink), and you never fight each other.'
];

export const GUIDE_ORDER = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit'];
