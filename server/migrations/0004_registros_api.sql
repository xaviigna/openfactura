CREATE TABLE `registro_api` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`clave_id` text NOT NULL,
	`metodo` text NOT NULL,
	`ruta` text NOT NULL,
	`estado` integer NOT NULL,
	`duracion_ms` integer NOT NULL,
	`origen` text NOT NULL,
	`creado` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`clave_id`) REFERENCES `clave_api`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `registro_api_org_creado_idx` ON `registro_api` (`organization_id`,`creado`);--> statement-breakpoint
CREATE INDEX `registro_api_creado_idx` ON `registro_api` (`creado`);