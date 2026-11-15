ALTER TABLE `evento` ADD `ambiente` text;--> statement-breakpoint
UPDATE `evento` SET `ambiente` = json_extract(`dte`, '$.identificacion.ambiente') WHERE `ambiente` IS NULL;
