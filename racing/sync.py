class SyncStore:
    def __init__(self):
        self.cycles = {}

    def apply(self, cycle_id: str, counts: dict) -> dict:
        if cycle_id in self.cycles:
            return {"idempotent": True, "cycleId": cycle_id, "counts": self.cycles[cycle_id]}
        self.cycles[cycle_id] = dict(counts)
        return {"idempotent": False, "cycleId": cycle_id, "counts": dict(counts)}
