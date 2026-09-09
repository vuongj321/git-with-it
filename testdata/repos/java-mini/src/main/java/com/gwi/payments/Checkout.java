package com.gwi.payments;

import com.gwi.payments.PaymentService;

public class Checkout {
  public static int runCheckout(int base, int n) {
    PaymentService service = new PaymentService(base);
    return service.charge(n);
  }
}
