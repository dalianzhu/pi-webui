---
"@hyperdreamer/pi-webui": patch
---

Keep browser plugins' view of the selected session's extension entries consistent when reads overlap or a session reconnects, and keep entry ordering stable when a stopped session is reopened.

Restart `pi-webui-sessiond.service` manually after upgrading (`systemctl --user restart pi-webui-sessiond.service`), including on each upgraded remote machine. Until that restart, an updated UI can show only newly arriving entries for the selected session, because it rejects the older session daemon's response instead of applying it without read ordering.
