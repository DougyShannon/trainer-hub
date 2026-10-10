// The battle simulator's computer opponents: Paldea's eight Gym Leaders, the Elite Four, Geeta and
// Nemona, then one super-competitive team per format. Teams are in Pokémon Showdown's text format,
// so anyone can paste them into the Team Builder or Showdown. Each team is legal in every format it
// is used in (checked by scripts/check-battle-teams.mjs). Later opponents have stronger sets
// and a smarter computer player.

export type BattleFormatId = "gen9ou" | "gen9doublesou" | "gen9customgame" | "gen9doublescustomgame" | "gen9vgc2025regi";

export type BattleFormat = { id: BattleFormatId; label: string; doubles: boolean; blurb: string };

/** The formats the computer can play. Other Team Builder formats can still be played as Wild. */
export const BATTLE_FORMATS: BattleFormat[] = [
  { id: "gen9ou", label: "Singles OU", doubles: false, blurb: "Smogon's main singles tier, level 100." },
  { id: "gen9doublesou", label: "Doubles OU", doubles: true, blurb: "Smogon's main doubles tier, two Pokémon out at once." },
  { id: "gen9customgame", label: "Wild Singles", doubles: false, blurb: "Anything goes, one at a time." },
  { id: "gen9doublescustomgame", label: "Wild Doubles", doubles: true, blurb: "Anything goes, two at a time." },
  { id: "gen9vgc2025regi", label: "VGC 2025 Reg I", doubles: true, blurb: "Official tournament rules: bring 6, pick 4, level 50." },
];

export const battleFormat = (id: unknown) => BATTLE_FORMATS.find((f) => f.id === id);

/** How clever the computer is. 1 picks strong moves with some mistakes; 3 also switches, sets up and predicts. */
export type AiSkill = 1 | 2 | 3;

export type BattleOpponent = {
  id: string;
  /** Position on the ladder, from 1. Beating one unlocks the next. */
  level: number;
  name: string;
  title: string;
  /** Stadium shown behind the battle by default (see client/battle/stadiums.ts). */
  stadium: string;
  /** Species shown as their picture, and its National Pokédex number (for the fallback sprite). */
  ace: string;
  aceDex: number;
  blurb: string;
  skill: AiSkill;
  /** Team in Showdown's text format. The super-competitive opponent has one per format. */
  team: string | Partial<Record<BattleFormatId, string>>;
};

const KATY = `Lokix @ Silver Powder
Ability: Tinted Lens
EVs: 1 HP
Tera Type: Bug
- First Impression
- Sucker Punch
- Leech Life
- Throat Chop

Spidops @ Sitrus Berry
Ability: Insomnia
EVs: 1 HP
Tera Type: Bug
- Circle Throw
- Sticky Web
- Silk Trap
- Lunge

Forretress @ Leftovers
Ability: Sturdy
EVs: 1 HP
Tera Type: Bug
- Spikes
- Rapid Spin
- Gyro Ball
- Volt Switch

Vespiquen @ Oran Berry
Ability: Pressure
EVs: 1 HP
Tera Type: Bug
- Air Slash
- Bug Buzz
- Protect
- Roost

Lurantis @ Miracle Seed
Ability: Contrary
EVs: 1 HP
Tera Type: Bug
- Leaf Storm
- X-Scissor
- Night Slash
- Synthesis

Ursaring @ Silk Scarf
Ability: Guts
EVs: 1 HP
Tera Type: Bug
- Facade
- Crunch
- Play Rough
- Protect`;

const BRASSIUS = `Sudowoodo @ Rocky Helmet
Ability: Sturdy
EVs: 1 HP
Tera Type: Grass
- Rock Slide
- Wood Hammer
- Sucker Punch
- Stealth Rock

Breloom @ Focus Sash
Ability: Technician
EVs: 1 HP
Tera Type: Grass
- Mach Punch
- Bullet Seed
- Swords Dance
- Rock Tomb

Arboliva @ Leftovers
Ability: Seed Sower
EVs: 1 HP
Tera Type: Grass
- Giga Drain
- Hyper Voice
- Leech Seed
- Protect

Sunflora @ Miracle Seed
Ability: Chlorophyll
EVs: 1 HP
Tera Type: Grass
- Solar Beam
- Sunny Day
- Earth Power
- Sludge Bomb

Bellossom @ Sitrus Berry
Ability: Chlorophyll
EVs: 1 HP
Tera Type: Grass
- Quiver Dance
- Giga Drain
- Moonblast
- Strength Sap

Toedscruel @ Black Sludge
Ability: Mycelium Might
EVs: 1 HP
Tera Type: Grass
- Toxic Spikes
- Giga Drain
- Earth Power
- Rapid Spin`;

const IONO = `Wattrel @ Oran Berry
Ability: Volt Absorb
EVs: 1 HP
Tera Type: Electric
- Spark
- Air Slash
- Quick Attack
- Uproar

Bellibolt @ Leftovers
Ability: Electromorphosis
EVs: 128 HP / 128 SpA
Modest Nature
Tera Type: Electric
- Discharge
- Muddy Water
- Slack Off
- Toxic

Luxray @ Choice Band
Ability: Intimidate
EVs: 128 Atk / 128 Spe
Adamant Nature
Tera Type: Electric
- Wild Charge
- Crunch
- Ice Fang
- Play Rough

Mismagius @ Sitrus Berry
Ability: Levitate
EVs: 128 SpA / 128 Spe
Timid Nature
Tera Type: Electric
- Shadow Ball
- Dazzling Gleam
- Thunderbolt
- Nasty Plot

Kilowattrel @ Heavy-Duty Boots
Ability: Volt Absorb
EVs: 128 SpA / 128 Spe
Timid Nature
Tera Type: Electric
- Thunderbolt
- Hurricane
- Volt Switch
- Roost

Rotom-Wash @ Rocky Helmet
Ability: Levitate
EVs: 128 HP / 128 Def
Bold Nature
Tera Type: Electric
- Hydro Pump
- Volt Switch
- Will-O-Wisp
- Protect`;

const KOFU = `Veluza @ Choice Band
Ability: Sharpness
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Water
- Aqua Cutter
- Psycho Cut
- Night Slash
- Aqua Jet

Wugtrio @ Focus Sash
Ability: Gooey
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Water
- Liquidation
- Sucker Punch
- Memento
- Stomping Tantrum

Crabominable @ Assault Vest
Ability: Iron Fist
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Water
- Drain Punch
- Ice Hammer
- Crabhammer
- Earthquake

Pelipper @ Damp Rock
Ability: Drizzle
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
Tera Type: Water
- Hurricane
- Weather Ball
- U-turn
- Roost

Golduck @ Life Orb
Ability: Swift Swim
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
Tera Type: Water
- Hydro Pump
- Ice Beam
- Focus Blast
- Calm Mind

Clawitzer @ Mystic Water
Ability: Mega Launcher
EVs: 252 HP / 252 SpA / 4 SpD
Modest Nature
Tera Type: Water
- Water Pulse
- Aura Sphere
- Dark Pulse
- U-turn`;

const LARRY = `Komala @ Life Orb
Ability: Comatose
EVs: 252 Atk / 4 SpD / 252 Spe
Adamant Nature
Tera Type: Normal
- Double-Edge
- Earthquake
- Sucker Punch
- Knock Off

Dudunsparce @ Leftovers
Ability: Serene Grace
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
Tera Type: Normal
- Hyper Drill
- Glare
- Roost
- Dragon Tail

Staraptor @ Choice Scarf
Ability: Reckless
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Normal
- Brave Bird
- Double-Edge
- Close Combat
- U-turn

Maushold @ Wide Lens
Ability: Technician
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Normal
- Population Bomb
- Bite
- Follow Me
- Protect

Indeedee-F @ Psychic Seed
Ability: Psychic Surge
EVs: 252 HP / 252 SpA / 4 SpD
Modest Nature
Tera Type: Normal
- Psychic
- Hyper Voice
- Follow Me
- Calm Mind

Ursaluna @ Flame Orb
Ability: Guts
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Normal
- Facade
- Headlong Rush
- Fire Punch
- Swords Dance`;

const RYME = `Mimikyu @ Life Orb
Ability: Disguise
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Ghost
- Swords Dance
- Shadow Claw
- Play Rough
- Shadow Sneak

Houndstone @ Choice Band
Ability: Fluffy
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Ghost
- Phantom Force
- Body Press
- Play Rough
- Trick

Toxtricity @ Throat Spray
Ability: Punk Rock
EVs: 252 SpA / 4 SpD / 252 Spe
Modest Nature
Tera Type: Ghost
- Boomburst
- Overdrive
- Sludge Bomb
- Volt Switch

Banette @ Sitrus Berry
Ability: Frisk
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Ghost
- Poltergeist
- Gunk Shot
- Shadow Sneak
- Will-O-Wisp

Gengar @ Focus Sash
Ability: Cursed Body
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
Tera Type: Ghost
- Shadow Ball
- Sludge Wave
- Focus Blast
- Encore

Ceruledge @ Weakness Policy
Ability: Flash Fire
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Ghost
- Bitter Blade
- Poltergeist
- Swords Dance
- Shadow Sneak`;

const TULIP = `Farigiraf @ Sitrus Berry
Ability: Armor Tail
EVs: 252 HP / 252 SpA / 4 SpD
Quiet Nature
IVs: 0 Spe
Tera Type: Psychic
- Psychic
- Hyper Voice
- Trick Room
- Protect

Bruxish @ Mystic Water
Ability: Strong Jaw
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Psychic
- Psychic Fangs
- Wave Crash
- Ice Fang
- Aqua Jet

Gardevoir @ Choice Scarf
Ability: Trace
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
Tera Type: Psychic
- Moonblast
- Psychic
- Mystical Fire
- Trick

Florges @ Leftovers
Ability: Flower Veil
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
Tera Type: Psychic
- Moonblast
- Calm Mind
- Synthesis
- Protect

Gallade @ Lum Berry
Ability: Sharpness
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Psychic
- Sacred Sword
- Psycho Cut
- Leaf Blade
- Swords Dance

Hatterene @ Life Orb
Ability: Magic Bounce
EVs: 252 HP / 252 SpA / 4 SpD
Quiet Nature
IVs: 0 Spe
Tera Type: Psychic
- Psyshock
- Draining Kiss
- Mystical Fire
- Trick Room`;

const GRUSHA = `Frosmoth @ Heavy-Duty Boots
Ability: Ice Scales
EVs: 252 HP / 4 SpA / 252 Spe
Timid Nature
Tera Type: Ice
- Quiver Dance
- Ice Beam
- Bug Buzz
- Giga Drain

Beartic @ Choice Band
Ability: Swift Swim
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Ice
- Icicle Crash
- Close Combat
- Aqua Jet
- Earthquake

Cetitan @ Sitrus Berry
Ability: Thick Fat
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Ice
- Ice Spinner
- Earthquake
- Belly Drum
- Ice Shard

Altaria @ Leftovers
Ability: Natural Cure
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
Tera Type: Ice
- Hurricane
- Ice Beam
- Roost
- Will-O-Wisp

Abomasnow @ Light Clay
Ability: Snow Warning
EVs: 252 HP / 252 SpA / 4 SpD
Modest Nature
Tera Type: Ice
- Blizzard
- Giga Drain
- Aurora Veil
- Earth Power

Weavile @ Life Orb
Ability: Pressure
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Ice
- Triple Axel
- Knock Off
- Ice Shard
- Low Kick`;

const RIKA = `Clodsire @ Leftovers
Ability: Unaware
EVs: 252 HP / 4 Def / 252 SpD
Careful Nature
Tera Type: Ground
- Earthquake
- Toxic
- Recover
- Stealth Rock

Donphan @ Assault Vest
Ability: Sturdy
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Ground
- Earthquake
- Knock Off
- Ice Shard
- Rapid Spin

Whiscash @ Sitrus Berry
Ability: Oblivious
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Ground
- Liquidation
- Earthquake
- Dragon Dance
- Stone Edge

Camerupt @ Choice Specs
Ability: Solid Rock
EVs: 252 HP / 252 SpA / 4 SpD
Modest Nature
Tera Type: Ground
- Earth Power
- Fire Blast
- Eruption
- Ancient Power

Dugtrio @ Focus Sash
Ability: Sand Force
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Ground
- Earthquake
- Sucker Punch
- Stone Edge
- Memento

Garchomp @ Rocky Helmet
Ability: Rough Skin
EVs: 252 HP / 4 Atk / 252 Spe
Jolly Nature
Tera Type: Ground
- Earthquake
- Dragon Tail
- Stealth Rock
- Spikes`;

const POPPY = `Copperajah @ Sitrus Berry
Ability: Sheer Force
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Steel
- Iron Head
- Heavy Slam
- Play Rough
- Earthquake

Magnezone @ Choice Specs
Ability: Magnet Pull
EVs: 252 SpA / 4 SpD / 252 Spe
Modest Nature
Tera Type: Steel
- Thunderbolt
- Flash Cannon
- Volt Switch
- Body Press

Bronzong @ Leftovers
Ability: Levitate
EVs: 252 HP / 252 Def / 4 SpD
Relaxed Nature
IVs: 0 Spe
Tera Type: Steel
- Gyro Ball
- Stealth Rock
- Trick Room
- Body Press

Corviknight @ Rocky Helmet
Ability: Pressure
EVs: 252 HP / 252 Def / 4 SpD
Impish Nature
Tera Type: Steel
- Brave Bird
- Defog
- Roost
- U-turn

Tinkaton @ Air Balloon
Ability: Mold Breaker
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Steel
- Gigaton Hammer
- Play Rough
- Knock Off
- Stealth Rock

Scizor @ Choice Band
Ability: Technician
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Steel
- Bullet Punch
- U-turn
- Close Combat
- Knock Off`;

const LARRY_E4 = `Staraptor @ Choice Band
Ability: Reckless
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Flying
- Brave Bird
- Double-Edge
- Close Combat
- U-turn

Flamigo @ Choice Scarf
Ability: Scrappy
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Flying
- Brave Bird
- Close Combat
- U-turn
- Throat Chop

Tropius @ Sitrus Berry
Ability: Harvest
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
Tera Type: Flying
- Air Slash
- Giga Drain
- Leech Seed
- Protect

Oricorio-Pom-Pom @ Heavy-Duty Boots
Ability: Dancer
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
Tera Type: Flying
- Revelation Dance
- Hurricane
- Quiver Dance
- Roost

Dragonite @ Lum Berry
Ability: Multiscale
EVs: 252 Atk / 4 SpD / 252 Spe
Adamant Nature
Tera Type: Normal
- Dragon Dance
- Extreme Speed
- Earthquake
- Fire Punch

Talonflame @ Sharp Beak
Ability: Gale Wings
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Flying
- Brave Bird
- Flare Blitz
- Swords Dance
- Roost`;

const HASSEL = `Noivern @ Choice Specs
Ability: Infiltrator
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
Tera Type: Dragon
- Draco Meteor
- Hurricane
- Flamethrower
- U-turn

Haxorus @ Life Orb
Ability: Mold Breaker
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Dragon
- Dragon Dance
- Outrage
- Close Combat
- Earthquake

Dragalge @ Black Sludge
Ability: Adaptability
EVs: 252 HP / 252 SpA / 4 SpD
Modest Nature
Tera Type: Dragon
- Draco Meteor
- Sludge Bomb
- Flip Turn
- Toxic Spikes

Flapple @ Sitrus Berry
Ability: Hustle
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Dragon
- Grav Apple
- Dragon Rush
- Dragon Dance
- U-turn

Kingdra @ Wise Glasses
Ability: Swift Swim
EVs: 252 SpA / 4 SpD / 252 Spe
Modest Nature
Tera Type: Dragon
- Draco Meteor
- Hydro Pump
- Surf
- Ice Beam

Tatsugiri @ Focus Sash
Ability: Storm Drain
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
Tera Type: Dragon
- Draco Meteor
- Muddy Water
- Rapid Spin
- Nasty Plot`;

const GEETA = `Hydreigon @ Choice Specs
Ability: Levitate
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
Tera Type: Dark
- Draco Meteor
- Dark Pulse
- Flash Cannon
- U-turn

Gogoat @ Leftovers
Ability: Sap Sipper
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Grass
- Horn Leech
- Bulk Up
- Earthquake
- Milk Drink

Veluza @ Life Orb
Ability: Sharpness
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Water
- Fillet Away
- Aqua Cutter
- Psycho Cut
- Aqua Jet

Avalugg @ Rocky Helmet
Ability: Sturdy
EVs: 252 HP / 252 Def / 4 SpD
Impish Nature
Tera Type: Ice
- Avalanche
- Body Press
- Rapid Spin
- Recover

Glimmora @ Focus Sash
Ability: Toxic Debris
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
Tera Type: Rock
- Power Gem
- Sludge Wave
- Earth Power
- Stealth Rock

Kingambit @ Black Glasses
Ability: Supreme Overlord
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Dark
- Swords Dance
- Kowtow Cleave
- Iron Head
- Sucker Punch`;

const NEMONA = `Lycanroc-Dusk @ Life Orb
Ability: Tough Claws
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Rock
- Accelerock
- Stone Edge
- Close Combat
- Psychic Fangs

Goodra @ Assault Vest
Ability: Sap Sipper
EVs: 252 HP / 252 SpA / 4 SpD
Modest Nature
Tera Type: Dragon
- Draco Meteor
- Fire Blast
- Thunderbolt
- Sludge Bomb

Orthworm @ Leftovers
Ability: Earth Eater
EVs: 252 HP / 4 Def / 252 SpD
Careful Nature
Tera Type: Steel
- Body Press
- Iron Defense
- Iron Head
- Rest

Pawmot @ Sitrus Berry
Ability: Volt Absorb
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Electric
- Double Shock
- Close Combat
- Revival Blessing
- Ice Punch

Meowscarada @ Choice Band
Ability: Protean
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Grass
- Flower Trick
- Knock Off
- U-turn
- Triple Axel

Dudunsparce @ Choice Scarf
Ability: Serene Grace
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Normal
- Hyper Drill
- Earthquake
- Poison Jab
- Dragon Tail`;

const BOSS_OU = `Great Tusk @ Booster Energy
Ability: Protosynthesis
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Steel
- Headlong Rush
- Ice Spinner
- Rapid Spin
- Knock Off

Kingambit @ Leftovers
Ability: Supreme Overlord
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Dark
- Swords Dance
- Kowtow Cleave
- Iron Head
- Sucker Punch

Gholdengo @ Choice Scarf
Ability: Good as Gold
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
Tera Type: Steel
- Make It Rain
- Shadow Ball
- Trick
- Focus Blast

Dragapult @ Choice Specs
Ability: Infiltrator
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
Tera Type: Ghost
- Draco Meteor
- Shadow Ball
- Flamethrower
- U-turn

Dragonite @ Heavy-Duty Boots
Ability: Multiscale
EVs: 252 Atk / 4 SpD / 252 Spe
Adamant Nature
Tera Type: Normal
- Dragon Dance
- Extreme Speed
- Earthquake
- Roost

Ting-Lu @ Leftovers
Ability: Vessel of Ruin
EVs: 252 HP / 4 Def / 252 SpD
Careful Nature
Tera Type: Poison
- Stealth Rock
- Ruination
- Earthquake
- Whirlwind`;

const BOSS_DOU = `Rillaboom @ Assault Vest
Ability: Grassy Surge
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Fire
- Fake Out
- Grassy Glide
- Wood Hammer
- U-turn

Incineroar @ Safety Goggles
Ability: Intimidate
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
Tera Type: Ghost
- Fake Out
- Knock Off
- Flare Blitz
- Parting Shot

Amoonguss @ Rocky Helmet
Ability: Regenerator
EVs: 252 HP / 252 Def / 4 SpD
Relaxed Nature
IVs: 0 Atk / 0 Spe
Tera Type: Water
- Spore
- Rage Powder
- Pollen Puff
- Protect

Kingambit @ Black Glasses
Ability: Defiant
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
Tera Type: Flying
- Kowtow Cleave
- Sucker Punch
- Iron Head
- Protect

Tornadus @ Covert Cloak
Ability: Prankster
EVs: 252 HP / 4 SpA / 252 Spe
Timid Nature
Tera Type: Ghost
- Tailwind
- Bleakwind Storm
- Taunt
- Protect

Gholdengo @ Life Orb
Ability: Good as Gold
EVs: 4 HP / 252 SpA / 252 Spe
Timid Nature
Tera Type: Water
- Make It Rain
- Shadow Ball
- Nasty Plot
- Protect`;

const BOSS_VGC = `Miraidon @ Choice Specs
Ability: Hadron Engine
Level: 50
EVs: 4 HP / 252 SpA / 252 Spe
Timid Nature
Tera Type: Electric
- Electro Drift
- Draco Meteor
- Volt Switch
- Dazzling Gleam

Calyrex-Shadow @ Focus Sash
Ability: As One (Spectrier)
Level: 50
EVs: 4 HP / 252 SpA / 252 Spe
Timid Nature
Tera Type: Fairy
- Astral Barrage
- Psyshock
- Nasty Plot
- Protect

Incineroar @ Safety Goggles
Ability: Intimidate
Level: 50
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
Tera Type: Ghost
- Fake Out
- Knock Off
- Flare Blitz
- Parting Shot

Urshifu-Rapid-Strike @ Mystic Water
Ability: Unseen Fist
Level: 50
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
Tera Type: Water
- Surging Strikes
- Close Combat
- Aqua Jet
- Protect

Amoonguss @ Rocky Helmet
Ability: Regenerator
Level: 50
EVs: 252 HP / 252 Def / 4 SpD
Relaxed Nature
IVs: 0 Atk / 0 Spe
Tera Type: Water
- Spore
- Rage Powder
- Pollen Puff
- Protect

Farigiraf @ Sitrus Berry
Ability: Armor Tail
Level: 50
EVs: 252 HP / 4 Def / 252 SpD
Calm Nature
IVs: 0 Atk
Tera Type: Fairy
- Psychic
- Hyper Voice
- Trick Room
- Helping Hand`;

const BOSS_WILD = `Koraidon @ Choice Scarf
Ability: Orichalcum Pulse
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Fire
- Collision Course
- Flare Blitz
- U-turn
- Outrage

Calyrex-Shadow @ Life Orb
Ability: As One (Spectrier)
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
Tera Type: Ghost
- Astral Barrage
- Psyshock
- Nasty Plot
- Pollen Puff

Zacian-Crowned @ Rusted Sword
Ability: Intrepid Sword
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
Tera Type: Fairy
- Behemoth Blade
- Play Rough
- Close Combat
- Swords Dance

Arceus @ Leftovers
Ability: Multitype
EVs: 252 HP / 4 Def / 252 Spe
Jolly Nature
Tera Type: Normal
- Extreme Speed
- Swords Dance
- Shadow Claw
- Recover

Eternatus @ Power Herb
Ability: Pressure
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
Tera Type: Dragon
- Meteor Beam
- Dynamax Cannon
- Sludge Bomb
- Flamethrower

Kyogre @ Choice Specs
Ability: Drizzle
EVs: 252 SpA / 4 SpD / 252 Spe
Modest Nature
Tera Type: Water
- Water Spout
- Origin Pulse
- Ice Beam
- Thunder`;

export const BATTLE_OPPONENTS: BattleOpponent[] = [
  { id: "katy", level: 1, name: "Katy", title: "Cortondo Gym Leader", stadium: "cortondo-gym", ace: "Lokix", aceDex: 920, skill: 1, team: KATY,
    blurb: "A sweet-natured baker who loves Bug types. A gentle start: her Pokémon have no training yet." },
  { id: "brassius", level: 2, name: "Brassius", title: "Artazon Gym Leader", stadium: "artazon-gym", ace: "Sudowoodo", aceDex: 185, skill: 1, team: BRASSIUS,
    blurb: "An artist whose Grass types love the sun. Watch out for Leech Seed and Swords Dance Breloom." },
  { id: "iono", level: 3, name: "Iono", title: "Levincia Gym Leader", stadium: "levincia-gym", ace: "Bellibolt", aceDex: 939, skill: 1, team: IONO,
    blurb: "Streamer and Electric-type star. Her team has started training." },
  { id: "kofu", level: 4, name: "Kofu", title: "Cascarrafa Gym Leader", stadium: "cascarrafa-gym", ace: "Veluza", aceDex: 976, skill: 2, team: KOFU,
    blurb: "A chef with fully trained Water types and a rain setter. He picks his moves carefully." },
  { id: "larry", level: 5, name: "Larry", title: "Medali Gym Leader", stadium: "medali-gym", ace: "Komala", aceDex: 775, skill: 2, team: LARRY,
    blurb: "A tired office worker with surprisingly hard-hitting Normal types." },
  { id: "ryme", level: 6, name: "Ryme", title: "Montenevera Gym Leader", stadium: "montenevera-gym", ace: "Toxtricity", aceDex: 849, skill: 2, team: RYME,
    blurb: "A rapper whose Ghost types hit hard and fast." },
  { id: "tulip", level: 7, name: "Tulip", title: "Alfornada Gym Leader", stadium: "alfornada-gym", ace: "Farigiraf", aceDex: 981, skill: 2, team: TULIP,
    blurb: "A make-up artist who loves Psychic types and Trick Room." },
  { id: "grusha", level: 8, name: "Grusha", title: "Glaseado Gym Leader", stadium: "glaseado-gym", ace: "Altaria", aceDex: 334, skill: 2, team: GRUSHA,
    blurb: "A former snowboarder. Snow, Aurora Veil and a Belly Drum Cetitan." },
  { id: "rika", level: 9, name: "Rika", title: "Elite Four", stadium: "paldea-league", ace: "Clodsire", aceDex: 980, skill: 3, team: RIKA,
    blurb: "The first of the Elite Four. Ground types, hazards and a computer that switches like a real player." },
  { id: "poppy", level: 10, name: "Poppy", title: "Elite Four", stadium: "paldea-league", ace: "Tinkaton", aceDex: 959, skill: 3, team: POPPY,
    blurb: "The youngest of the Elite Four, with tough Steel types." },
  { id: "larry-e4", level: 11, name: "Larry", title: "Elite Four", stadium: "paldea-league", ace: "Staraptor", aceDex: 398, skill: 3, team: LARRY_E4,
    blurb: "Larry again, this time with Flying types and a Dragon Dance Dragonite." },
  { id: "hassel", level: 12, name: "Hassel", title: "Elite Four", stadium: "paldea-league", ace: "Noivern", aceDex: 715, skill: 3, team: HASSEL,
    blurb: "The art teacher and last of the Elite Four. Dragons everywhere." },
  { id: "geeta", level: 13, name: "Geeta", title: "Top Champion", stadium: "paldea-league", ace: "Glimmora", aceDex: 970, skill: 3, team: GEETA,
    blurb: "Paldea's Top Champion. Beat her to become a Champion yourself." },
  { id: "nemona", level: 14, name: "Nemona", title: "Champion rival", stadium: "paldea-league", ace: "Pawmot", aceDex: 923, skill: 3, team: NEMONA,
    blurb: "Your battle-mad rival, already a Champion. She's been waiting for this." },
  { id: "pro", level: 15, name: "The Pro", title: "Super-competitive team", stadium: "battle-stadium", ace: "Kingambit", aceDex: 983, skill: 3,
    team: { gen9ou: BOSS_OU, gen9doublesou: BOSS_DOU, gen9vgc2025regi: BOSS_VGC, gen9customgame: BOSS_WILD, gen9doublescustomgame: BOSS_WILD },
    blurb: "A real tournament-style team for this format, played as well as the computer can. The final boss." },
];

export const battleOpponent = (id: unknown) => BATTLE_OPPONENTS.find((o) => o.id === id);

/** The opponent's team for a format, in Showdown's text format. */
export function opponentTeam(o: BattleOpponent, format: BattleFormatId): string {
  return typeof o.team === "string" ? o.team : (o.team[format] ?? Object.values(o.team)[0]!);
}

/** Loan teams for trainers who haven't built one yet: a few of the opponents' teams. */
export const LOAN_TEAMS: { id: string; name: string; from: string }[] = [
  { id: "loan-kofu", name: "Kofu's rain team", from: "kofu" },
  { id: "loan-ryme", name: "Ryme's Ghost team", from: "ryme" },
  { id: "loan-geeta", name: "Geeta's Champion team", from: "geeta" },
  { id: "loan-pro", name: "The Pro's team", from: "pro" },
];
