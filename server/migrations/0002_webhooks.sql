CREATE TABLE `webhook` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`url` text NOT NULL,
	`descripcion` text,
	`eventos` text NOT NULL,
	`secreto_enc` text NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`creado` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`actualizado` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_org_idx` ON `webhook` (`organization_id`);--> statement-breakpoint
CREATE TABLE `webhook_entrega` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`webhook_id` text NOT NULL,
	`evento` text NOT NULL,
	`payload` text NOT NULL,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`intentos` integer DEFAULT 0 NOT NULL,
	`ultimo_status` integer,
	`ultimo_error` text,
	`proximo_intento` integer,
	`creado` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`entregado` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhook`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_entrega_cola_idx` ON `webhook_entrega` (`estado`,`proximo_intento`);--> statement-breakpoint
CREATE INDEX `webhook_entrega_webhook_idx` ON `webhook_entrega` (`webhook_id`,`creado`);