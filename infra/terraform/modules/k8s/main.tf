terraform {
  required_version = ">= 1.5"
}

variable "name" {
  type        = string
  description = "Resource name prefix"
}

variable "environment" {
  type        = string
  description = "Environment (staging|prod)"
}

# Placeholder: real EKS/GKE cluster + node groups + IRSA land when staging is provisioned.
locals {
  module      = "k8s"
  name_prefix = "${var.environment}-${var.name}"
}

output "name_prefix" {
  value = local.name_prefix
}

output "module" {
  value = local.module
}
