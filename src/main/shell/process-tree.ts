// Ends a shell's commands along with it. Killing bash alone leaves the command it was
// running, and anything that command started, alive and reparented (SPEC §6.3.8:
// a restart must not leave a server holding its port). No Electron imports.

import { execFileSync } from "node:child_process";

// How long a process gets to exit on SIGHUP and SIGTERM before SIGKILL.
const GRACE_MS = 2000;

export interface ProcessTree {
  pids: number[]; // every descendant of the root, not the root itself
  groups: number[]; // their process groups, without the caller's own
}

// Reads `ps -A -o pid=,ppid=,pgid=` output: the descendants of `root`, and the process
// groups to signal. A job started with job control has a group of its own, which also
// holds children that left the tree (reparented after their parent exited).
export function treeOf(root: number, table: string, ownPid = process.pid): ProcessTree {
  const children = new Map<number, number[]>();
  const groupOf = new Map<number, number>();
  for (const line of table.split("\n")) {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || ppid === undefined || pgid === undefined) continue;
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isInteger(pgid)) continue;
    groupOf.set(pid, pgid);
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const pids: number[] = [];
  const queue = [...(children.get(root) ?? [])];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    if (pids.includes(pid) || pid === ownPid) continue;
    pids.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  const own = groupOf.get(ownPid);
  const groups = [...new Set(pids.map((pid) => groupOf.get(pid) ?? pid))].filter(
    (group) => group !== own && group > 1,
  );
  return { pids, groups };
}

// Sends SIGHUP (what closing a terminal sends) and SIGTERM to every process under
// `root`, then SIGKILL to what is left after a grace period. Call it before killing
// the root: once the root is gone, its children can't be found by parent any more.
export function endTree(root: number): void {
  let tree: ProcessTree;
  try {
    tree = treeOf(
      root,
      execFileSync("ps", ["-A", "-o", "pid=,ppid=,pgid="], { encoding: "utf8", timeout: 2000 }),
    );
  } catch {
    return; // No ps: killing the root is all that can be done.
  }
  const signal = (name: NodeJS.Signals): void => {
    for (const group of tree.groups) send(-group, name);
    for (const pid of tree.pids) send(pid, name);
  };
  signal("SIGHUP");
  signal("SIGTERM");
  setTimeout(() => signal("SIGKILL"), GRACE_MS).unref();
}

function send(target: number, signal: NodeJS.Signals): void {
  try {
    process.kill(target, signal);
  } catch {
    // Already gone.
  }
}
