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
      'Special victory: if nobody has won by the end of the last turn, the Guild win, together with their ally. (Switched off by the current house rules: no turn limit.)'
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
      'Any worthless card can be played as a Karama (worthless cards are currently out of the deck by house rule).',
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

FACTION_GUIDE.ixians = {
  title: 'The Ixians',
  tagline: 'Machines and secrets. Their stronghold moves.',
  start: '10 spice. 3 Cyborgs and 3 Suboids in the Hidden Mobile Stronghold; 4 Cyborgs and 10 Suboids in reserve. 1 free revival a turn.',
  powers: [
    'Hidden Mobile Stronghold: counts towards victory, immune to storm and worms. Before each storm, while you occupy it, move it up to 3 territories, collecting 2 spice per force inside from each spice territory it enters. Only you can ship straight into it.',
    'Cyborgs: worth 2 in battle, move 2, cost 3 spice to revive.',
    'Suboids: worth ½ in battle and never boosted with spice; move 2 alongside a Cyborg, otherwise 1.',
    'Starting draft: you choose your first treachery card from one per faction.',
    'Each auction you see every card plus one extra, and put one back on the deck.',
    'Technology: once each round, swap the card about to be auctioned for one from your hand.',
    'After a battle you win, surviving Suboids can take the place of Cyborgs you lost.',
    'Not yet in this version: your Karama powers.'
  ],
  push: [
    'Park the HMS by the richest spice and sweep it up each turn.',
    'Lead with Cyborgs: they fight at double and drag Suboids along at speed.',
    'You know every auction card: bid only for what you want, and let rivals overpay.'
  ],
  ally: ['After buying a treachery card, the ally may discard it and draw the top card of the deck.'],
  counter: [
    'Enter the HMS from the territory it points at: it is a stronghold anyone can take.',
    'Suboids are weak: force battles where the Ixians have few Cyborgs.',
    'Keep spice away from the HMS\'s reach.'
  ]
};

FACTION_GUIDE.tleilaxu = {
  title: 'The Bene Tleilax',
  tagline: 'Masters of flesh. Death feeds them.',
  start: '20 troops in reserve, nothing on Arrakis, 5 spice. 2 free revivals a turn.',
  powers: [
    'Face Dancers: instead of a traitor, you secretly hold three leaders. When another faction WINS with one of them, reveal it: the win stands, but that leader dies, their remaining troops there go home, and your troops from reserve take their place.',
    'Revival economy: other factions pay you, not the Bank, for revival. You revive with no limit at half price, and take 1 spice whenever someone uses free revival or a Ghola card.',
    'You may raise another faction\'s revival limit from 3 to 5 for the turn (they pay you for it).',
    'Zoal: your leader with no printed value takes the value of the leader he faces.',
    'Face Dancer cycling: once all three are revealed, draw three new ones; at each Mentat Pause you may swap one.',
    'Gholas: with fewer than five active leaders, revive another faction\'s dead leader at half its value to fight for you.',
    'Other factions can ask you to revive one of their leaders early, at a price you name.',
    'Not yet in this version: your Karama powers.'
  ],
  push: [
    'Let others fight: every battle is a chance for a Face Dancer to steal a stronghold.',
    'Keep troops in reserve: a revealed Face Dancer places them straight into the stronghold.',
    'Grow rich on others\' revival, and use it to ship in when the moment comes.'
  ],
  ally: ['The ally revives forces at half price.'],
  counter: [
    'Win battles with leaders the Tleilaxu are unlikely to hold, or with a Cheap Hero (never a Face Dancer).',
    'Every revival you pay funds them: revive with free allowances where you can.',
    'They start with nothing on the board: take the strongholds early.'
  ]
};

FACTION_GUIDE.choam = {
  title: 'CHOAM',
  tagline: 'The Imperium’s purse. Every trade pays them.',
  start: '20 troops in reserve, nothing on Arrakis, 2 spice. No free revival, but no limit and only 1 spice a force. Hand of up to 5 cards.',
  powers: [
    'Charity: before anyone collects CHOAM Charity, you take 2 spice per faction in the game; everyone else\'s charity is then paid from your spice.',
    'Treachery: at the end of any phase, discard duplicates of the same card for 3 spice each (revealing them) and worthless cards for 2 each.',
    'Or play a worthless card for its effect: Baliset (a faction may not move into a territory you hold this turn), Jubba Cloak (shelter one territory from the storm), Kull Wahad (block a Karama as it is played), Kulon (move one extra territory), La La La (a faction may not take free revival), Trip to Gamont (send one enemy force home at the Mentat Pause).',
    'Inflation: once a game, at a Mentat Pause, place Double or Cancel on next turn\'s Charity; it flips the turn after, then leaves the game.',
    'Forces: half (rounded down) of the spice others pay for their forces in battle comes to you, unless a traitor is revealed.',
    'The Auditor: a sixth leader. After a battle it leads, see 2 random cards of your opponent (1 if the Auditor died), unless they pay you 1 spice a card. It can be revived any turn, and cannot be captured or become a Ghola.',
    'Not yet in this version: your Karama power.'
  ],
  push: [
    'Stockpile cards and spice early, then ship in hard once you can win the battles you pick.',
    'Time Inflation: Double when others are rich and you are not, so the flip to Cancel lands when they are poor.',
    'Lead with the Auditor in cheap fights to learn what your rivals hold.'
  ],
  ally: ['Once a turn, trade a treachery card with CHOAM.', 'CHOAM may pay for some or all of your forces in a battle.'],
  counter: [
    'Every spice you pay for forces in battle half-feeds CHOAM: fight with fewer, better-backed forces.',
    'Take charity sparingly when CHOAM is short: it comes out of their purse.',
    'They start with nothing on the board: hold the strongholds before they can afford to ship.'
  ]
};

FACTION_GUIDE.richese = {
  title: 'House Richese',
  tagline: 'Inventors in debt. They sell the future.',
  start: '20 troops in reserve, nothing on Arrakis, 5 spice. 2 free revivals a turn. A separate cache of 10 Richese cards.',
  powers: [
    'Cache auction: every Bidding Round while your cache lasts, one fewer normal card is dealt and you auction one of your cards, first or last, Once Around or Silent. Others pay you; if you keep it, you pay the Emperor or the Bank.',
    'Once Around: one bid each round the table, then you may outbid the winner. Silent: everyone names a price at once. If nobody bids, take it free or remove it.',
    'Cannot occupy Tuek’s Sietch without blocking the Fremen special victory.',
    'No-Field tokens (0, 3, 5): ship one as if it were one force; it counts as one force until revealed, then its number arrive from reserves. Others see only "?". Revealed in battle, by storm or worm, or when you choose.',
    'Black Market: at the start of Bidding, sell a card from your hand, announcing it as anything you like; if it sells, one fewer normal card is auctioned.',
    'Cache cards: Distrans, Juice of Sapho, Mirror Weapon, Portable Snooper, Ornithopter, Nullentropy Box, Semuta Drug, Residual Poison, Stone Burner and a Karama.',
    'Not yet in this version: your Karama power.'
  ],
  push: [
    'Sell your best cards when rivals are rich; Silent auctions drive the price up when two or more can afford it.',
    'Spice from sales is your only steady income: save it for a big shipment.'
  ],
  ally: ['Richese may ship your forces with one of their No-Field tokens (paying for one force; revealed at once).', 'Richese may give you Richese cards from their hand.'],
  counter: [
    'Every cache card you buy funds Richese: buy only what you will use.',
    'They start with nothing on the board: take the strongholds before they can ship.'
  ]
};

// True of every alliance.
export const ALLIANCE_BASICS = [
  'You win together with 4 strongholds between you.',
  'You can pledge spice to help pay for each other’s cards and shipments.',
  'You cannot move into each other’s territories (except the Polar Sink), and you never fight each other.'
];

export const GUIDE_ORDER = ['atreides', 'harkonnen', 'emperor', 'fremen', 'guild', 'gesserit', 'ixians', 'tleilaxu', 'choam', 'richese'];
