/**
 * NEXXORE Telegram bot — SCAFFOLD ONLY. Not deployed yet.
 *
 * Command handlers (index alerts, regime threshold crossings) are wired in
 * Prompt 13. This file only proves the grammY dependency compiles and gives
 * later prompts a place to grow. Do not add a start() call to CI/deploy.
 */
import { Bot } from 'grammy';

export function createBot(token: string): Bot {
  const bot = new Bot(token);
  // Placeholder handler — replaced with real commands in Prompt 13.
  bot.command('start', (ctx) => ctx.reply('NEXXORE bot — coming soon.'));
  return bot;
}
