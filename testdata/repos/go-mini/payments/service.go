package payments

import "fmt"

type Payable interface {
	Amount() int
}

type Service struct {
	Base int
}

func (s *Service) Charge(n int) int {
	return ApplyFee(s.Base + n)
}

func (s *Service) Amount() int {
	return s.Base
}

func ApplyFee(value int) int {
	fmt.Println(value)
	return value
}
