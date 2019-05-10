<img src="https://github.com/LeaPhant/pagkibot/blob/master/res/logo.png?" height="150">

Discord bot for instant Twitch live notifications using Twitch's PubSub API.

Tracked channels are updated every minute with updated titles, game names and viewcounts.

<img src="https://i.imgur.com/8fnjDEu.png">

## Getting started

Head over to the [Wiki](https://github.com/LeaPhant/pagkibot/wiki) to get help on installing this bot.

## Updating

To update the bot, run `npm run update` in the bot folder.

**Warning**: Currently this will delete all files in the bot folder. Only the avatar, configuration and credentials will be saved, any changes you make to the bot will be overwritten.

*The updater is also WIP and will be removed once I add proper default config logic so the bot can be just updated by pulling the repo*

## Commands

You can find a list of commands [here](https://github.com/LeaPhant/pagkibot/wiki/4.-Commands).

## Limitations

The current limit of the maximum amount of tracked channels is around ~500 per IP address due to Twitch restrictions. This is the reason I can't host this bot and have to let people host it themselves.

## Why is it called pagkibot?

"pagkibot" is the filipino word for twitch.
