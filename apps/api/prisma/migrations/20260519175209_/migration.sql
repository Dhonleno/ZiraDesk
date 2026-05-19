-- CreateTable
CREATE TABLE "conversation_close_types" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_close_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_close_outcomes" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_close_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "close_type_id" TEXT,
    "close_outcome_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "csat_expires_at" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_close_types_label_key" ON "conversation_close_types"("label");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_close_outcomes_label_key" ON "conversation_close_outcomes"("label");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_close_type_id_fkey" FOREIGN KEY ("close_type_id") REFERENCES "conversation_close_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_close_outcome_id_fkey" FOREIGN KEY ("close_outcome_id") REFERENCES "conversation_close_outcomes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
