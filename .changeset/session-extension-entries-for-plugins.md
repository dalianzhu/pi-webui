---
"@hyperdreamer/pi-webui": minor
---

Let browser plugins read the selected session's extension entries.

Pi extensions persist their own state as `custom` session entries, and Pi keeps those entries out of the model context. PI WEBUI dropped them from the conversation projection and provided no plugin access to them, so a plugin had no way to render state owned by an extension.

- add `GET /api/sessions/:sessionId/extension-entries` on the session daemon and web/API layers
- forward each newly appended extension entry to the browser as a `session.extensionEntry` realtime event
- expose the selected session's entries as `state.sessionExtensionEntries` for plugin contributions, with a `sessionExtensionEntries` host capability for feature detection
- bound the forwarded list, and set `dataOmitted` on an entry whose payload exceeded the limit

Additive: existing plugins are unaffected and `data` remains opaque to PI WEBUI.
