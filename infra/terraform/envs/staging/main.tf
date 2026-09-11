terraform {
  required_version = ">= 1.5"
}

locals {
  environment = "staging"
  name        = "gwi"
}

module "vpc" {
  source      = "../../modules/vpc"
  name        = local.name
  environment = local.environment
}

module "k8s" {
  source      = "../../modules/k8s"
  name        = local.name
  environment = local.environment
}

module "postgres" {
  source      = "../../modules/postgres"
  name        = local.name
  environment = local.environment
}

module "redis" {
  source      = "../../modules/redis"
  name        = local.name
  environment = local.environment
}

module "s3" {
  source      = "../../modules/s3"
  name        = local.name
  environment = local.environment
}

module "secrets" {
  source      = "../../modules/secrets"
  name        = local.name
  environment = local.environment
}

output "environment" {
  value = local.environment
}
