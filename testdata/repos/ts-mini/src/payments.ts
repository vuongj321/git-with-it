export interface Payable {
  amount(): number;
}

export class PaymentService implements Payable {
  constructor(private readonly base: number) {}

  charge(n: number): number {
    return applyFee(this.base + n);
  }

  amount(): number {
    return this.base;
  }
}

export function applyFee(value: number): number {
  return Math.round(value * 1.03);
}
