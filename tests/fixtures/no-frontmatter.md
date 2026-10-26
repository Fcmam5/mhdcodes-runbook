Restart PipeWire first; this fixes it most of the time.

```bash {id=a1b2c3d4}
systemctl --user restart pipewire pipewire-pulse wireplumber
```

If that didn't work, check the sinks:

```bash {id=e5f6g7h8}
pactl list short sinks
```
