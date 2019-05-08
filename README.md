<img src="https://github.com/LeaPhant/pagkibot/blob/master/res/logo.png?" height="150">

Discord bot for instant Twitch live notifications using Twitch's PubSub API.

Tracked channels are updated every minute with updated titles, game names and viewcounts.

<img src="https://i.imgur.com/8fnjDEu.png">

## Prequisites

- Node.js (Download from [here](https://nodejs.org/))
- A Discord API application with the bot feature enabled (Create one [here](https://discordapp.com/developers/applications/))
- A Twitch API application (Create one [here](https://dev.twitch.tv/console/apps/create), just put `http://localhost/` as Redirect URL)

## Installation

- [Download](https://github.com/LeaPhant/pagkibot/archive/master.zip) this repo and unzip it into the location you want to run the bot from
- Open the terminal on Mac/Linux or a cmd.exe/PowerShell window with administrator rights on Windows
- Navigate into the folder you unzipped it into

Windows example:

```
cd "\Users\<Windows Username>\Documents\pagkibot"
```

Linux/Mac example:

```
cd "/home/<username>/Documents/pagkibot"
```
- Now you will have to install the dependencies

```
npm i
```

- Now open the `credentials.json` file in any text editor and enter the required information in between the quotes

```JSON
{
    "twitch": {
        "clientID": "XXXXXXXXXXXXXXXXXXXXX"
    },
    
    "discord": {
        "clientID": "XXXXXXXXXXXXXXX",
        "token": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    }
    
}
```

You can find the Twitch Client ID [like this](https://i.imgur.com/XuDlRJO.png) in the [Twitch developer console](https://dev.twitch.tv/console).

You can find the Discord Client ID [like this](https://i.imgur.com/OSxCT42.png) in the [Discord developer console](https://discordapp.com/developers/applications/).

You can find the Discord Token [like this](https://i.imgur.com/nCIFaP5.png) in the [Discord developer console](https://discordapp.com/developers/applications/) (you will be prompted add a bot to your application first, just follow the instructions)

- Now that the information is filled in, run the bot once

```
node index
```

Press Ctrl+C to stop the bot again.

- if there's no errors you should be greeted with an invite link. Use this to invite the bot to every server you want it in.
- The next step is setting up an automated way of keeping this bot running 24/7 cause it would be pointless otherwise

Windows (in cmd.exe/PowerShell with administrator rights):

```
npm i -g pm2 pm2-windows-service
pm2 start --name pagkibot index.js
pm2 save
pm2-service-install
```

Linux/Mac:

```
sudo npm i -g pm2
pm2 start --name pagkibot index.js
pm2 save
pm2 startup
```

- Now the bot should be up and running and also automatically start on boot.

## Configuration

You can do some basic configuration in the `config.json` file.

```JS
{
    "debug": true, // this will log additional information during runtime, set to false to disable
    "prefix": "!", // how to call the bot, the default is ! so commands are used like this: !twitch-track
    "allowDM": true, // whether to allow people DM'ing the bot to track channels via DM
    "avatarPath": "./res/avatar.png", // path to the avatar image for the bot to use
    "commands": {
        "twitchTrack": {
            "enabled": true, 
            // you can disable a command by setting this to false
            "cmd": ["twitch-track", "track-channel"], 
            // how to run this command, you can set multiple aliases for every command which is optional
            "perms": ["MANAGE_CHANNELS", "MANAGE_GUILD"] 
            // which permissions running this command requires, there's a list of permissions to use below
        },
        // ...
        // every command has the same structure
    }
}
```

## Usage

Tracking always happens in the context of a Discord channel. So these commands apply to the channel you are using them in.

The following commands are available by default:

### !twitch-track \<username\>
  
Start tracking a Twitch channel 
 
**Example**: !twitch-track trihex
 
### !twitch-untrack \<username\>
  
Stop tracking a Twitch channel

**Example**: !twitch-untrack ninja

### !twitch-notify \<username\>

Allows users to get mentioned when a channel that is already tracked goes live. This does not allow users to track a new channel.

**Example**: !twitch-notify distortion2

### !twitch-unnotify \<username\>
  
Allows users to disable the mention for a channel.

**Example**: !twitch-unnotify destiny

### !twitch-redirect \<channel mention\>
  
Set another channel for the stream announcements to appear in. You could for example have a **#streams** channel for stream announcements and a separate **#streams-commands** channel where you run the commands as to not clutter the channel dedicated to stream announcements.

**Example**: !twitch-redirect #streams

### !twitch-tracking

Get an overview of the tracked Twitch channels for the current Discord channel.

**Example**: !twitch-tracking

### !twitch-everyone \<username\>

Toggle mentioning @everyone when a channel goes live. You can check which channels mention @everyone when they go live via !twitch-tracking.

**Example**: !twitch-everyone puncayshun

## Limitations

The current limit of the maximum amount of tracked channels is around ~250 per IP address due to Twitch restrictions. This is the reason I can't host this bot and have to let people host it themselves.

## Why is it called pagkibot?

"pagkibot" is the filipino word for twitch.
