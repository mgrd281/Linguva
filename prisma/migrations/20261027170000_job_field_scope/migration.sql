-- CreateEnum
CREATE TYPE "JobFieldScope" AS ENUM ('ALL', 'SEO');

-- AlterTable
ALTER TABLE "TranslationJob" ADD COLUMN     "fieldScope" "JobFieldScope" NOT NULL DEFAULT 'ALL';

