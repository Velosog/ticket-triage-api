CREATE TYPE "public"."ticket_category" AS ENUM('billing', 'technical', 'account', 'other');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_sentiment" AS ENUM('negative', 'neutral', 'positive');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"api_key_prefix" text NOT NULL,
	"daily_token_budget" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_api_key_hash_unique" UNIQUE("api_key_hash"),
	CONSTRAINT "clients_daily_token_budget_check" CHECK ("clients"."daily_token_budget" > 0)
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"customer_email" text NOT NULL,
	"category" "ticket_category" NOT NULL,
	"priority" "ticket_priority" NOT NULL,
	"sentiment" "ticket_sentiment" NOT NULL,
	"summary" text NOT NULL,
	"suggested_reply" text NOT NULL,
	"llm_provider" text NOT NULL,
	"llm_model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_micro_usd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_summary_length_check" CHECK (char_length("tickets"."summary") <= 280)
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_client_created_idx" ON "tickets" USING btree ("client_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_client_category_created_idx" ON "tickets" USING btree ("client_id","category","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_client_priority_created_idx" ON "tickets" USING btree ("client_id","priority","created_at" DESC NULLS LAST);