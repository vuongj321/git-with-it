from payments.service import PaymentService


def apply_fee(value: float) -> float:
    return round(value * 1.03)


class Checkout:
    def __init__(self, base: float) -> None:
        self._svc = PaymentService(base)

    def run(self, total: float) -> float:
        return apply_fee(self._svc.charge(total))
