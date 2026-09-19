# QVM Racing Windows Worker

This worker is separate from `C:\QVM-Windows-Worker-v5`. It uses its own folder, virtual environment, `qvm_racing.sqlite3`, environment names, logs, and racing sync endpoint.

Install and run:

```powershell
Set-Location C:\QVM-Racing-Workbench
.\install_windows_racing.ps1
.\run_qvm_racing_worker.ps1 -Once
```

Use Task Scheduler or the long-running launcher for repeated cycles. `QVM_RACING_WORKER_INTERVAL_SECONDS=300` is a cadence, not a freshness rule. Near-off races require a provider capable of the 10-second policy; otherwise the worker must abstain.
