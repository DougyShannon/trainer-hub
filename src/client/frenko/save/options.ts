// Game options (just text speed for now). They belong to the device, not to a save file, so they
// stay the same whichever save you load.

export type TextSpeed = "slow" | "mid" | "fast";
export type Options = { textSpeed: TextSpeed };

/** Letters typed per second at each text speed. */
export const TEXT_SPEEDS: Record<TextSpeed, number> = { slow: 25, mid: 50, fast: 150 };

const KEY = "frenko.options";
const DEFAULTS: Options = { textSpeed: "mid" };

export function loadOptions(): Options {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Options> | null;
    const textSpeed = stored?.textSpeed && stored.textSpeed in TEXT_SPEEDS ? stored.textSpeed : DEFAULTS.textSpeed;
    return { textSpeed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveOptions(options: Options) {
  try {
    localStorage.setItem(KEY, JSON.stringify(options));
  } catch {
    // Private browsing can block storage; the options still apply until the page closes.
  }
}
