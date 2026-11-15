CREATE TABLE `auditoria` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_tipo` text NOT NULL,
	`actor_id` text NOT NULL,
	`accion` text NOT NULL,
	`recurso` text NOT NULL,
	`recurso_id` text,
	`ip` text,
	`detalle` text,
	`creado` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auditoria_org_creado_idx` ON `auditoria` (`organization_id`,`creado`);--> statement-breakpoint
CREATE TABLE `clave_api` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`nombre` text NOT NULL,
	`prefijo` text NOT NULL,
	`hash` text NOT NULL,
	`modo` text NOT NULL,
	`scopes` text NOT NULL,
	`expira` integer,
	`ultimo_uso` integer,
	`revocada` integer,
	`creado_por` text,
	`creado` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creado_por`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clave_hash_uq` ON `clave_api` (`hash`);--> statement-breakpoint
CREATE INDEX `clave_org_idx` ON `clave_api` (`organization_id`);--> statement-breakpoint
CREATE TABLE `cliente` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`tipo_documento` text NOT NULL,
	`num_documento` text NOT NULL,
	`nrc` text,
	`nombre` text NOT NULL,
	`nombre_comercial` text,
	`cod_actividad` text,
	`desc_actividad` text,
	`departamento` text,
	`municipio` text,
	`distrito` text,
	`complemento` text,
	`telefono` text,
	`correo` text,
	`creado` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cliente_org_doc_uq` ON `cliente` (`organization_id`,`tipo_documento`,`num_documento`);--> statement-breakpoint
CREATE INDEX `cliente_org_nombre_idx` ON `cliente` (`organization_id`,`nombre`);--> statement-breakpoint
CREATE TABLE `correlativo` (
	`organization_id` text NOT NULL,
	`ambiente` text NOT NULL,
	`tipo_dte` text NOT NULL,
	`cod_estable` text NOT NULL,
	`cod_punto_venta` text NOT NULL,
	`anio` integer NOT NULL,
	`ultimo` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `ambiente`, `tipo_dte`, `cod_estable`, `cod_punto_venta`, `anio`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `credencial_mh` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`ambiente` text NOT NULL,
	`api_password_enc` text,
	`certificado_enc` text,
	`cert_password_enc` text,
	`cert_nit` text,
	`token_enc` text,
	`token_expira` integer,
	`actualizado` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credencial_org_ambiente_uq` ON `credencial_mh` (`organization_id`,`ambiente`);--> statement-breakpoint
CREATE TABLE `documento` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`codigo_generacion` text NOT NULL,
	`numero_control` text NOT NULL,
	`tipo_dte` text NOT NULL,
	`ambiente` text NOT NULL,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`fecha_emision` text NOT NULL,
	`hora_emision` text NOT NULL,
	`receptor_nombre` text,
	`receptor_documento` text,
	`total_centavos` integer DEFAULT 0 NOT NULL,
	`sello_recibido` text,
	`cliente_id` text,
	`origen` text DEFAULT 'panel' NOT NULL,
	`actor_tipo` text NOT NULL,
	`actor_id` text NOT NULL,
	`error` text,
	`creado` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `cliente`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documento_codigo_uq` ON `documento` (`codigo_generacion`);--> statement-breakpoint
CREATE UNIQUE INDEX `documento_org_numero_uq` ON `documento` (`organization_id`,`ambiente`,`numero_control`);--> statement-breakpoint
CREATE INDEX `documento_org_fecha_idx` ON `documento` (`organization_id`,`ambiente`,`fecha_emision`);--> statement-breakpoint
CREATE INDEX `documento_org_estado_idx` ON `documento` (`organization_id`,`estado`);--> statement-breakpoint
CREATE TABLE `documento_archivo` (
	`documento_id` text PRIMARY KEY NOT NULL,
	`dte` text NOT NULL,
	`firma` text,
	`respuesta_mh` text,
	FOREIGN KEY (`documento_id`) REFERENCES `documento`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `emisor` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`nit` text NOT NULL,
	`nrc` text NOT NULL,
	`nombre` text NOT NULL,
	`nombre_comercial` text,
	`cod_actividad` text NOT NULL,
	`desc_actividad` text NOT NULL,
	`departamento` text NOT NULL,
	`municipio` text NOT NULL,
	`distrito` text NOT NULL,
	`complemento` text NOT NULL,
	`telefono` text NOT NULL,
	`correo` text NOT NULL,
	`ambiente` text DEFAULT '00' NOT NULL,
	`responsable_nombre` text,
	`responsable_tipo_doc` text,
	`responsable_num_doc` text,
	`creado` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`actualizado` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emisor_org_uq` ON `emisor` (`organization_id`);--> statement-breakpoint
CREATE TABLE `establecimiento` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`nombre` text NOT NULL,
	`tipo` text DEFAULT '02' NOT NULL,
	`cod_mh` text NOT NULL,
	`cod_interno` text,
	`departamento` text,
	`municipio` text,
	`distrito` text,
	`complemento` text,
	`telefono` text,
	`creado` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `establecimiento_org_cod_uq` ON `establecimiento` (`organization_id`,`cod_mh`);--> statement-breakpoint
CREATE TABLE `evento` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`tipo` text NOT NULL,
	`codigo_generacion` text NOT NULL,
	`documento_id` text,
	`estado` text NOT NULL,
	`sello_recibido` text,
	`dte` text NOT NULL,
	`firma` text,
	`respuesta_mh` text,
	`creado` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`documento_id`) REFERENCES `documento`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evento_codigo_uq` ON `evento` (`codigo_generacion`);--> statement-breakpoint
CREATE INDEX `evento_org_doc_idx` ON `evento` (`organization_id`,`documento_id`);--> statement-breakpoint
CREATE TABLE `idempotencia` (
	`organization_id` text NOT NULL,
	`clave` text NOT NULL,
	`hash_peticion` text NOT NULL,
	`status` integer,
	`respuesta` text,
	`creado` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`organization_id`, `clave`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `producto` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`codigo` text NOT NULL,
	`descripcion` text NOT NULL,
	`precio_unitario` real NOT NULL,
	`tipo_item` integer DEFAULT 1 NOT NULL,
	`uni_medida` integer DEFAULT 59 NOT NULL,
	`tipo_venta` text DEFAULT 'gravada' NOT NULL,
	`creado` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `producto_org_codigo_uq` ON `producto` (`organization_id`,`codigo`);--> statement-breakpoint
CREATE TABLE `punto_venta` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`establecimiento_id` text NOT NULL,
	`nombre` text NOT NULL,
	`cod_mh` text NOT NULL,
	`cod_interno` text,
	`creado` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`establecimiento_id`) REFERENCES `establecimiento`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `punto_venta_estab_cod_uq` ON `punto_venta` (`establecimiento_id`,`cod_mh`);--> statement-breakpoint
CREATE INDEX `punto_venta_org_idx` ON `punto_venta` (`organization_id`);--> statement-breakpoint
CREATE TABLE `ventana_limite` (
	`bucket` text NOT NULL,
	`ventana_inicio` integer NOT NULL,
	`cuenta` integer NOT NULL,
	PRIMARY KEY(`bucket`, `ventana_inicio`)
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`active_organization_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);