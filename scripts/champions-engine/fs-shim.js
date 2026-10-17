// The simulator only lists data/mods; this engine ships one mod.
export function readdirSync() {
  return ["champions"];
}
export function existsSync() {
  return false;
}
export default { readdirSync, existsSync };
