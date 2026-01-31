/*
  Warnings:

  - You are about to drop the column `clientName` on the `Invoice` table. All the data in the column will be lost.
  - Made the column `clientId` on table `Invoice` required. This step will fail if there are existing NULL values in that column.

*/

-- Step 1: Create a placeholder client for orphaned invoices
-- Get the companyId from existing invoices to create client in the right company
DO $$
DECLARE
  v_company_id text;
  v_placeholder_client_id text;
BEGIN
  -- Get the companyId from the first invoice with NULL clientId
  SELECT "companyId" INTO v_company_id 
  FROM "app"."Invoice" 
  WHERE "clientId" IS NULL 
  LIMIT 1;
  
  -- If there are invoices without clientId, create a placeholder client
  IF v_company_id IS NOT NULL THEN
    -- Create placeholder client
    INSERT INTO "app"."Client" ("id", "name", "companyId", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'Legacy Client (Migration)', v_company_id, NOW(), NOW())
    RETURNING "id" INTO v_placeholder_client_id;
    
    -- Update all invoices with NULL clientId to use the placeholder
    UPDATE "app"."Invoice"
    SET "clientId" = v_placeholder_client_id
    WHERE "clientId" IS NULL;
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "app"."Invoice" DROP CONSTRAINT "Invoice_clientId_fkey";

-- AlterTable
ALTER TABLE "app"."Invoice" DROP COLUMN "clientName",
ALTER COLUMN "clientId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "app"."Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "app"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

