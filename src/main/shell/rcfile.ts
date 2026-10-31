import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// The rcfile every session starts with.
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
  # Ctrl+C works again for the run, which ends any INT trap a cell set before.
  trap - INT
  __rb_cur=$1
  stty echo
  printf '\033]777;rb-start;%s\007' "$1"
  source "$2"
}

# Runs before every prompt, including after Ctrl+C aborts __rb_run,
# so the done marker is always emitted.
__rb_after() {
  local __rb_rc=$?
  # Ignore Ctrl+C from here until the next run starts. One typed as the run ends
  # would abort this function before its marker; one at the idle prompt would make
  # bash drop the start of the next run line. First thing, so the gap is tiny.
  trap '' INT
  # noflsh: Ctrl+C must not flush the terminal's queues. The output queue can hold a
  # marker bash has already written, and losing it leaves the session busy forever.
  stty -echo noflsh
  set +e
  if [ -n "$__rb_cur" ]; then
    # Discard input typed during the run (full or partial lines) so it never
    # executes as a command.
    while read -r -s -t 0.05 -n 4096 _; do :; done
    printf '\033]777;rb-done;%s;%d\007' "$__rb_cur" "$__rb_rc"
    __rb_cur=''
  elif [ -z "$__rb_ready" ]; then
    while read -r -s -t 0.05 -n 4096 _; do :; done
    # First prompt: only now is bash actually waiting for input.
    __rb_ready=1
    printf '\033]777;rb-ready\007'
  fi
  # Any other prompt drains nothing: the host may already have written the next run
  # line, which a drain would swallow.
}
PROMPT_COMMAND='__rb_after'

stty -echo noflsh
`;

export async function writeRcfile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, RCFILE);
}
