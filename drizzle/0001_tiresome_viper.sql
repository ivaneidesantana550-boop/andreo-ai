CREATE TABLE `appSettings` (
	`id` int NOT NULL DEFAULT 1,
	`chatName` varchar(80) NOT NULL DEFAULT 'Andreo',
	`displayName` varchar(120) NOT NULL DEFAULT 'Andreo AI',
	`icon` varchar(24) NOT NULL DEFAULT 'A',
	`background` text NOT NULL,
	`systemPrompt` text NOT NULL,
	`instructions` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `appSettings_id` PRIMARY KEY(`id`)
);
