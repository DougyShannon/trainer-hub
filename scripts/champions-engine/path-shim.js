// Just enough of Node's "path" for the simulator's data lookups.
function norm(p) {
  const out = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}
export function resolve(...parts) {
  let p = "";
  for (const part of parts) p = part.startsWith("/") ? part : `${p}/${part}`;
  return norm(p);
}
export function join(...parts) {
  return norm(parts.join("/"));
}
export function dirname(p) {
  return norm(p).split("/").slice(0, -1).join("/") || "/";
}
export function basename(p) {
  return norm(p).split("/").pop();
}
export default { resolve, join, dirname, basename };
