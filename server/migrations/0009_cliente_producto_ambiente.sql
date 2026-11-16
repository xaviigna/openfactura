DROP INDEX `cliente_org_doc_uq`;--> statement-breakpoint
ALTER TABLE `cliente` ADD `ambiente` text DEFAULT '01' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `cliente_org_doc_uq` ON `cliente` (`organization_id`,`ambiente`,`tipo_documento`,`num_documento`);--> statement-breakpoint
DROP INDEX `producto_org_codigo_uq`;--> statement-breakpoint
ALTER TABLE `producto` ADD `ambiente` text DEFAULT '01' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `producto_org_codigo_uq` ON `producto` (`organization_id`,`ambiente`,`codigo`);
-- Los registros existentes quedan en producción (DEFAULT 01).
