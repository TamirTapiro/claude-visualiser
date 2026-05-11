---
name: open
description: Open the Claude Visualiser dashboard in your browser and show current status
---

Print the following and nothing else:

**Claude Visualiser** → http://localhost:37778

Check if the worker is running by attempting a GET to http://localhost:37778/api/sessions.
If reachable: show "● Live — N sessions active" (substitute N from the response).
If not reachable: show "○ Worker not running — it starts automatically on next SessionStart."
