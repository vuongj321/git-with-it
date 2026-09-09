package com.gwi.payments;

public class PaymentService implements Payable {
  private final int base;

  public PaymentService(int base) {
    this.base = base;
  }

  public int charge(int n) {
    return applyFee(this.base + n);
  }

  @Override
  public int amount() {
    return this.base;
  }

  public static int applyFee(int value) {
    return Math.round(value * 1.03f);
  }
}
