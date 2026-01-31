-- Rename description column to name, then add new optional description column
-- AlterTable: Rename description to name
ALTER TABLE "app"."InvoiceItem" RENAME COLUMN "description" TO "name";

-- AlterTable: Add new optional description column
ALTER TABLE "app"."InvoiceItem" ADD COLUMN "description" TEXT;
