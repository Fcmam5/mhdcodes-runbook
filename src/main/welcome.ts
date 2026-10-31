// The sample runbook written to an empty runbooks folder on first launch.
export const WELCOME_FILE = "Welcome.md";

export const WELCOME_RUNBOOK = `---
title: Welcome to Runbook
---

A runbook is a Markdown file with shell cells you can run. Text like this is a **markdown cell**; the code blocks below are **shell cells**.

All shell cells in a runbook share one bash session, so state carries over from one cell to the next. Change directory here:

\`\`\`bash {id=welcome1}
cd /tmp
\`\`\`

…and this cell still runs in \`/tmp\`:

\`\`\`bash {id=welcome2}
pwd
\`\`\`

Output keeps its colours:

\`\`\`bash {id=welcome3}
echo -e "\\e[32mgreen\\e[0m, \\e[33myellow\\e[0m and \\e[1;34mbold blue\\e[0m"
\`\`\`

Runbooks are plain \`.md\` files in this folder, so you can edit them in any editor and keep them in git.
`;
