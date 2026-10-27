import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// The rcfile every session starts with (SPEC §6.2, which explains its shape).
// Keep it verbatim: each line is there for a reason verified against real bash.
export const RCFILE = String.raw`# Load the user's normal environment
[ -f ~/.profile ] && source ~/.profile
[ -f ~/.bashrc ] && source ~/.bashrc

# Silence prompts so only command output is shown
PS1=''
PS2=''
unset HISTFILE

__rb_cur=''

__rb_run() {
  # $1 = run id, $2 = script path
  __rb_cur=$1
  stty echo
  printf '\033]777;rb-start;%s\007' "$1"
  source "$2"
}

# Runs before every prompt, including after Ctrl+C aborts __rb_run,
# so the done marker is always emitted.
__rb_after() {
  local __rb_rc=$?
  # Ignore Ctrl+C until the marker is out: one typed as the run ends would abort
  # this function, and no marker would come. First thing, so the gap is tiny.
  trap '' INT
  stty -echo
  set +e
  # Discard input typed during the run (full or partial lines) so it never
  # executes as a command.
  while read -r -s -t 0.05 -n 4096 _; do :; done
  if [ -n "$__rb_cur" ]; then
    printf '\033]777;rb-done;%s;%d\007' "$__rb_cur" "$__rb_rc"
    __rb_cur=''
  elif [ -z "$__rb_ready" ]; then
    # First prompt: only now is bash actually waiting for input.
    __rb_ready=1
    printf '\033]777;rb-ready\007'
  fi
  # Like set -e, a cell's own INT trap ends with the cell.
  trap - INT
}
PROMPT_COMMAND='__rb_after'

stty -echo
`;

export async function writeRcfile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, RCFILE);
}
