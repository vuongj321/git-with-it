import { PaymentService, applyFee } from "./payments";

export function runCheckout(total: number): number {
  const svc = new PaymentService(10);
  return applyFee(svc.charge(total));
}
