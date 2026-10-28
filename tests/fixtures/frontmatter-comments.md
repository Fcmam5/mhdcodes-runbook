---
# Runbook metadata
title: "Restart networking" # quoted on purpose
tags:
  - network
  - systemd
owner: ops # who to ask
---

Use this when Wi-Fi drops after resume.

```bash {id=net00001}
sudo systemctl restart NetworkManager
```
