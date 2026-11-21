CREATE TABLE `miembro_documento` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tipo_documento` text NOT NULL,
	`num_documento` text NOT NULL,
	`actualizado` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `user_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
