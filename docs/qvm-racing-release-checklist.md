# QVM Racing release checklist

- Product: QVM Racing Workbench
- Public Site: https://qvm-racing-workbench.emeraldpathways.chatgpt.site
- Database binding: `QVM_RACING_DB` / `qvm-racing`
- Local database: `qvm_racing.sqlite3`
- Provider: demo; no Betfair credentials or adapter
- Model: `racing-logit-v1`; baseline `market-no-vig-v1`
- Mode: paper-only; no live order path
- Worker command: `Set-Location C:\QVM-Racing-Workbench; .\run_qvm_racing_worker.ps1 -Once`
- Verification: Python racing suite, Worker API tests, JavaScript syntax, Worker build, public API smoke test
- Remaining operational risk: external provider coverage is not enabled; only deterministic demo data is active
