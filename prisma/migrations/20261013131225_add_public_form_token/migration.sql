/*
  Warnings:

  - A unique constraint covering the columns `[publicToken]` on the table `Form` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Form" ADD COLUMN     "publicToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Form_publicToken_key" ON "Form"("publicToken");
