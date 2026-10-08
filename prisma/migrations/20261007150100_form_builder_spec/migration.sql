-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- AlterTable
ALTER TABLE "Form" ADD COLUMN "titleDoc" JSONB;
ALTER TABLE "Form" ADD COLUMN "descriptionDoc" JSONB;
ALTER TABLE "Form" ADD COLUMN "status" "FormStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "Form" ADD COLUMN "publicId" TEXT;

UPDATE "Form" SET "status" = 'PUBLISHED' WHERE "published" = true;

UPDATE "Form"
SET "publicId" = replace(gen_random_uuid()::text, '-', '')
WHERE "status" = 'PUBLISHED' AND "publicId" IS NULL;

ALTER TABLE "Form" DROP COLUMN "published";

-- CreateIndex
CREATE UNIQUE INDEX "Form_publicId_key" ON "Form"("publicId");

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleDoc" JSONB,
    "descriptionDoc" JSONB,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Section" ("id", "formId", "title", "order")
SELECT gen_random_uuid()::text, "id", 'Section 1', 0
FROM "Form";

-- AlterTable
ALTER TABLE "Field" ADD COLUMN "sectionId" TEXT;
ALTER TABLE "Field" ADD COLUMN "titleDoc" JSONB;
ALTER TABLE "Field" ADD COLUMN "descriptionDoc" JSONB;
ALTER TABLE "Field" ADD COLUMN "validation" JSONB;

UPDATE "Field" AS field
SET "sectionId" = section."id"
FROM "Section" AS section
WHERE section."formId" = field."formId";

ALTER TABLE "Field" ALTER COLUMN "sectionId" SET NOT NULL;

UPDATE "Field"
SET "options" = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', gen_random_uuid()::text, 'label', value)
      ORDER BY ordinality
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements_text("Field"."options") WITH ORDINALITY AS item(value, ordinality)
)
WHERE "options" IS NOT NULL
  AND jsonb_typeof("options") = 'array'
  AND (
    jsonb_array_length("options") = 0
    OR jsonb_typeof("options" -> 0) = 'string'
  );

UPDATE "Field" SET "options" = '[]'::jsonb WHERE "options" IS NULL;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN "snapshot" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Submission" ALTER COLUMN "snapshot" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Section_formId_idx" ON "Section"("formId");
CREATE INDEX "Field_sectionId_idx" ON "Field"("sectionId");

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Field" ADD CONSTRAINT "Field_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
