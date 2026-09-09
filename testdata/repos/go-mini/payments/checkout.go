package payments

func RunCheckout(base, n int) int {
	s := &Service{Base: base}
	return s.Charge(n)
}
