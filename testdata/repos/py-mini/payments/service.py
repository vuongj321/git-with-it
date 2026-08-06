class PaymentService:
    def __init__(self, base: float) -> None:
        self.base = base

    def charge(self, n: float) -> float:
        return self.base + n

    def amount(self) -> float:
        return self.base
