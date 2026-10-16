CREATE TYPE "public"."llm_outcome" AS ENUM('success', 'invalid_output', 'refused', 'error');--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"ticket_id" uuid,
	"request_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"attempt" integer NOT NULL,
	"outcome" "llm_outcome" NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_input_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_usage_client_created_idx" ON "llm_usage" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_usage_ticket_idx" ON "llm_usage" USING btree ("ticket_id");