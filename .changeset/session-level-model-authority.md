---
"@hyperdreamer/pi-webui": patch
---

Keep a session's model selection session-level. **Edit from here** and the session-tree navigator
no longer change which model a session uses, and reopening a session restores the newest model and
thinking level recorded anywhere in its transcript instead of the active branch's value. A recorded
model that is unavailable or a recorded thinking level the model does not support now blocks prompts
with a visible `MODEL_POLICY_BLOCKED` reason, which clears on the next reopen once the selection
resolves again, or immediately through an explicit policy update. This fix lives in the session
daemon: restart `pi-webui-sessiond.service` for it to take effect.
