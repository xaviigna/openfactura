ALTER TABLE `webhook` ADD `creado_por` text REFERENCES user(id) ON DELETE SET NULL;
