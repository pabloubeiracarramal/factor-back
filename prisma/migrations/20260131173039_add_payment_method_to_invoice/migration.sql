-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CREDIT_CARD', 'PAYPAL', 'OTHER');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "paymentMethod" "PaymentMethod";
