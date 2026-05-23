# desktop (placeholder)

Cross-platform desktop shell (Tauri or Electron) that **embeds the Go control-plane +
runner binaries** and serves the `/web` UI, all on localhost — the `desktop` deployment
profile, an embedded "tenant of one" (PRD6 §17.3). Must work offline; must not depend on
any cloud-only service. Supervises the embedded Go processes (ports, crashes, upgrades).

Arrives in a later milestone (PRD6 §21 ~Sub-8 equivalent).
