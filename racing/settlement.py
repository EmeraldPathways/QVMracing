from .execution import settle_position


def settle_paper_position(position: dict, outcome: str) -> dict:
    return settle_position(position, outcome)
