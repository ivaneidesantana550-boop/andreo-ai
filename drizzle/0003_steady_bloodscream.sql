ALTER TABLE `appSettings` ADD `brandSubtitle` varchar(80) DEFAULT 'AI / WORKSPACE' NOT NULL;--> statement-breakpoint
ALTER TABLE `appSettings` ADD `welcomeEyebrow` varchar(120) DEFAULT 'INTELIGÊNCIA OPERACIONAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `appSettings` ADD `welcomeMessage` text NOT NULL;--> statement-breakpoint
ALTER TABLE `appSettings` ADD `welcomeDescription` varchar(240) DEFAULT 'Transforme intenção em entregas concretas.' NOT NULL;--> statement-breakpoint
ALTER TABLE `appSettings` ADD `inputPlaceholder` varchar(180) DEFAULT 'Descreva o que você quer construir...' NOT NULL;--> statement-breakpoint
ALTER TABLE `appSettings` ADD `toolsSectionLabel` varchar(100) DEFAULT 'Ferramentas do workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `appSettings` ADD `newSessionLabel` varchar(80) DEFAULT 'Nova sessão' NOT NULL;--> statement-breakpoint
ALTER TABLE `appSettings` ADD `onlineLabel` varchar(40) DEFAULT 'ONLINE' NOT NULL;--> statement-breakpoint
ALTER TABLE `appSettings` ADD `assistantLabel` varchar(40) DEFAULT 'ASSISTANT' NOT NULL;--> statement-breakpoint
ALTER TABLE `appSettings` ADD `userLabel` varchar(40) DEFAULT 'Você' NOT NULL;--> statement-breakpoint
ALTER TABLE `appSettings` ADD `processingLabel` varchar(40) DEFAULT 'PROCESSANDO' NOT NULL;--> statement-breakpoint
ALTER TABLE `appSettings` ADD `quickPrompt1` varchar(180) DEFAULT 'Crie um componente React responsivo' NOT NULL;--> statement-breakpoint
ALTER TABLE `appSettings` ADD `quickPrompt2` varchar(180) DEFAULT 'Explique este erro de TypeScript' NOT NULL;--> statement-breakpoint
ALTER TABLE `appSettings` ADD `quickPrompt3` varchar(180) DEFAULT 'Pesquise tendências de design para SaaS' NOT NULL;