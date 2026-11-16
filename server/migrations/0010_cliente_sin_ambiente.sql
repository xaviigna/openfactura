-- Los clientes guardados sólo existen en producción: un solo directorio por organización.
-- Antes de quitar la columna, se borra la copia de pruebas de un cliente que también existe en
-- producción (el índice (org, ambiente, tipo, número) impide más de una por ambiente).
DELETE FROM `cliente` WHERE `ambiente` = '00' AND EXISTS (SELECT 1 FROM `cliente` AS `o` WHERE `o`.`ambiente` = '01' AND `o`.`organization_id` = `cliente`.`organization_id` AND `o`.`tipo_documento` = `cliente`.`tipo_documento` AND `o`.`num_documento` = `cliente`.`num_documento`);--> statement-breakpoint
DROP INDEX `cliente_org_doc_uq`;--> statement-breakpoint
ALTER TABLE `cliente` DROP COLUMN `ambiente`;--> statement-breakpoint
CREATE UNIQUE INDEX `cliente_org_doc_uq` ON `cliente` (`organization_id`,`tipo_documento`,`num_documento`);
