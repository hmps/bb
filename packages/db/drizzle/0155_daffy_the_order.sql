CREATE TABLE `thread_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`turn_id` text,
	`tool_call_id` text NOT NULL,
	`headline` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`resolution_request_id` text,
	`resolution_text` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `thread_decisions_thread_created_idx` ON `thread_decisions` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `thread_decisions_open_idx` ON `thread_decisions` (`thread_id`) WHERE "thread_decisions"."status" = 'open';