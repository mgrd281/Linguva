-- CreateIndex
CREATE INDEX "TranslationMemory_sourceText_idx" ON "TranslationMemory" USING GIN ("sourceText" gin_trgm_ops);
