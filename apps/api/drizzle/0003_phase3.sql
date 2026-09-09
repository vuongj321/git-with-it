-- Phase 3: metrics_write job + metrics_writing run status
ALTER TYPE "run_status" ADD VALUE IF NOT EXISTS 'metrics_writing';
ALTER TYPE "job_type" ADD VALUE IF NOT EXISTS 'metrics_write';
