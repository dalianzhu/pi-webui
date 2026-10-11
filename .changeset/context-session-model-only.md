---
"@hyperdreamer/pi-webui": minor
---

Add an explicit "Only use session model" Context utility routing mode. When `utilityModels.context`
is `"session"`, compaction uses the active session model and thinking level directly and attempts
neither the configured Context model nor Lightweight; unset and fixed Context routing are unchanged.
The choice appears in **Settings → Utility models** when the selected machine reports utility-model
settings contract version 3, and older clients or runtimes keep their current editor. Installing this
feature requires one manual `pi-webui-sessiond.service` restart
(`systemctl --user restart pi-webui-sessiond.service`) because the resolver short-circuit and the
compaction handler live in the long-lived, non-autoreloading session daemon.
