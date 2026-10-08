-- New answer types and text blocks. Kept in their own migration so the
-- enum values commit before later migrations use the type.
ALTER TYPE "FieldType" ADD VALUE 'PHONE';
ALTER TYPE "FieldType" ADD VALUE 'YES_NO';
ALTER TYPE "FieldType" ADD VALUE 'RATING';
ALTER TYPE "FieldType" ADD VALUE 'LINEAR_SCALE';
ALTER TYPE "FieldType" ADD VALUE 'FILE';
ALTER TYPE "FieldType" ADD VALUE 'HEADING';
ALTER TYPE "FieldType" ADD VALUE 'INSTRUCTION';
